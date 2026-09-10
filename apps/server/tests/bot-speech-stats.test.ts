import { describe, expect, it } from "vitest";
import { deriveSpeechStyle, describeSpeechStyle } from "@masoi/game-engine";
import type { BotPersonality } from "@masoi/game-engine";
import { renderBotSpeech } from "../src/bots/speech-renderer";
import { DURATION_BUCKETS_MS, SpeechStats } from "../src/bots/speech-stats";
import { decided, failed, nothingToDo, type BotBrain, type SpeechRequest } from "../src/bots/types";

/**
 * Thống kê vận hành của tầng diễn đạt: `fromTemplate` phải là một phép ĐẾM
 * có thật ở production, và mỗi lượt phải nói được vì sao nó rơi về bảng mẫu.
 */

const PERSONALITY: BotPersonality = {
  aggressiveness: 0.7,
  talkativeness: 0.8,
  riskTolerance: 0.4,
  deceptionSkill: 0.3,
  analyticalSkill: 0.9,
  loyalty: 0.5,
  stubbornness: 0.2,
};

function request(over: Partial<SpeechRequest> = {}): SpeechRequest {
  const style = deriveSpeechStyle(PERSONALITY);
  return {
    roomCode: "ROOM1",
    speaker: { id: "bot", name: "An" },
    style,
    styleDescription: describeSpeechStyle(style),
    intention: {
      kind: "ACCUSE",
      targetId: "c",
      confidence: 0.8,
      tone: "FIRM",
      topic: "SUSPICION",
      evidence: [],
    },
    evidence: [],
    targetName: "Chi",
    replyTo: null,
    recentOwnLines: [],
    chatWindow: [],
    avoidOpenings: [],
    recentSpeechSourceIds: [],
    seq: 0,
    round: 1,
    players: [
      { id: "bot", name: "An", alive: true },
      { id: "c", name: "Chi", alive: true },
    ],
    defense: null,
    ...over,
  };
}

const failing: BotBrain = { name: "always-fails", renderDaySpeech: async () => failed() };
const silent: BotBrain = { ...failing, renderDaySpeech: async () => nothingToDo() };
function speaking(chat: string): BotBrain {
  return { ...failing, renderDaySpeech: async () => decided({ chat }) };
}

/** Đồng hồ giả: mỗi lần đọc tiến thêm `stepMs`. */
function clock(stepMs: number): () => number {
  let now = 0;
  return () => {
    const value = now;
    now += stepMs;
    return value;
  };
}

