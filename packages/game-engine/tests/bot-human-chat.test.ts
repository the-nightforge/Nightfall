import { describe, expect, it } from "vitest";
import { measureHumanChat } from "../src/bot/evaluation/human-chat";
import {
  HUMAN_ACCUSATIONS,
  HUMAN_CHAT_PLAYERS,
  HUMAN_CLAIMS,
  HUMAN_DEFENCES,
  HUMAN_TRAPS,
} from "../src/bot/evaluation/human-chat-corpus";
import { collectMetrics } from "../src/bot/evaluation/metrics";
import { buildReport, formatReportText } from "../src/bot/evaluation/report";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";

/**
 * P0.3: "bot nghe được người" phải là một CON SỐ trong báo cáo, và con số đó
 * phải có ngưỡng. Corpus là mẫu viết tay theo cách người chơi gõ; xem
 * `human-chat-corpus.ts` cho lý do và cho việc thay bằng log thật.
 */
describe("corpus câu người thật", () => {
  it("đủ lớn để con số có nghĩa", () => {
    expect(HUMAN_ACCUSATIONS.length).toBeGreaterThanOrEqual(40);
    expect(HUMAN_DEFENCES.length).toBeGreaterThanOrEqual(15);
    expect(HUMAN_CLAIMS.length).toBeGreaterThanOrEqual(15);
    expect(HUMAN_TRAPS.length).toBeGreaterThanOrEqual(20);
  });

  it("mọi kỳ vọng đều trỏ tới một người có thật trong bàn mẫu", () => {
    const ids = new Set(HUMAN_CHAT_PLAYERS.map((player) => player.id));
    for (const sample of [...HUMAN_ACCUSATIONS, ...HUMAN_DEFENCES]) {
      expect(sample.expect.type === "ROLE_CLAIM" || ids.has(sample.expect.targetId), sample.text).toBe(
        true,
      );
    }
  });

  it("không có câu nào vừa là mẫu vừa là bẫy", () => {
    const traps = new Set(HUMAN_TRAPS);
    for (const sample of [...HUMAN_ACCUSATIONS, ...HUMAN_DEFENCES, ...HUMAN_CLAIMS]) {
      expect(traps.has(sample.text), sample.text).toBe(false);
    }
  });
});

describe("humanAccuseSeenRate", () => {
  const measure = measureHumanChat();

  it("bot thấy hơn 80% lời buộc tội của người thật", () => {
    expect(measure.accuseSeen / measure.accuseTotal, measure.missed.join(" | ")).toBeGreaterThan(0.8);
  });

  it("thấy phần lớn lời bênh vực và gần hết lời khai vai", () => {
    expect(measure.defendSeen / measure.defendTotal).toBeGreaterThan(0.8);
    expect(measure.claimSeen / measure.claimTotal).toBeGreaterThan(0.9);
  });

  it("KHÔNG câu bẫy nào lọt thành bằng chứng", () => {
    expect(measure.leaked).toEqual([]);
    expect(measure.trapIgnored).toBe(measure.trapTotal);
  });

  it("là hàm thuần: hai lần đo cho cùng một kết quả", () => {
    expect(measureHumanChat()).toEqual(measure);
  });
});

describe("báo cáo self-play mang chỉ số nghe người", () => {
  const games = [runSelfPlay({ seed: "human-chat-report", playerCount: 8, maxRounds: 20 })];

  it("collectMetrics điền bốn tỉ lệ, với mẫu số là cỡ corpus", () => {
    const { overall } = collectMetrics(games);
    expect(overall.humanAccuseSeenRate.denominator).toBe(HUMAN_ACCUSATIONS.length);
    expect(overall.humanDefendSeenRate.denominator).toBe(HUMAN_DEFENCES.length);
    expect(overall.humanClaimSeenRate.denominator).toBe(HUMAN_CLAIMS.length);
    expect(overall.humanTrapIgnoredRate.denominator).toBe(HUMAN_TRAPS.length);
    expect(overall.humanAccuseSeenRate.value).toBeGreaterThan(0.8);
  });

  it("bản in có mục riêng và không gắn cờ khi đạt ngưỡng", () => {
    const text = formatReportText(
      buildReport({ seedBase: "human-chat-report", games: 1, playerCount: 8 }, games),
    );
    expect(text).toContain("── Nghe người thật");
    const line = text.split("\n").find((row) => row.includes("Thấy lời buộc tội"));
    expect(line).toBeDefined();
    expect(line).not.toContain("⚠");
    const trap = text.split("\n").find((row) => row.includes("Bỏ qua câu bẫy"));
    expect(trap).toContain("100.0%");
  });
});
