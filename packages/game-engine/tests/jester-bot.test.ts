import { describe, expect, it } from "vitest";
import { BOT_WEIGHTS_V4, BOT_WEIGHTS_V6, DEFAULT_BOT_WEIGHTS } from "../src/bot/config/weights";
import { decideChatClaim, decideRoleClaim } from "../src/bot/decision/claim-decision";
import { decideFinalVote } from "../src/bot/decision/trial-decision";
import { selectVote } from "../src/bot/decision/vote-decision";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import { strategyFor } from "../src/bot/roles/registry";
import type { BotBrainState, BotDecisionContext, BotMemory } from "../src/bot/types";

const IDS = ["jester", "trusted", "suspect", "quiet"];

function stateFor(id = "jester", seed = "jester-seed"): BotBrainState {
  return createBotBrainState(id, createBotPersonality(createSeededRng(seed)), IDS);
}

function contextFor(
  overrides: Partial<BotDecisionContext["knowledge"]> = {},
): BotDecisionContext {
  return {
    knowledge: {
      botId: "jester",
      round: 2,
      phase: "VOTING",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: "JESTER",
      players: IDS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: { jester: "JESTER" },
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
      legalVoteChoices: IDS.map((targetId) => ({ type: "PLAYER" as const, targetId })),
      lastNightDeaths: [],
      activeEventId: null,
      dayOfTruthClaims: {},
      neutralRolesInPlay: [],
      ...overrides,
    },
    visibleChat: [],
  };
}

/**
 * Bàn cờ tâm lý cố định: một người làng đang TIN, một người đang bị NGHI.
 *
 * Gán thẳng điểm chứ không dựng qua chuỗi bằng chứng: bài test này nói về việc
 * Thằng Hề CHỌN ai khi bảng belief trông như thế nào, không nói về việc bảng
 * belief được dựng ra sao - phần đó đã có test riêng.
 */
function polarizedState(seed = "jester-seed"): BotBrainState {
  const state = stateFor("jester", seed);
  state.trust.trusted = { score: 4, reasons: [], lastUpdatedRound: 2 };
  state.suspicion.suspect = { score: 6, reasons: [], lastUpdatedRound: 2 };
  return state;
}

function roleClaimMemory(actorId: string, role: string, round = 1): BotMemory {
  return {
    id: `ROLE_CLAIM:m-${actorId}:${actorId}:`,
    sourceId: `m-${actorId}`,
    round,
    phase: "DAY_DISCUSSION",
    type: "ROLE_CLAIM",
    actorId,
    importance: 8,
    pinned: false,
    data: { role },
  };
}

describe("BOT Thằng Hề - lá phiếu ban ngày", () => {
  it("chỉ vào người được TIN nhất, không phải người bị nghi nhất", () => {
    /*
     * Đây là khác biệt cốt lõi với một con BOT Dân Làng. Cùng một bảng belief,
     * Dân Làng bầu `suspect` (điểm nghi cao nhất) còn Hề bầu `trusted` - một
     * cáo buộc trông vô lý, và vì thế đọc ra như một con Sói đang quẫy.
     */
    const bias = strategyFor("JESTER").voteBias(contextFor(), polarizedState());
    expect(bias.trusted).toBeGreaterThan(bias.suspect);

    const vote = selectVote(contextFor(), polarizedState(), createSeededRng("v"));
    expect(vote.choice).toEqual({ type: "PLAYER", targetId: "trusted" });
  });

  it("BOT Dân Làng ở cùng tình thế bầu ngược lại - đối chứng", () => {
    // Không có dòng này thì khẳng định trên có thể đúng vì một lý do tình cờ
    // nào đó của bảng điểm, chứ không phải vì `voteBias` của Hề.
    const vote = selectVote(
      contextFor({ selfRole: "VILLAGER", knownRoles: { jester: "VILLAGER" } }),
      polarizedState(),
      createSeededRng("v"),
    );
    expect(vote.choice).toEqual({ type: "PLAYER", targetId: "suspect" });
  });

  it("không bao giờ hùa theo người đang dẫn phiếu", () => {
    /*
     * Một ngày kết thúc bằng việc treo NGƯỜI KHÁC là một ngày Hề mất trắng.
     *
     * Đo bằng HIỆU giữa hai tình thế chứ không bằng dấu của một con số: giá trị
     * tuyệt đối phụ thuộc cả trust lẫn suspicion của người đó, nên một khẳng
     * định `< 0` sẽ đỏ hoặc xanh vì những lý do chẳng liên quan gì tới đám đông.
     */
    const strategy = strategyFor("JESTER");
    const alone = strategy.voteBias(contextFor(), polarizedState());
    const leading = strategy.voteBias(
      contextFor({ currentVoteCounts: { players: { trusted: 3 }, noElimination: 0 } }),
      polarizedState(),
    );
    expect(leading.trusted).toBe(alone.trusted - DEFAULT_BOT_WEIGHTS.jester.bandwagonPenalty);

    // Và hình phạt đủ nặng để thật sự đổi lá phiếu: đúng người mà Hề sẽ bầu khi
    // không ai dồn phiếu, giờ không còn được bầu nữa.
    const vote = selectVote(
      contextFor({ currentVoteCounts: { players: { trusted: 3 }, noElimination: 0 } }),
      polarizedState(),
      createSeededRng("v"),
    );
    expect(vote.choice).not.toEqual({ type: "PLAYER", targetId: "trusted" });
  });

  it("không tự bầu mình - một tín hiệu đọc ra ngay là muốn bị treo", () => {
    const bias = strategyFor("JESTER").voteBias(contextFor(), polarizedState());
    expect(bias.jester).toBeUndefined();

    const vote = selectVote(contextFor(), polarizedState(), createSeededRng("v"));
    expect(vote.choice).not.toEqual({ type: "PLAYER", targetId: "jester" });
  });

  it("không nghiêng gì cả dưới cấu hình chưa bật hành vi Hề", () => {
    // Cổng tái lập: v1-v6 phải chạy y hệt như trước khi vai này tồn tại.
    const bias = strategyFor("JESTER", BOT_WEIGHTS_V6).voteBias(contextFor(), polarizedState());
    expect(bias).toEqual({});
  });
});

