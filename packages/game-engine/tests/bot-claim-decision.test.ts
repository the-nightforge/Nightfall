import { describe, expect, it } from "vitest";
import { BOT_WEIGHTS_V4 } from "../src/bot/config/weights";
import { decideChatClaim, wolfBluffSeat } from "../src/bot/decision/claim-decision";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import type { BotBrainState, BotDecisionContext, BotMemory } from "../src/bot/types";

const IDS = ["p1", "p2", "p3", "p4"];

function stateFor(id: string): BotBrainState {
  return createBotBrainState(id, createBotPersonality(createSeededRng(id)), IDS);
}

function contextFor(
  selfId: string,
  selfRole: BotDecisionContext["knowledge"]["selfRole"],
  overrides: Partial<BotDecisionContext["knowledge"]> = {},
): BotDecisionContext {
  return {
    knowledge: {
      botId: selfId,
      round: 2,
      phase: "DAY_DISCUSSION",
      phaseStartedAt: 0,
      phaseEndsAt: null,
      selfRole,
      players: IDS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: { [selfId]: selfRole },
      seerResult: null,
      sorcererResult: null,
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
      activeEventId: null,
      neutralRolesInPlay: [],
      dayOfTruthClaims: {},
      ...overrides,
    },
    visibleChat: [],
  };
}

function seerResultMemory(targetId: string): BotMemory {
  return {
    id: `SEER_RESULT:s1:p1`,
    sourceId: "s1",
    round: 1,
    phase: "NIGHT",
    type: "SEER_RESULT",
    actorId: "p1",
    targetId,
    importance: 10,
    pinned: true,
    data: { isWolf: true },
  };
}

/** Một "tôi là <role>" trơn — như `ROLE_CLAIM` do chat-analysis hoặc Ngày Sự Thật sinh ra. */
function roleClaimMemory(actorId: string, role: string, round = 2): BotMemory {
  return {
    id: `ROLE_CLAIM:m-${actorId}:${actorId}:`,
    sourceId: `m-${actorId}`,
    round,
    phase: "DAY_DISCUSSION",
    type: "ROLE_CLAIM",
    actorId,
    importance: 5,
    pinned: true,
    data: { role },
  };
}

/** Một "<targetId> không thể là X, tôi mới là <role>" — `COUNTER_CLAIM` chỉ đích danh `targetId`. */
function counterClaimMemory(actorId: string, targetId: string, role: string, round = 2): BotMemory {
  return {
    id: `COUNTER_CLAIM:m-${actorId}:${actorId}:${targetId}`,
    sourceId: `m-${actorId}`,
    round,
    phase: "DAY_DISCUSSION",
    type: "COUNTER_CLAIM",
    actorId,
    targetId,
    importance: 5,
    pinned: true,
    data: { role },
  };
}