describe("SpeechStats", () => {
  it("bắt đầu rỗng và nói rõ là chưa đo được, không phải 0%", () => {
    const stats = new SpeechStats().snapshot();
    expect(stats.total).toBe(0);
    expect(stats.fromTemplateRate).toBeNull();
    expect(stats.meanDurationMs).toBeNull();
    expect(stats.durationHistogramMs).toHaveLength(DURATION_BUCKETS_MS.length + 1);
    expect(stats.durationHistogramMs.at(-1)?.upTo).toBeNull();
  });

  it("đếm nguồn, tỉ lệ mẫu và histogram thời gian", () => {
    const stats = new SpeechStats();
    stats.record("provider", 120, "ừ t nghi Chi");
    stats.record("provider_retry", 3_000, "khoan, ko hẳn đâu");
    stats.record("provider_failed", 9_500, "Tôi nghi Chi vì lá phiếu đổi sát giờ chốt.");
    stats.record("gate_rejected", 700, "Tôi vẫn giữ nguyên ý kiến của mình về Chi.");
    stats.record("template_silent", 0, null);
    const snap = stats.snapshot();
    expect(snap.total).toBe(5);
    // Hai nguồn nhà cung cấp không tính là mẫu; ba nguồn còn lại thì có.
    expect(snap.fromTemplate).toBe(3);
    expect(snap.fromTemplateRate).toBeCloseTo(3 / 5);
    expect(snap.bySource).toEqual({
      provider: 1,
      provider_retry: 1,
      provider_failed: 1,
      gate_rejected: 1,
      template_silent: 1,
    });
    expect(snap.maxDurationMs).toBe(9_500);
    expect(snap.meanDurationMs).toBeCloseTo((120 + 3_000 + 9_500 + 700) / 5);
    // 0 và 120 -> ngăn ≤250; 700 -> ≤1000; 3000 -> ≤4000; 9500 -> trên hết.
    expect(snap.durationHistogramMs.map((b) => b.count)).toEqual([2, 0, 1, 0, 1, 0, 1]);
  });

  it("chấm giọng từng câu, và lượt IM không có câu nào để chấm", () => {
    const stats = new SpeechStats();
    stats.record("provider", 120, "ừ t nghi Chi");
    stats.record("provider_retry", 300, "khoan, ko hẳn đâu");
    stats.record("provider_failed", 300, "Tôi nghi Chi vì lá phiếu đổi sát giờ chốt.");
    stats.record("gate_rejected", 300, "Tôi vẫn giữ nguyên ý kiến của mình về Chi.");
    stats.record("template_silent", 0, null);

    const snap = stats.snapshot();
    // 5 lượt, 4 câu: lượt im không vào mẫu số.
    expect(snap.total).toBe(5);
    expect(snap.spoken).toBe(4);
    expect(snap.casual).toBe(2);
    expect(snap.casualToneRate).toBeCloseTo(2 / 4);
    expect(snap.casualBySource).toEqual({
      provider: 1,
      provider_retry: 1,
      provider_failed: 0,
      gate_rejected: 0,
      template_silent: 0,
    });
  });

  it("chưa câu nào phát ra thì tỉ lệ giọng là null, không phải 0", () => {
    // "Chưa đo được" và "đo được 0%" là hai chuyện khác nhau, và một cái 0 ở đây
    // sẽ trông như nhà cung cấp đang viết văn - đúng lúc nó chưa nói câu nào.
    const stats = new SpeechStats();
    expect(stats.snapshot().casualToneRate).toBeNull();
    stats.record("template_silent", 0, null);
    expect(stats.snapshot().casualToneRate).toBeNull();
  });

  it("tỉ lệ GỘP trôi khi nhà cung cấp chết; chia theo nguồn thì lộ ra", () => {
    // Đây là lý do `casualBySource` tồn tại, không phải một con số gộp.
    //
    // Bảng mẫu đo được ~0,90 sau khi bỏ dấu chấm cuối. Nên khi nhà cung cấp
    // hỏng lặng lẽ và mọi thứ rơi về bảng mẫu, tỉ lệ GỘP đi LÊN - nó trông y
    // hệt một cải thiện, đúng lúc đường chạy chính vừa chết.
    const stats = new SpeechStats();
    // Nhà cung cấp đang chạy, giọng tệ.
    for (let i = 0; i < 8; i += 1) {
      stats.record("provider", 200, "Tôi nghi Chi vì lá phiếu đổi sát giờ chốt.");
    }
    const healthy = stats.snapshot();

    // Nhà cung cấp chết; bảng mẫu tiếp quản, giọng tốt.
    for (let i = 0; i < 32; i += 1) stats.record("provider_failed", 5, "t nghi Chi");
    const dead = stats.snapshot();

    // Con số gộp ĐI LÊN - nếu chỉ có nó thì không ai thấy gì bất thường.
    expect(dead.casualToneRate!).toBeGreaterThan(healthy.casualToneRate!);
    // Chia theo nguồn: `provider` đứng im trong khi `provider_failed` vọt lên.
    expect(dead.casualBySource.provider).toBe(healthy.casualBySource.provider);
    expect(dead.casualBySource.provider_failed).toBe(32);
    expect(dead.bySource.provider).toBe(8);
  });

  it("bộ nhớ cố định: snapshot không lớn theo số lượt", () => {
    const stats = new SpeechStats();
    const before = JSON.stringify(stats.snapshot()).length;
    for (let i = 0; i < 10_000; i += 1) stats.record("provider", i % 5_000, "t nghi Chi");
    const after = JSON.stringify(stats.snapshot()).length;
    // Chỉ chữ số dài ra, không có mảng nào mọc thêm phần tử.
    expect(after - before).toBeLessThan(60);
    expect(stats.snapshot().durationHistogramMs).toHaveLength(DURATION_BUCKETS_MS.length + 1);
  });

  it("thời gian âm hoặc NaN được ghi là 0 thay vì làm hỏng tổng", () => {
    const stats = new SpeechStats();
    stats.record("provider", Number.NaN, "t nghi Chi");
    stats.record("provider", -5, "t nghi Chi");
    expect(stats.snapshot().meanDurationMs).toBe(0);
  });
});

