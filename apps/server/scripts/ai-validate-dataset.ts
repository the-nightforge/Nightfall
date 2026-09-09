import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { createDatasetSummarizer, type DatasetStats } from "@masoi/game-engine";

/**
 * BOT_SELF_LEARNING §41/§42: kiểm một file trajectory JSONL TRƯỚC khi train.
 *
 * Vỏ I/O quanh bộ gom thuần, cùng ranh giới với runner self-play:
 * `packages/game-engine` không được chạm đĩa.
 *
 * Đọc theo DÒNG. Dataset 10.000 ván nặng ~2,8 GB — đọc cả file thành một chuỗi
 * vượt trần chuỗi của V8, tức tầng kiểm sẽ chết đúng ở kích thước nó cần chạy
 * nhất, và người ta sẽ train mà bỏ qua nó.
 *
 * Mã thoát khác 0 khi có BẤT KỲ vi phạm nào — §7 cấm âm thầm xoá trường rồi
 * train tiếp, nên một dataset bẩn phải làm đỏ CI chứ không chỉ in ra một dòng.
 */

function usage(): string {
  return [
    "npm run ai:validate-dataset -- <file.jsonl> [--top <n>]",
    "",
    "  --top <n>   Số lý do vi phạm được liệt kê (mặc định: 10)",
  ].join("\n");
}

async function readDataset(path: string): Promise<{ stats: DatasetStats; malformed: number }> {
  const summarizer = createDatasetSummarizer();
  let malformed = 0;

  const lines = createInterface({
    input: createReadStream(path, "utf8"),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  for await (const raw of lines) {
    const text = raw.trim();
    if (text === "") continue;
    try {
      summarizer.add(JSON.parse(text));
    } catch {
      // Một dòng JSON hỏng là dữ liệu hỏng, không phải dòng để bỏ qua im lặng.
      malformed += 1;
    }
  }

  return { stats: summarizer.finish(), malformed };
}

function percent(part: number, total: number): string {
  return total === 0 ? "0%" : `${((part / total) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const path = argv[0];
  if (path === undefined || path === "--help" || path === "-h") {
    process.stdout.write(`${usage()}\n`);
    process.exit(path === undefined ? 1 : 0);
  }

  const topIndex = argv.indexOf("--top");
  const top = topIndex >= 0 ? Number(argv[topIndex + 1] ?? 10) : 10;

  const target = resolve(path);
  const { stats, malformed } = await readDataset(target);
  const split = stats.splitCounts;

  const out: string[] = [
    `Dataset: ${target}`,
    "",
    `games                 ${stats.games}`,
    `episodes              ${stats.episodes}`,
    `timesteps             ${stats.timesteps}`,
    `dòng JSON hỏng        ${malformed}`,
    "",
    `invalid observations  ${stats.invalidObservations}`,
    `invalid actions       ${stats.invalidActions}`,
    `leak violations       ${stats.leakViolations}`,
    `hành động không nhãn  ${stats.unmappedActions} (${percent(stats.unmappedActions, stats.timesteps)})`,
    "",
    `split (theo ván)      train ${split.train} / val ${split.validation} / test ${split.test}`,
    "",
    "Phân phối vai:",
    ...Object.entries(stats.roleDistribution)
      .sort((a, b) => b[1] - a[1])
      .map(([role, count]) => `  ${role.padEnd(18)} ${count} (${percent(count, stats.timesteps)})`),
    "",
    "Phân phối pha:",
    ...Object.entries(stats.phaseDistribution)
      .sort((a, b) => b[1] - a[1])
      .map(([phase, count]) => `  ${phase.padEnd(18)} ${count}`),
    "",
    "Phân phối loại quyết định:",
    ...Object.entries(stats.decisionDistribution)
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => `  ${kind.padEnd(18)} ${count}`),
    "",
    // §43: mất cân bằng lớp phải được NHÌN THẤY trước khi chọn cách cân, chứ
    // không phát hiện ra sau khi model chỉ biết bầu ghế 1.
    "Phân phối lớp hành động (§43):",
    ...Object.entries(stats.actionDistribution)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([action, count]) => `  action ${action.padEnd(11)} ${count} (${percent(count, stats.timesteps)})`),
    "",
    `reward                win ${stats.rewardDistribution.win} / loss ${stats.rewardDistribution.loss}`,
    "",
    // Con số đầu tiên cần đọc trước khi train: model không thể khớp hơn mức
    // này, vì phần còn lại do RNG (term jitter) quyết định. Thấp thì sinh lại
    // dataset với `--no-jitter`, đừng tăng epoch.
    `trần độ khớp (§17)    ${percent(stats.teacherCeiling.matched, stats.teacherCeiling.rows)}` +
      ` — ${stats.teacherCeiling.matched}/${stats.teacherCeiling.rows} nước đi trùng argmax(điểm − jitter)`,
  ];

  const reasons = Object.entries(stats.violationsByReason).sort((a, b) => b[1] - a[1]);
  if (reasons.length > 0) {
    out.push("", `Vi phạm (${reasons.length} lý do, hiện ${Math.min(top, reasons.length)}):`);
    for (const [reason, count] of reasons.slice(0, top)) out.push(`  ${count}×  ${reason}`);
  }

  const total =
    stats.invalidObservations + stats.invalidActions + stats.leakViolations + malformed;
  out.push("", total === 0 ? "KẾT LUẬN: dataset SẠCH — train được." : `KẾT LUẬN: TỪ CHỐI — ${total} vi phạm.`);
  process.stdout.write(`${out.join("\n")}\n`);

  if (total > 0) process.exitCode = 1;
}

void main();
