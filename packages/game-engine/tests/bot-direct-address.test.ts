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

/**
 * Hai nhóm câu hỏi mà self-play (`QUESTION_OUTCOME = NOT_PARSED`, ~8,6% ở v17)
 * cho thấy chính bot sinh ra mà bot kia không nhận: câu hỏi có/không kết bằng
 * "được không", và lời xin ý kiến "hóng ý kiến X". Cả hai đều là cách người
 * thật gõ, nên sửa ở parser chứ không đổi mẫu lời thoại cho vừa parser.
 */
describe("câu hỏi có/không và lời xin ý kiến - không cần dấu hỏi", () => {
  const asks = (text: string, actorId = "p2") =>
    analyzeChat([message(text, actorId)], PLAYERS)
      .filter((m) => m.type === "DIRECT_QUESTION" || m.type === "DIRECT_ADDRESS")
      .map((m) => `${m.type}:${m.targetId}`);

  it("đuôi 'được không' là một câu hỏi nhắm tới người được nêu tên", () => {
    expect(asks("An nói rõ hơn được không")).toEqual(["DIRECT_QUESTION:p1"]);
    expect(asks("An nói rõ hơn được không.")).toEqual(["DIRECT_QUESTION:p1"]);
    expect(asks("An giải thích được ko")).toEqual(["DIRECT_QUESTION:p1"]);
    expect(asks("An giai thich duoc khong")).toEqual(["DIRECT_QUESTION:p1"]);
    expect(asks("An nói rõ đc k")).toEqual(["DIRECT_QUESTION:p1"]);
    expect(asks("An là tt đúng không")).toEqual(["DIRECT_QUESTION:p1"]);
    expect(asks("An dân phải ko")).toEqual(["DIRECT_QUESTION:p1"]);
    expect(asks("An đổi phiếu hả")).toEqual(["DIRECT_QUESTION:p1"]);
    // Hai tên trong một câu: parser giữ luật cũ, không đoán ai được hỏi.
    expect(asks("An bầu Chi hả")).toEqual([]);
  });

  it("đuôi hỏi đứng cuối một MỆNH ĐỀ cũng được, không cần cuối cả tin nhắn", () => {
    expect(asks("An nói rõ hơn được không, tôi chưa hiểu")).toEqual(["DIRECT_QUESTION:p1"]);
  });

  it("'hóng ý kiến X' / 'xin ý kiến X' là lời hỏi ý", () => {
    expect(asks("hóng ý kiến An")).toEqual(["DIRECT_QUESTION:p1"]);
    expect(asks("hóng ý kiến An.")).toEqual(["DIRECT_QUESTION:p1"]);
    expect(asks("hong y kien An")).toEqual(["DIRECT_QUESTION:p1"]);
    expect(asks("xin ý kiến An")).toEqual(["DIRECT_QUESTION:p1"]);
    expect(asks("cho xin ý kiến của An cái")).toEqual(["DIRECT_QUESTION:p1"]);
  });

  it("một câu hỏi có/không KHÔNG thành bằng chứng: 'An là sói đúng không' không buộc tội ai", () => {
    const types = analyzeChat([message("An là sói đúng không")], PLAYERS).map((m) => m.type);
    expect(types).toEqual(["DIRECT_QUESTION"]);
  });

  it("phủ định, kể chuyện người thứ ba, giả định: không thành câu hỏi nhắm tới", () => {
    // "không" ở giữa câu là phủ định, không phải đuôi hỏi.
    expect(asks("An không phải sói")).toEqual([]);
    expect(asks("tôi không tin An")).toEqual([]);
    // Nói VỀ ý kiến của An, không xin ý kiến An.
    expect(asks("ý kiến của An hay đấy")).toEqual([]);
    expect(asks("tôi cùng ý kiến với An")).toEqual([]);
    // Giả định.
    expect(asks("nếu An nói rõ hơn được thì tốt")).toEqual([]);
    // Chỉ nêu tên.
    expect(asks("An im suốt")).toEqual([]);
  });

  it("phủ định đứng trước dấu hiệu hỏi mới: không phải câu hỏi", () => {
    expect(asks("tôi không hóng ý kiến An")).toEqual([]);
    expect(asks("ko xin ý kiến An đâu")).toEqual([]);
    expect(asks("chả hóng ý kiến An")).toEqual([]);
    expect(asks("t k hong y kien An")).toEqual([]);
    // "không phải" trước đuôi "đúng không": parser bảo thủ chọn im (không có "?").
    expect(asks("An không phải sói đúng không")).toEqual([]);
    expect(asks("An chưa nói được không")).toEqual([]);
    // "đâu" cuối câu phủ định là tiểu từ, không phải từ để hỏi; "An đâu rồi" vẫn là hỏi.
    expect(asks("tôi ko tin An đâu")).toEqual([]);
    expect(asks("An đâu rồi")).toEqual(["DIRECT_QUESTION:p1"]);
  });

  it("giả định mở đầu mệnh đề: không phải câu hỏi", () => {
    expect(asks("nếu An trả lời được không thì tính sau")).toEqual([]);
    expect(asks("giả sử An là sói đúng không")).toEqual([]);
    expect(asks("lỡ An nói rõ hơn được ko")).toEqual([]);
    expect(asks("nếu là tôi thì tôi hóng ý kiến An")).toEqual([]);
    // Giả định ở mệnh đề TRƯỚC không làm mất câu hỏi ở mệnh đề sau.
    expect(asks("nếu An là dân, An nói rõ hơn được không")).toEqual(["DIRECT_QUESTION:p1"]);
  });

  it("trích dẫn: dấu hiệu hỏi nằm trong ngoặc kép không tính", () => {
    expect(asks("An bảo “nói rõ hơn được không” xong im luôn")).toEqual([]);
    expect(asks('An toàn nói "hóng ý kiến" thôi')).toEqual([]);
    // Ngoài ngoặc thì vẫn là hỏi.
    expect(asks("An nói “tôi là dân” đúng không")).toEqual(["DIRECT_QUESTION:p1"]);
  });

  it("dấu hỏi và từ để hỏi giữ nguyên luật cũ: phủ định kèm '?' vẫn là câu hỏi", () => {
    expect(asks("An không phải sói à?")).toEqual(["DIRECT_QUESTION:p1"]);
    expect(asks("tại sao An không nói")).toEqual(["DIRECT_QUESTION:p1"]);
  });

  it("tên rút gọn 'Hà' không bị đọc thành đuôi hỏi 'hả' khi gõ không dấu", () => {
    const withHa: BotPlayerKnowledge[] = [...PLAYERS, { id: "p4", name: "Hà", alive: true }];
    const found = analyzeChat([message("toi nghi Ha", "p2")], withHa).map((m) => m.type);
    expect(found).not.toContain("DIRECT_QUESTION");
    expect(found).toContain("ACCUSE");
  });

  it("người gửi tự hỏi mình hoặc hai tên trùng nhau thì vẫn im", () => {
    expect(asks("Bình nói rõ hơn được không", "p2")).toEqual([]);
    expect(typesOf("An nói rõ hơn được không", AMBIGUOUS)).toEqual([]);
  });
});
