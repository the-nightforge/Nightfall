import { readFileSync, readdirSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROLE_POWER, type Role } from "@masoi/shared";

/**
 * Gộp kết quả `role-power.ts --json` của nhiều shard CI thành MỘT bảng.
 *
 * Vì sao cần một bước gộp riêng thay vì để mỗi shard tự in bảng: hai cột cuối
 * của `role-power.ts` ("đo được", "đang dùng") dựng trên vai LÀNG MẠNH NHẤT của
 * chính lượt chạy đó, nên chúng chỉ có nghĩa ở một lượt quét đầy đủ. Cắt việc
 * ra 15 shard thì mỗi shard có một cái neo khác nhau. Chỉ `delta` thô là cộng
 * được - đó cũng là điều chú thích của cờ `--only` trong `role-power.ts` đã nói.
 */

export interface ShardReport {
  games: number;
  presets: Array<{ playerCount: number; villageWinRate: number }>;
  deltas: Array<{ role: Role; playerCount: number; delta: number }>;
}

export interface MergedRole {
  role: Role;
  /** Trung bình `delta` trên MỌI preset đo được vai này, dạng tỉ lệ [0, 1]. */
  meanDelta: number;
  samples: number;
  implied: number;
  using: number;
  gap: number;
  suspect: boolean;
}

export interface MergedReport {
  games: number;
  presets: Array<{ playerCount: number; villageWinRate: number }>;
  roles: MergedRole[];
}

/**
 * Điểm thắng đổi được một bậc `ROLE_POWER`.
 *
 * Cùng cái neo mà `TRAITOR` và `WOLF_CUB` đã dùng khi chốt số của chúng: một
 * con Sói thay một ghế Dân Làng đáng -27 điểm cho 4.5 bậc, tức ~6 điểm mỗi bậc.
 */
const POINTS_PER_UNIT = 6;

/** Lệch quá ngần này so với bảng đang dùng thì con số cũ đáng bị nghi. */
const SUSPECT_GAP = 1;

/**
 * `pointsPerUnit` mặc định là hằng số neo ở trên; `preset-balance.ts power` đưa
 * vào thước đo ngay trong lượt chạy (từ phép gỡ một Sói thường).
 */
export function mergeShards(
  shards: readonly ShardReport[],
  pointsPerUnit: number = POINTS_PER_UNIT,
): MergedReport {
  const games = shards[0]?.games ?? 0;
  for (const item of shards) {
    if (item.games !== games) {
      throw new Error(
        `Các shard chạy khác số ván (${games} và ${item.games}); Δ của chúng không cùng một đại lượng.`,
      );
    }
  }

  // Baseline trùng nhau là CHUYỆN THƯỜNG: shard cắt theo `--role` của cùng một
  // preset đều phải chạy lại nền để có mốc trừ. Trùng mà LỆCH mới là vấn đề.
  const presets = new Map<number, number>();
  for (const item of shards) {
    for (const preset of item.presets) {
      const seen = presets.get(preset.playerCount);
      if (seen !== undefined && seen !== preset.villageWinRate) {
        throw new Error(
          `Preset ${preset.playerCount} ra hai baseline khác nhau (${seen} và ${preset.villageWinRate}); phép đo không tái lập được.`,
        );
      }
      presets.set(preset.playerCount, preset.villageWinRate);
    }
  }

  // Gia quyền theo MẪU, không phải trung bình của các trung bình shard: một vai
  // đo ở 4 preset không được đếm ngang một vai đo ở 1 preset.
  const sums = new Map<Role, { sum: number; samples: number }>();
  for (const item of shards) {
    for (const entry of item.deltas) {
      const cur = sums.get(entry.role) ?? { sum: 0, samples: 0 };
      cur.sum += entry.delta;
      cur.samples += 1;
      sums.set(entry.role, cur);
    }
  }

  const roles = [...sums.entries()]
    .map(([role, { sum, samples }]): MergedRole => {
      const meanDelta = sum / samples;
      const using = ROLE_POWER[role];
      // Làm tròn 0.5 vì bảng `ROLE_POWER` chỉ nói bằng nửa bậc.
      const implied = Math.round((0.5 + (meanDelta * 100) / pointsPerUnit) * 2) / 2;
      const gap = implied - using;
      return { role, meanDelta, samples, implied, using, gap, suspect: Math.abs(gap) > SUSPECT_GAP };
    })
    .sort((left, right) => right.meanDelta - left.meanDelta);

  return {
    games,
    presets: [...presets.entries()]
      .map(([playerCount, villageWinRate]) => ({ playerCount, villageWinRate }))
      .sort((left, right) => left.playerCount - right.playerCount),
    roles,
  };
}

export function formatMarkdown(report: MergedReport): string {
  const lines: string[] = [
    `# Sức mạnh vai đo bằng self-play`,
    "",
    `${report.games} ván mỗi ô, DEFENSE thảo luận tự do BẬT, sự kiện TẮT, speech BẬT.`,
    "",
    "## Tỉ lệ thắng phe làng theo preset",
    "",
    "| cỡ phòng | làng thắng |",
    "| --- | --- |",
    ...report.presets.map((item) => `| ${item.playerCount} | ${(item.villageWinRate * 100).toFixed(1)}% |`),
    "",
    "## Đóng góp biên so với một lá Dân Làng",
    "",
    "| vai | Δ thắng | đo được | đang dùng | lệch | mẫu | |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.roles.map(
      (row) =>
        `| ${row.role} | ${(row.meanDelta * 100).toFixed(1)}% | ${row.implied.toFixed(1)} | ${row.using.toFixed(1)} | ${row.gap.toFixed(1)} | ${row.samples} | ${row.suspect ? "**SUSPECT**" : ""} |`,
    ),
    "",
    `Chỉ đổi \`ROLE_POWER\` khi |lệch| > ${SUSPECT_GAP.toFixed(1)}.`,
    "",
    "CẢNH BÁO khi đọc: đây là BOT đánh BOT. Vai cần đọc vị và nói dối (Thị Trưởng,",
    "Kẻ Nguyền Rủa) bị đo thấp hơn giá trị thật của nó trên bàn người.",
    "",
  ];
  return lines.join("\n");
}

function usage(): string {
  return "Chạy: npx tsx apps/server/scripts/role-power-merge.ts <thư-mục-chứa-json>";
}

function main(): void {
  const dir = process.argv[2];
  if (dir === undefined) throw new Error(`Thiếu thư mục artifact.\n\n${usage()}`);

  const root = resolve(dir);
  // Artifact tải về nằm mỗi cái một thư mục con, nên phải quét đệ quy.
  const files: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json")) files.push(full);
    }
  };
  walk(root);

  if (files.length === 0) throw new Error(`Không có file .json nào trong ${root}`);

  const shards = files.map((file) => JSON.parse(readFileSync(file, "utf8")) as ShardReport);
  const markdown = formatMarkdown(mergeShards(shards));

  process.stdout.write(markdown);
  // Trang run của Actions hiển thị thẳng phần này, không phải tải artifact về.
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, markdown, "utf8");
}

// Chỉ chạy khi được gọi thẳng: test import `mergeShards` mà không muốn CLI nổ.
if (process.argv[1] && process.argv[1].endsWith("role-power-merge.ts")) main();
