import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTraceJsonl, termSumProblems } from "@masoi/game-engine";

/**
 * Vòng đời thật của một file trace: selfplay ghi ra, trace-view đọc vào.
 *
 * Test của engine đã kiểm nhân thuần (định dạng, phép cộng số hạng, cách dựng
 * timeline). Thứ CHỈ đo được ở đây là cái vỏ: cờ CLI, đường ghi ra đĩa, và
 * việc hai script vẫn nói cùng một ngôn ngữ - đúng ranh giới mà file này canh.
 *
 * Chạy script thật qua `tsx` chứ không import hàm: hồi quy đắt nhất của một
 * công cụ CLI là kiểu "quên nối một cờ vào", và một bài test import thẳng hàm
 * sẽ không bao giờ thấy nó.
 */

const ROOT = resolve(__dirname, "..", "..", "..");
const FIXTURE = join(ROOT, "docs", "fixtures", "trace-sample.jsonl");

function run(script: string, args: readonly string[]): string {
  return execFileSync(
    process.execPath,
    [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), join(ROOT, "apps", "server", "scripts", script), ...args],
    { encoding: "utf8", cwd: ROOT },
  );
}

describe("fixture trace mẫu", () => {
  it("parse lại được và mọi số hạng vẫn cộng đúng điểm", () => {
    // Fixture là dữ liệu THẬT do `--traces` sinh ra, không phải một file dựng
    // tay. Nếu định dạng trôi lệch, chỗ này đỏ trước khi ai kịp mở nó ra đọc.
    const traces = parseTraceJsonl(readFileSync(FIXTURE, "utf8"));

    expect(traces.length).toBeGreaterThan(20);
    expect(termSumProblems(traces)).toEqual([]);
    expect(new Set(traces.map((trace) => trace.decision))).toEqual(
      new Set(["NIGHT", "SPEECH", "VOTE", "FINAL_VOTE"]),
    );
  });

  it("fixture chỉ chứa vai mà chính bot đó được phép biết", () => {
    // Ràng buộc 2 của `trace.ts`, kiểm trên một file đã nằm trong repo: một
    // fixture rò rỉ vai sẽ được chép đi khắp nơi như một mẫu ĐÚNG.
    for (const trace of parseTraceJsonl(readFileSync(FIXTURE, "utf8"))) {
      for (const id of Object.keys(trace.knowledgeSnapshot.knownRoles)) {
        expect(trace.knowledgeSnapshot.aliveIds.concat(trace.botId)).toContain(id);
      }
    }
  });

  it("trace-view chạy được trên fixture và trả lời đủ ba câu hỏi", () => {
    const out = run("trace-view.ts", [FIXTURE]);

    expect(out).toContain("46 quyết định · 6 bot · vòng 1-2");
    // belief đổi gì · bầu ai vì số hạng nào · vì sao mở miệng.
    expect(out).toContain("belief:");
    expect(out).toContain("hơn nhau ở:");
    expect(out).toMatch(/↳ (vì|bỏ cuộc):/);
  });

  it("--bot thu hẹp về đúng một bot", () => {
    const out = run("trace-view.ts", [FIXTURE, "--bot", "p4"]);

    expect(out).toContain("lọc: --bot p4");
    expect(out).toContain("BOT p4 ·");
    expect(out).not.toContain("BOT p1 ·");
  });

  it("thiếu đường dẫn thì in cách dùng chứ không im lặng", () => {
    expect(() => run("trace-view.ts", [])).toThrow(/Thiếu đường dẫn file JSONL/);
  });
});

describe("selfplay --traces", () => {
  it("ghi một file mỗi ván, tên file mang seed, và tôn trọng trần", () => {
    const dir = mkdtempSync(join(tmpdir(), "masoi-traces-"));
    try {
      run("selfplay.ts", [
        "--seed",
        "cli:test",
        "--games",
        "3",
        "--players",
        "6",
        "--trace-games",
        "2",
        "--traces",
        dir,
        "--quiet",
      ]);

      // Ba ván chạy, hai ván được ghi: trần là thứ giữ cho một batch nghìn ván
      // không đổ vài GB xuống đĩa.
      expect(readdirSync(dir).sort()).toEqual(["cli-test-0.jsonl", "cli-test-1.jsonl"]);

      const traces = parseTraceJsonl(readFileSync(join(dir, "cli-test-0.jsonl"), "utf8"));
      expect(traces.length).toBeGreaterThan(0);
      expect(termSumProblems(traces)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("KHÔNG có --traces thì `--trace-games` một mình không thu gì cả", () => {
    // Ràng buộc 1 nhìn từ phía người dùng. `--trace-games` một mình KHÔNG được
    // trả giá bộ nhớ cho một tập trace, vì không có chỗ nào để đọc nó ra - và
    // cách duy nhất người dùng biết điều đó đã đúng là lời báo cuối im lặng.
    const out = run("selfplay.ts", [
      "--seed",
      "off",
      "--games",
      "2",
      "--players",
      "6",
      "--trace-games",
      "2",
    ]);

    expect(out).toContain("Theo vai");
    expect(out).not.toContain("Đã ghi trace");
  });

  it("--traces vẫn cho ra ĐÚNG báo cáo như khi tắt", () => {
    // Nếu sai, mọi buổi tuning chạy kèm `--traces` đang đọc trace của một ván
    // và report của một ván khác. `timing` và `commit` bị bỏ ra vì cả hai đều
    // là I/O do CLI bơm vào và cả hai đều không tất định.
    const dir = mkdtempSync(join(tmpdir(), "masoi-same-"));
    const args = ["--seed", "cmp", "--games", "2", "--players", "6", "--quiet"];
    try {
      const strip = (raw: string): unknown => {
        const report = JSON.parse(raw) as Record<string, unknown>;
        delete report.timing;
        delete report.commit;
        return report;
      };

      expect(strip(run("selfplay.ts", [...args, "--traces", dir, "--trace-games", "2"]))).toEqual(
        strip(run("selfplay.ts", args)),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}, 120_000);
