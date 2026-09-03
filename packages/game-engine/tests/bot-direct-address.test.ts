import { describe, expect, it } from "vitest";
import { analyzeChat } from "../src/bot/analysis/chat-analysis";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import type {
  BotChatObservation,
  BotDecisionContext,
  BotMemoryType,
  BotPlayerKnowledge,
} from "../src/bot/types";

const PLAYERS: BotPlayerKnowledge[] = [
  { id: "p1", name: "An", alive: true },
  { id: "p2", name: "Bình", alive: true },
  { id: "p3", name: "Chi", alive: true },
];

/** Hai người trùng tên rút gọn: parser phải im lặng thay vì đoán. */
const AMBIGUOUS: BotPlayerKnowledge[] = [
  { id: "p1", name: "Nguyễn An", alive: true },
  { id: "p2", name: "Trần An", alive: true },
];

function message(text: string, actorId = "p2", id = "m1"): BotChatObservation {
  return { id, actorId, text, at: 0 };
}

function typesOf(text: string, players = PLAYERS): BotMemoryType[] {
  return analyzeChat([message(text)], players).map((memory) => memory.type);
}

function targetOf(text: string, type: BotMemoryType): string | undefined {
  return analyzeChat([message(text)], PLAYERS).find((memory) => memory.type === type)?.targetId;
}

describe("nhận diện lời nói nhắm thẳng vào một người", () => {
  it("gọi tên kèm dấu hỏi là một câu hỏi trực tiếp", () => {
    expect(typesOf("An ơi sao lúc nãy bạn đổi phiếu thế?")).toContain("DIRECT_QUESTION");
    expect(targetOf("An ơi sao lúc nãy bạn đổi phiếu thế?", "DIRECT_QUESTION")).toBe("p1");
  });

  it("gọi tên không hỏi chỉ là lời nhắm tới, không phải câu hỏi", () => {
    const types = typesOf("An giải thích đi");
    expect(types).toContain("DIRECT_ADDRESS");
    expect(types).not.toContain("DIRECT_QUESTION");
  });

  it("từ để hỏi không cần dấu chấm hỏi", () => {
    // Người chat game bỏ dấu câu liên tục; bắt buộc có "?" sẽ bỏ sót phần lớn
    // câu hỏi thật. Người nói là p3 (Chi) để không rơi vào luật "tự nêu tên mình".
    expect(typesOf("bằng chứng đâu An")).toContain("DIRECT_QUESTION");
    expect(
      analyzeChat([message("tại sao Bình lại im lặng", "p3")], PLAYERS).map((m) => m.type),
    ).toContain("DIRECT_QUESTION");
  });

  it("câu không nêu tên ai thì không sinh gì", () => {
    expect(typesOf("thế này thì chịu rồi")).toEqual([]);
    expect(typesOf("ai là sói vậy?")).toEqual([]);
  });

  it("tên khớp không duy nhất thì bỏ qua, không đoán bừa", () => {
    expect(typesOf("An nói xem nào?", AMBIGUOUS)).toEqual([]);
  });

  it("một câu vừa buộc tội vừa hỏi thì sinh CẢ HAI, không loại trừ nhau", () => {
    // "Tôi nghi An?" là một cáo buộc có thật và cũng là một câu nhắm vào An.
    // Gộp chúng lại sẽ mất một trong hai, và mất cái nào cũng sai.
    const types = typesOf("tôi nghi An, đúng không An?");
    expect(types).toContain("ACCUSE");
    expect(types).toContain("DIRECT_QUESTION");
  });

  it("chỉ sinh MỘT bản ghi cho mỗi loại trên một tin nhắn", () => {
    const memories = analyzeChat([message("An ơi An nghĩ sao An?")], PLAYERS);
    expect(memories.filter((item) => item.type === "DIRECT_QUESTION")).toHaveLength(1);
  });

  it("người gửi tự nêu tên mình không tạo lời nhắm tới chính mình", () => {
    // "Bình đây, tôi thấy lạ" không phải là Bình đang hỏi Bình.
    expect(analyzeChat([message("Bình đây, tôi thấy lạ", "p2")], PLAYERS)).toEqual([]);
  });
});

describe("lời nhắm tới KHÔNG phải bằng chứng", () => {
  const context = (chat: BotChatObservation[]): BotDecisionContext => ({
    knowledge: {
      dayOfTruthClaims: {},
      activeEventId: null,
      neutralRolesInPlay: [],
      botId: "p1",
      round: 1,
      phase: "DAY_DISCUSSION",
      phaseStartedAt: 0,
      phaseEndsAt: null,
      selfRole: "VILLAGER",
      players: PLAYERS,
      knownRoles: {},
      seerResult: null,
      night: null,
      trialAccusedId: null,
      canFinalVote: false,
      hunterShot: null,
      publicVoteHistory: [],
      currentVoteCounts: { players: {}, noElimination: 0 },
      hasVoted: false,
      myVote: null,
      legalVoteChoices: [],
      lastNightDeaths: [],
    },
    visibleChat: chat,
  });

  it("một câu hỏi không làm ai đáng nghi hơn", () => {
    // Đây là ranh giới của parser bảo thủ. Một câu hỏi không nói lên ai là Sói;
    // biến nó thành evidence sẽ đổi belief, đổi phiếu, và đổi cân bằng ván đấu
    // vì một lý do không liên quan gì tới việc chơi hay.
    const runtime = new BotRuntime({
      playerId: "p1",
      rng: createSeededRng("no-belief-drift"),
      playerIds: ["p1", "p2", "p3"],
    });

    // So ĐIỂM SỐ và LÝ DO, không so cả entry: `observe` chạy một lượt decay mỗi
    // vòng và lượt đó chạm `lastUpdatedRound` của mọi người. Decay là hành vi
    // của thời gian, không phải của câu hỏi.
    const scores = (): string =>
      JSON.stringify({
        suspicion: Object.entries(runtime.state.suspicion).map(([id, entry]) => [
          id,
          entry.score,
          entry.reasons.length,
        ]),
        trust: Object.entries(runtime.state.trust).map(([id, entry]) => [
          id,
          entry.score,
          entry.reasons.length,
        ]),
        relationships: runtime.state.relationships,
      });

    const before = scores();
    runtime.observe(context([message("An ơi bạn nghĩ sao?", "p2", "q1")]));
    expect(scores()).toBe(before);
  });

  it("nhưng vẫn được ghi vào memory để còn biết mình bị hỏi", () => {
    const runtime = new BotRuntime({
      playerId: "p1",
      rng: createSeededRng("remembers-question"),
      playerIds: ["p1", "p2", "p3"],
    });
    runtime.observe(context([message("An ơi bạn nghĩ sao?", "p2", "q1")]));

    const asked = runtime.state.memories.find((item) => item.type === "DIRECT_QUESTION");
    expect(asked).toBeDefined();
    expect(asked!.actorId).toBe("p2");
    expect(asked!.targetId).toBe("p1");
    expect(asked!.sourceId).toBe("q1");
  });

  it("memory không chứa nguyên văn câu chat", () => {
    const memories = analyzeChat([message("An ơi cái câu rất riêng này?")], PLAYERS);
    expect(JSON.stringify(memories)).not.toContain("cái câu rất riêng này");
  });
});