describe("decideChatClaim", () => {
  it("Tiên Tri cầm kết quả trúng Sói thì khai và chỉ đích danh", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push(seerResultMemory("p3"));
    const claim = decideChatClaim(
      contextFor("p1", "SEER"),
      state,
      createSeededRng("a"),
      null,
      BOT_WEIGHTS_V4,
    );
    expect(claim?.kind).toBe("PROACTIVE");
    expect(claim?.role).toBe("SEER");
    expect(claim?.accusedId).toBe("p3");
  });

  it("Tiên Tri chỉ soi ra người sạch thì im — lời khai đó không chỉ được ai", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push({ ...seerResultMemory("p3"), data: { isWolf: false } });
    expect(
      decideChatClaim(
        contextFor("p1", "SEER"),
        state,
        createSeededRng("a"),
        null,
        BOT_WEIGHTS_V4,
      ),
    ).toBeNull();
  });

  it("khai xong thì không khai lại — một BOT một vai cả ván", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push(seerResultMemory("p3"));
    state.myClaim = { role: "SEER", round: 1 };
    expect(
      decideChatClaim(
        contextFor("p1", "SEER"),
        state,
        createSeededRng("a"),
        null,
        BOT_WEIGHTS_V4,
      ),
    ).toBeNull();
  });

  it("Bảo Vệ đang dẫn phiếu thì lôi vai ra làm lá bài cuối", () => {
    const claim = decideChatClaim(
      contextFor("p1", "GUARD", { currentVoteCounts: { players: { p1: 3 }, noElimination: 0 } }),
      stateFor("p1"),
      createSeededRng("a"),
      null,
      BOT_WEIGHTS_V4,
    );
    expect(claim?.kind).toBe("UNDER_FIRE");
    expect(claim?.role).toBe("GUARD");
  });

  it("Dân Làng bị dồn thì KHÔNG khai: câu đó không mang tin gì", () => {
    expect(
      decideChatClaim(
        contextFor("p1", "VILLAGER", { currentVoteCounts: { players: { p1: 3 }, noElimination: 0 } }),
        stateFor("p1"),
        createSeededRng("a"),
        null,
        BOT_WEIGHTS_V4,
      ),
    ).toBeNull();
  });

  it("nhóm claim tắt thì không ai khai gì, và không rút số ngẫu nhiên nào", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push(seerResultMemory("p3"));
    let draws = 0;
    const counting = () => {
      draws += 1;
      return 0.5;
    };
    const off = { ...BOT_WEIGHTS_V4, claim: { ...BOT_WEIGHTS_V4.claim, accusationWeight: 0 } };
    expect(decideChatClaim(contextFor("p1", "SEER"), state, counting, null, off)).toBeNull();
    expect(draws).toBe(0);
  });

  it("mỗi vòng chỉ ĐÚNG một ghế trong bầy được khai láo, và chỉ từ vòng 2", () => {
    const wolves = { p2: "WEREWOLF" as const, p3: "WEREWOLF" as const };
    const early = decideChatClaim(
      contextFor("p2", "WEREWOLF", { round: 1, knownRoles: wolves }),
      stateFor("p2"),
      createSeededRng("a"),
      null,
      BOT_WEIGHTS_V4,
    );
    expect(early).toBeNull();

    // Ghế của vòng 2 do `wolfBluffSeat` chốt; con còn lại im, không phải vì id
    // của nó lớn hơn mà vì hôm nay không tới lượt nó.
    const chosen = wolfBluffSeat(["p2", "p3"], ["p2", "p3"], 2);
    const other = chosen === "p2" ? "p3" : "p2";
    const notChosen = decideChatClaim(
      contextFor(other, "WEREWOLF", { knownRoles: wolves }),
      stateFor(other),
      () => 0,
      null,
      BOT_WEIGHTS_V4,
    );
    expect(notChosen).toBeNull();
  });

  it("ghế bluff xoay theo vòng: không ghế nào ôm quá 6/10 vòng, và nó đổi người", () => {
    const pack = ["p2", "p3", "p4"];
    const seats = Array.from({ length: 10 }, (_, index) =>
      wolfBluffSeat(pack, pack, index + 1),
    );

    const counts = new Map<string | null, number>();
    for (const seat of seats) counts.set(seat, (counts.get(seat) ?? 0) + 1);
    for (const [seat, times] of counts) {
      expect(times, `ghế ${seat} bluff ${times}/10 vòng`).toBeLessThanOrEqual(6);
    }
    // Cả ba con đều tới lượt, và chuỗi thật sự đổi người chứ không chỉ đổi
    // đúng một nhịp rồi đứng yên.
    expect(new Set(seats).size).toBe(3);
    expect(seats.some((seat, index) => index > 0 && seat !== seats[index - 1])).toBe(true);
  });

  it("cùng bầy, cùng vòng thì ra cùng ghế - chạy lại theo seed không vỡ", () => {
    const pack = ["p2", "p3", "p4"];
    const first = Array.from({ length: 10 }, (_, i) => wolfBluffSeat(pack, pack, i + 1));
    const second = Array.from({ length: 10 }, (_, i) => wolfBluffSeat(pack, pack, i + 1));
    expect(second).toEqual(first);
    // Thứ tự truyền vào không được đổi đáp án: mọi con Sói tự tính, và chúng
    // không cùng một thứ tự duyệt `knownRoles`.
    const shuffled = Array.from({ length: 10 }, (_, i) =>
      wolfBluffSeat(["p4", "p2", "p3"], ["p3", "p4", "p2"], i + 1),
    );
    expect(shuffled).toEqual(first);
  });

  it("bầy khác nhau thì lịch xoay khác nhau, và ghế chết bị loại khỏi lượt", () => {
    const wide = Array.from({ length: 10 }, (_, i) =>
      wolfBluffSeat(["p2", "p3", "p4"], ["p2", "p3", "p4"], i + 1),
    );
    const narrow = Array.from({ length: 10 }, (_, i) =>
      wolfBluffSeat(["p1", "p2", "p3"], ["p1", "p2", "p3"], i + 1),
    );
    expect(narrow).not.toEqual(wide);

    // Khoá vẫn là cả bầy (p4 đã chết vẫn nằm trong `roster`), nên p4 không bao
    // giờ được chọn nhưng lịch của hai con còn lại không bị gieo lại từ đầu.
    const afterDeath = Array.from({ length: 10 }, (_, i) =>
      wolfBluffSeat(["p2", "p3"], ["p2", "p3", "p4"], i + 1),
    );
    expect(afterDeath).not.toContain("p4");
    expect(new Set(afterDeath).size).toBe(2);
  });

  it("con Sói đã công khai nhận vai bị loại khỏi lượt xoay, bầy không im tới cuối ván", () => {
    const wolves = { p2: "WEREWOLF" as const, p3: "WEREWOLF" as const };
    // Vòng nào cũng có đúng một ghế được chọn trong số CHƯA khai. Ở đây p2 đã
    // khai rồi, nên mọi vòng đều phải rơi vào p3.
    const state = stateFor("p3");
    state.claims.push(roleClaimMemory("p2", "GUARD", 2));

    const claim = decideChatClaim(
      contextFor("p3", "WEREWOLF", { round: 3, knownRoles: wolves }),
      state,
      () => 0,
      "p1",
      BOT_WEIGHTS_V4,
    );
    expect(claim?.kind).toBe("PROACTIVE");
    expect(claim?.role).toBe("SEER");
    expect(claim?.accusedId).toBe("p1");
  });

  it("Sói khai láo thì chỉ đích danh đúng người nó định treo, do caller truyền vào chứ không tự đọc state", () => {
    // rng luôn trả 0: chắc chắn dưới ngưỡng `dare` (> 0 vì mọi hệ số đều dương),
    // nên nhánh khai láo chắc chắn kích hoạt bất kể personality sinh ra thế nào.
    const zero = () => 0;
    const claim = decideChatClaim(
      contextFor("p2", "WEREWOLF", { knownRoles: { p2: "WEREWOLF", p3: "WEREWOLF" } }),
      stateFor("p2"),
      zero,
      "p4",
      BOT_WEIGHTS_V4,
    );
    expect(claim?.kind).toBe("PROACTIVE");
    expect(claim?.role).toBe("SEER");
    expect(claim?.accusedId).toBe("p4");
  });

  it("Tiên Tri thật gặp kẻ mạo danh thì phản bác chứ không khai như chưa có chuyện gì, và nhắm đúng kẻ mạo danh ĐẦU TIÊN", () => {
    const state = stateFor("p1");
    // p1 chưa hề soi ra ai — nếu COUNTER không đứng trước PROACTIVE, hàm này sẽ
    // đi thẳng tới nhánh informant, thấy không có kết quả và trả về null thay vì
    // phản bác.
    //
    // Hai kẻ mạo danh, hai vòng khác nhau, cố tình push SAU (p3, vòng 3) trước
    // (p2, vòng 2) để chứng minh kết quả không phụ thuộc thứ tự chèn - Case A
    // phải chọn CŨ NHẤT: p2 là người đã gài lời khai giả trước, p3 chỉ lặp lại.
    state.claims.push(roleClaimMemory("p3", "SEER", 3));
    state.claims.push(roleClaimMemory("p2", "SEER", 2));
    const claim = decideChatClaim(
      contextFor("p1", "SEER"),
      state,
      createSeededRng("a"),
      null,
      BOT_WEIGHTS_V4,
    );
    expect(claim?.kind).toBe("COUNTER");
    expect(claim?.role).toBe("SEER");
    expect(claim?.counterTargetId).toBe("p2");
    expect(claim?.accusedId).toBeNull();
  });

  it("Sói bị một lời khai gọi tên thì phản bác lại bằng đúng vai người kia vừa nhận", () => {
    const state = stateFor("p2");
    // p3 nói: "p2 không thể là Tiên Tri, tôi mới là Tiên Tri" — targetId chỉ p2.
    state.claims.push(counterClaimMemory("p3", "p2", "SEER"));
    const claim = decideChatClaim(
      contextFor("p2", "WEREWOLF", { knownRoles: { p2: "WEREWOLF" } }),
      state,
      createSeededRng("a"),
      null,
      BOT_WEIGHTS_V4,
    );
    expect(claim?.kind).toBe("COUNTER");
    expect(claim?.role).toBe("SEER");
    expect(claim?.counterTargetId).toBe("p3");
    expect(claim?.accusedId).toBeNull();
  });

  it("Sói bị gọi tên hai lần thì phản bác lời buộc tội GẦN NHẤT, không phải lời đầu tiên", () => {
    const state = stateFor("p2");
    // p3 gọi tên p2 ở vòng 2 ("tôi mới là Tiên Tri"); p4 gọi tên p2 lại ở vòng 3
    // ("tôi mới là Bảo Vệ"). Bàn đang chú ý tới lời buộc tội của p4 - mới hơn -
    // nên p2 phải đáp lại đúng người đó, không phải p3. Push theo đúng thứ tự
    // thời gian (p3 trước, p4 sau) để phép thử không tự nhiên đúng nhờ trùng
    // với thứ tự mảng.
    state.claims.push(counterClaimMemory("p3", "p2", "SEER", 2));
    state.claims.push(counterClaimMemory("p4", "p2", "GUARD", 3));
    const claim = decideChatClaim(
      contextFor("p2", "WEREWOLF", { knownRoles: { p2: "WEREWOLF" }, round: 3 }),
      state,
      createSeededRng("a"),
      null,
      BOT_WEIGHTS_V4,
    );
    expect(claim?.kind).toBe("COUNTER");
    expect(claim?.role).toBe("GUARD");
    expect(claim?.counterTargetId).toBe("p4");
    expect(claim?.accusedId).toBeNull();
  });

  it("Dân Làng thấy người khác khai Dân Làng thì không phản bác — Dân Làng không phải vai chức năng", () => {
    const state = stateFor("p1");
    state.claims.push(roleClaimMemory("p2", "VILLAGER"));
    expect(
      decideChatClaim(
        contextFor("p1", "VILLAGER"),
        state,
        createSeededRng("a"),
        null,
        BOT_WEIGHTS_V4,
      ),
    ).toBeNull();
  });
});