describe("renderBotSpeech ghi nguồn và thời gian", () => {
  it("nhà cung cấp trả câu qua cổng -> `provider`, đo trọn lượt", async () => {
    const stats = new SpeechStats();
    const result = await renderBotSpeech(
      request(),
      speaking("Chi đổi phiếu sát giờ chót."),
      300,
      stats,
      clock(40),
    );
    expect(result.source).toBe("provider");
    expect(result.fromTemplate).toBe(false);
    const snap = stats.snapshot();
    expect(snap.total).toBe(1);
    expect(snap.fromTemplate).toBe(0);
    expect(snap.maxDurationMs).toBe(40);
  });

  it("nhà cung cấp hỏng -> `provider_failed`, câu vẫn là mẫu", async () => {
    const stats = new SpeechStats();
    const result = await renderBotSpeech(request(), failing, 300, stats);
    expect(result.source).toBe("provider_failed");
    expect(result.fromTemplate).toBe(true);
    expect(result.text).toContain("Chi");
    expect(stats.snapshot().bySource.provider_failed).toBe(1);
  });

  it("nhà cung cấp im (value null) cũng là `provider_failed`", async () => {
    const stats = new SpeechStats();
    const result = await renderBotSpeech(request(), silent, 300, stats);
    expect(result.source).toBe("provider_failed");
  });

  it("nhà cung cấp trả câu nhưng nhại lại chính mình hai lần -> `gate_rejected`", async () => {
    const stats = new SpeechStats();
    const own = "Tôi thấy Chi rất đáng ngờ.";
    const result = await renderBotSpeech(
      request({ recentOwnLines: [own] }),
      speaking(own),
      300,
      stats,
    );
    expect(result.source).toBe("gate_rejected");
    expect(result.fromTemplate).toBe(true);
    expect(result.text).not.toBe(own);
  });

  it("lượt hỏi lại qua cổng -> `provider_retry`, không tính là mẫu", async () => {
    const stats = new SpeechStats();
    const own = "Tôi thấy Chi rất đáng ngờ.";
    let calls = 0;
    const secondTry: BotBrain = {
      ...failing,
      renderDaySpeech: async () => {
        calls += 1;
        return decided({ chat: calls === 1 ? own : "Chi đổi phiếu sát giờ chót, giải thích đi." });
      },
    };
    const result = await renderBotSpeech(request({ recentOwnLines: [own] }), secondTry, 300, stats);
    expect(result.source).toBe("provider_retry");
    expect(result.fromTemplate).toBe(false);
    expect(stats.snapshot().fromTemplate).toBe(0);
  });

  it("mỗi lượt diễn đạt ghi ĐÚNG một dòng, kể cả khi nhà cung cấp ném", async () => {
    const stats = new SpeechStats();
    const throwing: BotBrain = {
      ...failing,
      renderDaySpeech: async () => {
        throw new Error("boom");
      },
    };
    await renderBotSpeech(request(), throwing, 300, stats);
    await renderBotSpeech(request(), speaking("Chi đổi phiếu."), 300, stats);
    expect(stats.snapshot().total).toBe(2);
  });
});

/**
 * Giọng của ĐƯỜNG THẬT, không phải của một `SpeechStats` gọi tay.
 *
 * Đây là chỗ duy nhất khẳng định `renderBotSpeech` có chuyển câu chữ vào tầng
 * đo hay không. Thiếu nó thì `casualToneRate` ở `/api/health` có thể đứng yên ở
 * `null` suốt đời mà mọi test khác vẫn xanh.
 */
describe("renderBotSpeech ghi giọng của câu đã phát", () => {
  it("câu bảng mẫu được chấm giọng, và vào đúng ngăn nguồn của nó", async () => {
    const stats = new SpeechStats();
    await renderBotSpeech(request(), failing, 300, stats);
    const snap = stats.snapshot();
    expect(snap.spoken).toBe(1);
    // Bảng mẫu sau khi bỏ dấu chấm cuối đo được ~0,90 `looksCasual`; một câu
    // ACCUSE ngắn nằm chắc trong phần đó.
    expect(snap.casual).toBe(1);
    expect(snap.casualBySource.provider_failed).toBe(1);
    expect(snap.casualBySource.provider).toBe(0);
  });

  it("câu văn viết của nhà cung cấp KHÔNG được tính là giọng chat", async () => {
    // Đúng kiểu câu mà ván thật đã cho ra và không chỉ số nào bắt được.
    const stats = new SpeechStats();
    const result = await renderBotSpeech(
      request(),
      speaking("Mình đang nghi Chi nhất, bạn nói rõ căn cứ đi, đừng né."),
      300,
      stats,
    );
    expect(result.source).toBe("provider");
    const snap = stats.snapshot();
    expect(snap.spoken).toBe(1);
    expect(snap.casual).toBe(0);
    expect(snap.casualToneRate).toBe(0);
  });

  it("lượt IM không kéo tỉ lệ giọng xuống", async () => {
    // `template_silent` không có câu nào; tính nó vào mẫu số sẽ biến một BOT
    // đang im lặng đúng luật thành một BOT đang viết văn.
    const stats = new SpeechStats();
    await renderBotSpeech(request({ targetName: null }), failing, 300, stats);
    const snap = stats.snapshot();
    expect(snap.bySource.template_silent).toBe(1);
    expect(snap.spoken).toBe(0);
    expect(snap.casualToneRate).toBeNull();
  });
});