describe("BOT Thằng Hề - phiên toà", () => {
  it("luôn bỏ THA khi người khác bị xử", () => {
    const verdict = decideFinalVote(
      contextFor({ phase: "FINAL_VOTE", trialAccusedId: "suspect", canFinalVote: true }),
      polarizedState(),
      createSeededRng("t"),
    );
    expect(verdict.guilty).toBe(false);
  });

  it("tha kể cả khi bằng chứng công khai chỉ thẳng vào bị cáo", () => {
    // Một BOT làng ở đúng tình thế này bỏ TREO; Hề thì không, vì lá phiếu đó
    // tiêu mất chính cái ngày mà nó cần.
    const state = polarizedState();
    state.suspicion.suspect = { score: 90, reasons: [], lastUpdatedRound: 2 };
    const context = contextFor({
      phase: "FINAL_VOTE",
      trialAccusedId: "suspect",
      canFinalVote: true,
    });

    expect(decideFinalVote(context, state, createSeededRng("t")).guilty).toBe(false);
    const villagerVerdict = decideFinalVote(
      { ...context, knowledge: { ...context.knowledge, selfRole: "VILLAGER" } },
      state,
      createSeededRng("t"),
    );
    expect(villagerVerdict.guilty).toBe(true);
  });
});

describe("BOT Thằng Hề - lời khai", () => {
  it("Ngày Sự Thật: khai một vai CHỨC NĂNG chứ không nấp sau Dân Làng", () => {
    const claim = decideRoleClaim(contextFor(), stateFor());
    expect(claim.role).toBe("SEER");
    // Đối chứng: một Dân Làng thật khai đúng vai mình, và một con Sói nấp.
    expect(decideRoleClaim(contextFor({ selfRole: "VILLAGER" }), stateFor()).role).toBe("VILLAGER");
    expect(decideRoleClaim(contextFor({ selfRole: "WEREWOLF" }), stateFor()).role).toBe("VILLAGER");
  });

  it("tự mở màn bằng Tiên Tri khi chưa ai khai gì", () => {
    const state = stateFor();
    // deceptionSkill × riskTolerance nhân vào `bluffChance`, nên một rng luôn
    // trả 0 là cách duy nhất khẳng định nhánh này mà không phụ thuộc tính cách.
    const claim = decideChatClaim(contextFor(), state, () => 0, "suspect", DEFAULT_BOT_WEIGHTS);
    expect(claim).not.toBeNull();
    expect(claim!.role).toBe("SEER");
    expect(claim!.kind).toBe("PROACTIVE");
    // Lời nói đi cùng lá phiếu: nó chỉ đích danh đúng người nó vừa bầu.
    expect(claim!.accusedId).toBe("suspect");
  });

  it("đè lên lời khai đang có để bàn buộc phải xử một trong hai", () => {
    const state = stateFor();
    state.claims.push(roleClaimMemory("trusted", "GUARD"));

    const claim = decideChatClaim(contextFor(), state, () => 0, "suspect", DEFAULT_BOT_WEIGHTS);
    expect(claim).toEqual(
      expect.objectContaining({ role: "GUARD", kind: "COUNTER", counterTargetId: "trusted" }),
    );
  });

  it("đang bị dồn thì KHÔNG lôi lá bài cuối ra tự cứu", () => {
    /*
     * Nhánh UNDER_FIRE tồn tại để một vai chức năng sống sót. Với Hề thì sống
     * chính là thua, nên nó phải im - và đây là chỗ dễ hỏng nhất nếu ai đó nới
     * điều kiện `isPowerRole` ra cho "mọi vai không phải Sói".
     */
    const state = stateFor();
    const claim = decideChatClaim(
      contextFor({ trialAccusedId: "jester", round: 0 }),
      state,
      () => 0.99,
      null,
      DEFAULT_BOT_WEIGHTS,
    );
    expect(claim).toBeNull();
  });

  it("không rút số ngẫu nhiên nào dưới cấu hình chưa bật hành vi Hề", () => {
    // Nếu nhánh Hề rút số dưới v4 thì mọi test tái lập của v4 sẽ lệch chuỗi RNG
    // ngay khi bàn có một Thằng Hề.
    let draws = 0;
    const rng = () => {
      draws += 1;
      return 0;
    };
    decideChatClaim(contextFor(), stateFor(), rng, "suspect", BOT_WEIGHTS_V4);
    expect(draws).toBe(0);
  });
});

describe("BOT Thằng Hề - ban đêm", () => {
  it("không bao giờ hành động, kể cả khi được chào một lượt", () => {
    const decision = strategyFor("JESTER").decideNight(
      contextFor({ phase: "NIGHT" }),
      stateFor(),
      createSeededRng("n"),
    );
    expect(decision).toBeNull();
  });

  it("registry trả về đúng chiến lược riêng, không rơi về strategy nền", () => {
    const strategy = strategyFor("JESTER");
    expect(strategy.role).toBe("JESTER");
    // `passiveStrategy` trả object rỗng ở mọi tình thế; strategy của Hề thì không.
    expect(strategy.voteBias(contextFor(), polarizedState())).not.toEqual({});
  });
});
