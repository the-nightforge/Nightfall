import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildReport,
  formatReportText,
  runBatch,
  seedFor,
  type SelfPlayBatchInput,
} from "../src/bot/evaluation/report";
import { BOT_WEIGHTS_V1 } from "../src/bot/config/weights";

const BATCH: SelfPlayBatchInput = {
  seedBase: "report",
  games: 8,
  weights: BOT_WEIGHTS_V1,
};

function report(over: Partial<SelfPlayBatchInput> = {}) {
  const input = { ...BATCH, ...over };
  return buildReport(input, runBatch(input));
}

describe("builder là thuần", () => {
  it("timing và commit là null; chúng là I/O nên CLI phải bơm vào sau", () => {
    const built = report();
    expect(built.timing).toBeNull();
    expect(built.commit).toBeNull();
  });

  it("cùng batch cho report giống hệt nhau", () => {
    // Trừ đúng hai trường không tất định, vốn đã là `null` ở đây.
    expect(JSON.stringify(report())).toBe(JSON.stringify(report()));
  });

  it("không đọc đồng hồ thật", () => {
    const first = JSON.stringify(report());
    const busy = Date.now();
    while (Date.now() - busy < 5) {
      /* đợi đồng hồ tường nhích */
    }
    expect(JSON.stringify(report())).toBe(first);
  });
});

describe("nội dung report", () => {
  it("ghi lại cấu hình và khoảng seed đủ để dựng lại batch", () => {
    const built = report();
    expect(built.schemaVersion).toBe(1);
    expect(built.weightsVersion).toBe("1.0.0");
    expect(built.seedRange).toEqual({ first: "report:0", last: "report:7" });
    expect(built.games).toBe(8);
    expect(built.config.playerCount).toBe(8);
  });

  it("seedFor khớp với seed thật mà kernel dùng", () => {
    // Nếu hai chỗ này lệch nhau, mọi lệnh replay in ra đều trỏ sai ván.
    const input = { ...BATCH, games: 3 };
    const games = runBatch(input);
    expect(games.map((game) => game.record.seed)).toEqual([
      seedFor("report", 0),
      seedFor("report", 1),
      seedFor("report", 2),
    ]);
  });

  it("batch sạch thì không có seed thất bại", () => {
    const built = report();
    expect(built.violations).toEqual([]);
    expect(built.failedSeeds).toEqual([]);
  });

  it("seed thất bại kèm lệnh chạy lại được", () => {
    const built = report({ maxRounds: 1, games: 2 });
    expect(built.failedSeeds).toHaveLength(2);
    for (const failure of built.failedSeeds) {
      expect(failure.reason).toContain("ROUND_LIMIT");
      expect(failure.replay).toContain(`--seed ${failure.seed}`);
      expect(failure.replay).toContain("--max-rounds 1");
    }
  });

  it("verifyReplay không sinh phân kỳ trên một nhân tất định", () => {
    const built = report({ verifyReplay: true, games: 4 });
    expect(built.violations.filter((item) => item.id === "REPLAY_DIVERGENCE")).toEqual([]);
  });

  it("có chỉ số theo phe và theo vai", () => {
    const built = report();
    expect(Object.keys(built.metricsByTeam).sort()).toEqual(["village", "wolves"]);
    expect(built.metricsByRole.length).toBeGreaterThan(0);
    expect(built.metricsByRole.map((item) => item.role)).toEqual(
      [...built.metricsByRole.map((item) => item.role)].sort(),
    );
  });
});

describe("bản tóm tắt cho người đọc", () => {
  const text = formatReportText(report());

  it("nêu đủ mọi chỉ số bắt buộc", () => {
    for (const label of [
      "Dân thắng",
      "Sói thắng",
      "Số vòng trung bình",
      "Dân bỏ phiếu trúng Sói",
      "Sói tố/bầu đồng bọn",
      "Đổi phiếu",
      "Đồng thuận",
      "Gắn kết coalition",
      "Bằng chứng hết hạn",
      "Lặp lời thoại",
      "Chạm trần vòng",
      "Vi phạm ranh giới hiểu biết",
      "Nước đi bị engine từ chối",
    ]) {
      expect(text).toContain(label);
    }
  });

  it("mọi tỉ lệ in ra đều kèm mẫu số", () => {
    // Một con số phần trăm không có mẫu số trông y hệt một con số đáng tin.
    for (const line of text.split("\n")) {
      if (!line.includes("%")) continue;
      expect(line).toMatch(/\(\d+\/\d+\)/);
    }
  });

  it("nói rõ khi chưa đo được, thay vì in 0%", () => {
    const empty = formatReportText(buildReport({ ...BATCH, games: 0 }, []));
    expect(empty).toContain("n/a");
  });
});

describe("fixture mẫu", () => {
  const path = resolve(__dirname, "../../../docs/fixtures/selfplay-sample.json");

  it("khớp schema hiện hành và tái lập được", () => {
    // Fixture pin SCHEMA, không pin số liệu của một lần chạy may mắn: nó được
    // sinh lại từ chính cùng batch, nên nó không thể trôi lệch âm thầm.
    const fixture = JSON.parse(readFileSync(path, "utf8")) as ReturnType<typeof buildReport>;
    const input: SelfPlayBatchInput = {
      seedBase: fixture.seedBase,
      games: fixture.games,
      weights: BOT_WEIGHTS_V1,
    };
    const rebuilt = buildReport(input, runBatch(input));

    expect(fixture.schemaVersion).toBe(1);
    expect(Object.keys(fixture).sort()).toEqual(Object.keys(rebuilt).sort());
    expect(fixture.metrics).toEqual(rebuilt.metrics);
    expect(fixture.metricsByRole).toEqual(rebuilt.metricsByRole);
  });

  it("nhỏ, vì report lớn không được commit", () => {
    expect(readFileSync(path, "utf8").length).toBeLessThan(20_000);
  });
});
