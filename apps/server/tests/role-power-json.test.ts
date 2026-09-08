import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeShards, type ShardReport } from "../scripts/role-power-merge";

/**
 * Vòng đời thật của một lượt đo chia shard: `role-power --json` ghi ra,
 * `role-power-merge` đọc vào.
 *
 * Lõi gộp đã có test riêng. Thứ CHỈ đo được ở đây là cái vỏ: cờ CLI có được
 * nối vào không, và hai script có còn nói cùng một ngôn ngữ không - đúng loại
 * hồi quy mà một bài test import thẳng hàm sẽ không bao giờ thấy.
 */
const ROOT = resolve(__dirname, "..", "..", "..");

function runJson(args: readonly string[]): ShardReport {
  const out = execFileSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      join(ROOT, "apps", "server", "scripts", "role-power.ts"),
      ...args,
    ],
    { encoding: "utf8", cwd: ROOT },
  );
  // Phải parse được TRỌN stdout: một dòng bảng chữ lẫn vào là hỏng cả bước gộp.
  return JSON.parse(out) as ShardReport;
}

describe("role-power --json", () => {
  it("in ra JSON gộp được, không lẫn bảng chữ", () => {
    const report = runJson(["--json", "--games", "1", "--only", "8"]);

    expect(report.games).toBe(1);
    expect(report.presets).toEqual([{ playerCount: 8, villageWinRate: expect.any(Number) }]);
    expect(report.deltas.length).toBeGreaterThan(0);
    expect(report.deltas[0]).toEqual({
      role: expect.any(String),
      playerCount: 8,
      delta: expect.any(Number),
    });
  }, 60_000);

  it("kết quả của một shard đi thẳng vào bộ gộp", () => {
    const report = runJson(["--json", "--games", "1", "--only", "8", "--role", "SEER"]);

    // `--role` cắt theo chiều vai; nền vẫn phải chạy để có mốc trừ.
    expect(report.deltas.map((item) => item.role)).toEqual(["SEER"]);

    const merged = mergeShards([report]);
    expect(merged.presets).toEqual(report.presets);
    expect(merged.roles.map((row) => row.role)).toEqual(["SEER"]);
  }, 60_000);

  it("sweep đo được Kẻ Theo Dõi", () => {
    const report = runJson(["--json", "--games", "1", "--only", "13", "--role", "TRACKER"]);
    expect(report.deltas.map((item) => item.role)).toEqual(["TRACKER"]);
  }, 60_000);
});
