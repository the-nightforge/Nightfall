import { describe, expect, it } from "vitest";
import { runSelfPlay, type SelfPlayEvent, type SelfPlayGame } from "../src/bot/evaluation/selfplay";
import { DEFAULT_BOT_WEIGHTS, BOT_WEIGHTS_V2 } from "../src/bot/config/weights";

type Speech = Extract<SelfPlayEvent, { kind: "SPEECH" }>;

const SEEDS = Array.from({ length: 20 }, (_, i) => `p4-conv-${i}`);

function speeches(game: SelfPlayGame): Speech[] {
  return game.events.filter((event): event is Speech => event.kind === "SPEECH");
}

const GAMES = SEEDS.map((seed) => runSelfPlay({ seed }));
const ALL_SPEECH = GAMES.flatMap(speeches);

describe("hội thoại nhiều lượt trong self-play", () => {
  it("thật sự có người nói", () => {
    expect(ALL_SPEECH.length).toBeGreaterThan(100);
  });

  it("xuất hiện đủ các hành vi hội thoại mới", () => {
    // Nếu thiếu, nghĩa là một nhánh của planner chưa từng chạy trong ván thật -
    // đúng loại bug mà chỉ một batch mới lộ ra (xem Phase 3, mục bussing).
    const kinds = new Set(ALL_SPEECH.map((event) => event.speech));
    for (const kind of ["AGREE", "DISAGREE", "REPLY", "CHALLENGE"]) {
      expect(kinds, kind).toContain(kind);
    }
  });

  it("có người thật sự trả lời một câu cụ thể", () => {
    const replies = ALL_SPEECH.filter((event) => event.replyToMessageId !== null);
    expect(replies.length).toBeGreaterThan(0);
    for (const reply of replies) {
      expect(reply.chainDepth).toBeGreaterThanOrEqual(1);
    }
  });

  it("không BOT nào vượt hạn mức tin nhắn mỗi vòng", () => {
    const limit = DEFAULT_BOT_WEIGHTS.conversation.messagesPerBotPerRound;
    for (const game of GAMES) {
      const counts = new Map<string, number>();
      for (const event of speeches(game)) {
        const key = `${event.round}:${event.actorId}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const [key, count] of counts) {
        expect(count, `${game.record.seed} ${key}`).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("không có chuỗi đối đáp chạy vô hạn", () => {
    const limit = DEFAULT_BOT_WEIGHTS.conversation.maxChainDepth;
    for (const event of ALL_SPEECH) {
      expect(event.chainDepth).toBeLessThanOrEqual(limit);
    }
  });

  it("một câu không kéo theo quá nhiều phản hồi", () => {
    const limit = DEFAULT_BOT_WEIGHTS.conversation.maxRepliesPerMessage;
    for (const game of GAMES) {
      const replies = new Map<string, number>();
      for (const event of speeches(game)) {
        if (event.replyToMessageId === null) continue;
        replies.set(event.replyToMessageId, (replies.get(event.replyToMessageId) ?? 0) + 1);
      }
      for (const [id, count] of replies) {
        expect(count, `${game.record.seed} ${id}`).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("không ai lặp NGUYÊN VĂN câu liền trước của chính mình", () => {
    for (const game of GAMES) {
      const last = new Map<string, string>();
      for (const event of speeches(game)) {
        expect(last.get(event.actorId), `${game.record.seed} ${event.actorId}`).not.toBe(
          event.text,
        );
        last.set(event.actorId, event.text);
      }
    }
  });

  it("lời nói của người khác thật sự đi vào memory", () => {
    // Không có khẳng định này thì cả tầng hội thoại có thể chỉ là ghi log.
    const game = runSelfPlay({ seed: "chat-into-memory", trace: true });
    const chatIds = new Set(speeches(game).map((event) => event.messageId));
    expect(chatIds.size).toBeGreaterThan(0);

    const accusationsFromChat = game.events.filter(
      (event) => event.kind === "VOTE" && event.evidence.length > 0,
    );
    expect(accusationsFromChat.length).toBeGreaterThan(0);
  });

  it("mỗi câu mang đủ dữ liệu để đo lặp", () => {
    for (const event of ALL_SPEECH) {
      expect(event.text.trim().length).toBeGreaterThan(0);
      expect(event.textFingerprint).toMatch(/^[0-9a-f]{8}$/);
      expect(event.semanticFingerprint).toMatch(/^[0-9a-f]{8}$/);
      expect(event.messageId.length).toBeGreaterThan(0);
    }
  });

  it("không có vi phạm ranh giới hiểu biết hay ranh giới lời nói", () => {
    for (const game of GAMES) {
      expect({
        seed: game.record.seed,
        violations: game.violations.map((item) => item.id),
      }).toEqual({ seed: game.record.seed, violations: [] });
    }
  });

  it("cùng seed cho ra cùng chuỗi lời nói, từng chữ", () => {
    const fingerprint = (game: SelfPlayGame): string =>
      speeches(game)
        .map(
          (event) =>
            `${event.round}|${event.actorId}|${event.speech}|${event.targetId ?? "-"}|${
              event.replyToMessageId ?? "-"
            }|${event.text}`,
        )
        .join("\n");

    expect(fingerprint(runSelfPlay({ seed: "conv-replay" }))).toBe(
      fingerprint(runSelfPlay({ seed: "conv-replay" })),
    );
  });

  it("tắt lời nói thì không có câu nào, và ván vẫn sạch", () => {
    const silent = runSelfPlay({ seed: "conv-silent", speech: false });
    expect(speeches(silent)).toEqual([]);
    expect(silent.violations).toEqual([]);
  });

  it("cấu hình v2 vẫn chạy đúng một lượt nói mỗi vòng", () => {
    // Mốc lịch sử phải giữ nguyên hành vi, nếu không thì bảng so sánh của
    // Phase 3 mất giá trị.
    const game = runSelfPlay({ seed: "v2-single-turn", weights: BOT_WEIGHTS_V2 });
    const counts = new Map<string, number>();
    for (const event of speeches(game)) {
      const key = `${event.round}:${event.actorId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const count of counts.values()) expect(count).toBe(1);
    expect(speeches(game).every((event) => event.replyToMessageId === null)).toBe(true);
  });
});
