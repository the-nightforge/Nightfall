import { describe, expect, it } from "vitest";
import { applySocialEvidence } from "../src/bot/analysis/social-analysis";
import { applyPrivateInformation } from "../src/bot/belief/private-info";
import { MAX_BELIEF_SCORE } from "../src/bot/belief/evidence";
import { BOT_WEIGHTS_V7, BOT_WEIGHTS_V8, DEFAULT_BOT_WEIGHTS } from "../src/bot/config/presets";
import { decideChatClaim, decideRoleClaim } from "../src/bot/decision/claim-decision";
import { decideFinalVote } from "../src/bot/decision/trial-decision";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import { strategyFor } from "../src/bot/roles/registry";
import { serialKillerStrategy } from "../src/bot/roles/serial-killer";
import { createDecisionProbe, type DecisionProbeCollector } from "../src/bot/trace/trace";
import type {
  BotBrainState,
  BotDecisionContext,
  BotKnowledgeView,
  NightKnowledge,
} from "../src/bot/types";

const IDS = ["me", "trusted", "suspect", "quiet"];

function stateFor(seed = "sk"): BotBrainState {
  return createBotBrainState("me", createBotPersonality(createSeededRng(seed)), IDS);
}

function nightKnowledge(over: Partial<NightKnowledge> = {}): NightKnowledge {
  return {
    canAct: true,
    legalActions: ["SERIAL_KILL", "SKIP"],
    legalTargets: {
      KILL: [],
      SEE: [],
      GUARD: [],
      HEAL: [],
      POISON: [],
      SKIP: [],
      DETECTIVE_CHECK: [],
      GUARDIAN_PROTECT: [],
      HOLY_WATER: [],
      SERIAL_KILL: ["trusted", "suspect", "quiet"],
    },
    wolfTarget: null,
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    wolvesLocked: false,
    bonusSecondTargetFor: null,
    ...over,
  };
}

function knowledge(over: Partial<BotKnowledgeView> = {}): BotKnowledgeView {
  return {
    botId: "me",
    round: 2,
    phase: "NIGHT",
    phaseStartedAt: 0,
    phaseEndsAt: null,
    selfRole: "SERIAL_KILLER",
    players: IDS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
    knownRoles: { me: "SERIAL_KILLER" },
    seerResult: null,
    neutralRolesInPlay: ["SERIAL_KILLER"],
    night: nightKnowledge(),
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
    dayOfTruthClaims: {},
    ...over,
  };
}

const contextFor = (view: BotKnowledgeView): BotDecisionContext => ({
  knowledge: view,
  visibleChat: [],
});

/**
 * Ghi một cú công kích CÓ HƯỚNG vào social graph, qua đúng đường mà ván thật đi.
 *
 * Không đắp thẳng vào `state.relationships`: quy ước khoá `from->to` là của
 * `social-analysis`, và một bài test tự nối chuỗi sẽ vẫn xanh kể cả khi chiến
 * lược đọc ngược chiều so với thứ engine thật ghi vào.
 */
function accuse(state: BotBrainState, fromId: string, toId: string, tag: string): void {
  const sourceId = `2:nomination:${tag}`;
  state.seenEventIds.push(sourceId);
  applySocialEvidence(state, {
    id: `ev-${tag}-${fromId}-${toId}`,
    kind: "ACCUSE",
    sourceId,
    actorId: fromId,
    targetId: toId,
    weight: 6,
    confidence: 1,
    round: 2,
    summary: `${fromId} công kích ${toId}.`,
  });
}

/** Số hạng `hostility` của một ứng viên trong bảng điểm đêm, lấy từ trace. */
function hostilityTerm(probe: DecisionProbeCollector, targetId: string): number {
  const candidate = probe.candidates.find((item) => item.targetId === targetId);
  return candidate?.terms.find((term) => term.name === "hostility")?.value ?? Number.NaN;
}

/** Ghim belief thẳng vào state: các test dưới đây nói về QUYẾT ĐỊNH, không về decay. */
function pin(
  state: BotBrainState,
  table: "trust" | "suspicion",
  playerId: string,
  score: number,
): void {
  state[table][playerId] = { score, reasons: [], lastUpdatedRound: 1 };
}

describe("chiến thuật đêm của Sát Nhân", () => {
  it("nhắm người ĐƯỢC LÀNG TIN, không nhắm người đang bị nghi", () => {
    const state = stateFor();
    pin(state, "trust", "trusted", 8);
    pin(state, "suspicion", "suspect", 8);

    const move = serialKillerStrategy("SERIAL_KILLER", BOT_WEIGHTS_V8).decideNight(
      contextFor(knowledge()),
      state,
      createSeededRng("night"),
    );

    /*
     * Lõi của cả vai: người cả làng đang nghi sẽ bị chính làng treo vào ngày
     * mai, nên đâm họ là tiêu một đêm để làm hộ việc người khác sắp làm miễn
     * phí. Người được tin thì ngược lại - đó là người duy nhất làng sẽ KHÔNG
     * treo, tức người mà Sát Nhân buộc phải tự tay xử lý.
     */
    expect(move?.action).toBe("SERIAL_KILL");
    expect(move?.targetId).toBe("trusted");
  });

  it("số hạng hostility đọc ứng viên -> Sát Nhân, không phải cả làng -> ứng viên", () => {
    /*
     * Hai ứng viên ngang HỆT nhau về tin và nghi, khác đúng một điều: `trusted`
     * đang chĩa mũi dùi vào chính con BOT, `quiet` thì im. Số hạng "tự vệ" phải
     * tách được hai người đó ra - và phải tách đúng chiều.
     *
     * Ghim `trusted` là id đứng SAU theo bảng chữ cái là cố ý: hoà điểm thì
     * `decideNight` phá hoà bằng id tăng dần và chốt `quiet`, nên bài test này
     * chỉ xanh khi hostility thật sự nghiêng cán cân, không phải khi nó bị bỏ
     * qua rồi may mắn trùng kết quả.
     */
    const state = stateFor();
    pin(state, "trust", "trusted", 4);
    pin(state, "trust", "quiet", 4);
    accuse(state, "trusted", "me", "1");

    const probe = createDecisionProbe();
    const move = serialKillerStrategy("SERIAL_KILLER", BOT_WEIGHTS_V8).decideNight(
      contextFor(knowledge()),
      state,
      createSeededRng("night"),
      probe,
    );

    expect(move?.targetId).toBe("trusted");
    expect(hostilityTerm(probe, "trusted")).toBeGreaterThan(0);
    expect(hostilityTerm(probe, "quiet")).toBe(0);
  });

  it("người bị NGƯỜI KHÁC công kích không bị đọc nhầm thành mối đe doạ với Sát Nhân", () => {
    /*
     * Cùng thế cờ, nhưng mọi cạnh thù địch đều chỉ vào `trusted` chứ không cạnh
     * nào chỉ vào con BOT. Đọc ngược chiều thì đây chính là người được cộng
     * điểm cao nhất - và đó là kết luận sai gấp đôi: người cả làng đang chửi là
     * người làng sắp treo hộ, đúng người mà `crowdSuspicion` ở cùng bảng điểm
     * vừa trừ điểm.
     */
    const state = stateFor();
    pin(state, "trust", "trusted", 4);
    pin(state, "trust", "quiet", 4);
    accuse(state, "suspect", "trusted", "1");
    accuse(state, "quiet", "trusted", "2");

    const probe = createDecisionProbe();
    const move = serialKillerStrategy("SERIAL_KILLER", BOT_WEIGHTS_V8).decideNight(
      contextFor(knowledge()),
      state,
      createSeededRng("night"),
      probe,
    );

    // Không ai đe doạ Sát Nhân, nên hostility im lặng ở CẢ HAI và id phá hoà.
    expect(hostilityTerm(probe, "trusted")).toBe(0);
    expect(hostilityTerm(probe, "quiet")).toBe(0);
    expect(move?.targetId).toBe("quiet");
  });

  it("tránh chỉ lại người mình vừa đâm hụt đêm trước", () => {
    const state = stateFor();
    pin(state, "trust", "trusted", 8);
    // Đêm trước đã đâm `trusted`, mà người đó vẫn còn sống -> nhát dao đã bị
    // chặn, và Sát Nhân là người DUY NHẤT trên bàn biết điều đó.
    state.previousNightActions.push({ round: 1, action: "SERIAL_KILL", targetId: "trusted" });
    pin(state, "trust", "quiet", 6);

    const bias = serialKillerStrategy("SERIAL_KILLER", BOT_WEIGHTS_V8).voteBias(
      contextFor(knowledge({ phase: "VOTING", currentVoteCounts: { players: {}, noElimination: 0 } })),
      state,
    );

    // Chỉ tay vào họ ngay hôm sau là tự khai ra rằng mình biết một chuyện không
    // ai biết - đúng loại sơ hở mà mô hình uy tín của làng sinh ra để bắt.
    expect(bias.trusted).toBeLessThan(0);
  });

  it("HÙA THEO đám đông ban ngày - ngược hẳn Thằng Hề", () => {
    const state = stateFor();
    const view = knowledge({
      phase: "VOTING",
      currentVoteCounts: { players: { suspect: 3, quiet: 1 }, noElimination: 0 },
    });

    const killerBias = serialKillerStrategy("SERIAL_KILLER", BOT_WEIGHTS_V8).voteBias(
      contextFor(view),
      state,
    );
    const jesterBias = strategyFor("JESTER", BOT_WEIGHTS_V8).voteBias(
      contextFor({ ...view, selfRole: "JESTER" }),
      state,
    );

    // Người đang dẫn phiếu: Sát Nhân đẩy LÊN, Thằng Hề kéo XUỐNG. Hai vai trung
    // lập, hai chiến thuật ngược nhau ở đúng cùng một số hạng.
    expect(killerBias.suspect).toBeGreaterThan(0);
    expect(jesterBias.suspect).toBeLessThan(0);
  });

  it("registry trả đúng chiến lược, không rơi về passive", () => {
    const strategy = strategyFor("SERIAL_KILLER", BOT_WEIGHTS_V8);
    expect(strategy.role).toBe("SERIAL_KILLER");
    // `passiveStrategy` luôn trả null; một Sát Nhân như thế mất trắng lượt đêm
    // suốt mọi ván.
    expect(
      strategy.decideNight(contextFor(knowledge()), stateFor(), createSeededRng("x")),
    ).not.toBeNull();
  });

  it("không có lượt nào đang mở thì bỏ lượt, không ném", () => {
    const strategy = strategyFor("SERIAL_KILLER", BOT_WEIGHTS_V8);
    expect(
      strategy.decideNight(
        contextFor(knowledge({ night: null })),
        stateFor(),
        createSeededRng("x"),
      ),
    ).toBeNull();
    expect(
      strategy.decideNight(
        contextFor(knowledge({ night: nightKnowledge({ legalActions: [], legalTargets: { ...nightKnowledge().legalTargets, SERIAL_KILL: [] } }) })),
        stateFor(),
        createSeededRng("x"),
      ),
    ).toBeNull();
  });
});

describe("cổng tái lập: v7 không đổi một bit nào", () => {
  it("dưới v7 lõi chốt bằng luật tất định và KHÔNG rút số ngẫu nhiên", () => {
    let draws = 0;
    const countingRng = () => {
      draws += 1;
      return 0.5;
    };

    const state = stateFor();
    pin(state, "trust", "trusted", 8);
    const move = serialKillerStrategy("SERIAL_KILLER", BOT_WEIGHTS_V7).decideNight(
      contextFor(knowledge()),
      state,
      countingRng,
    );

    /*
     * v1-v7 là những mốc so sánh đã đo xong, và Sát Nhân chưa tồn tại khi chúng
     * được đo. Một lượt rút số ở đây sẽ đẩy lệch mọi lượt rút sau đó và làm hỏng
     * mọi ván tái lập khoá theo các phiên bản ấy.
     */
    expect(draws).toBe(0);
    // Vẫn ra một nước đi HỢP LỆ, chỉ là không có chiến thuật: phá hoà theo id.
    expect(move?.action).toBe("SERIAL_KILL");
    expect(move?.targetId).toBe("quiet");
    // Và bảng điểm đêm không được đọc: người được tin nhất KHÔNG được ưu tiên.
    expect(move?.targetId).not.toBe("trusted");
  });

  it("v8 là bản mặc định đang chạy", () => {
    expect(DEFAULT_BOT_WEIGHTS.version).toBe("8.0.0");
    expect(BOT_WEIGHTS_V7.serialKiller.nightThreatWeight).toBe(0);
    expect(BOT_WEIGHTS_V8.serialKiller.nightThreatWeight).toBeGreaterThan(0);
  });
});

describe("Sát Nhân ban ngày", () => {
  it("Ngày Sự Thật: nấp sau Dân Làng, không khai vai chức năng", () => {
    const claim = decideRoleClaim(contextFor(knowledge({ phase: "DAY_DISCUSSION" })), stateFor());
    expect(claim.role).toBe("VILLAGER");
    // Ngược hẳn Thằng Hề, vai duy nhất khai láo một vai chức năng để bị soi.
    const jester = decideRoleClaim(
      contextFor(knowledge({ phase: "DAY_DISCUSSION", selfRole: "JESTER" })),
      stateFor(),
    );
    expect(jester.role).toBe("SEER");
  });

  it("bị dồn thì lôi một lá bài cuối ra để sống - ngược hẳn Thằng Hề", () => {
    const view = knowledge({
      phase: "VOTING",
      night: null,
      currentVoteCounts: { players: { me: 3 }, noElimination: 0 },
    });

    const killer = decideChatClaim(
      contextFor(view),
      stateFor(),
      createSeededRng("claim"),
      null,
      BOT_WEIGHTS_V8,
    );
    expect(killer?.kind).toBe("UNDER_FIRE");
    expect(killer?.role).toBeTruthy();

    /*
     * Thằng Hề IM trong đúng tình thế đó: sống là thua với nó. Sát Nhân thì
     * ngược lại - sống là toàn bộ ván của nó. Hai vai cùng nhãn `neutral`, hai
     * câu trả lời trái ngược ở cùng một nhánh.
     */
    const jester = decideChatClaim(
      contextFor({ ...view, selfRole: "JESTER" }),
      stateFor(),
      createSeededRng("claim"),
      null,
      BOT_WEIGHTS_V8,
    );
    expect(jester).toBeNull();
  });

  it("bỏ phiếu TREO ở phiên toà của người khác", () => {
    const state = stateFor();
    // Không có nghi ngờ nào cả: quyết định không đến từ belief.
    const verdict = decideFinalVote(
      contextFor(knowledge({ phase: "FINAL_VOTE", night: null, trialAccusedId: "quiet" })),
      state,
      createSeededRng("v"),
      BOT_WEIGHTS_V8,
    );
    expect(verdict.guilty).toBe(true);

    // Thằng Hề bỏ THA ở đúng tình thế đó - và đó là cặp đối xứng của cả hai vai.
    const jester = decideFinalVote(
      contextFor(
        knowledge({
          phase: "FINAL_VOTE",
          night: null,
          selfRole: "JESTER",
          trialAccusedId: "quiet",
        }),
      ),
      state,
      createSeededRng("v"),
      BOT_WEIGHTS_V8,
    );
    expect(jester.guilty).toBe(false);
  });
});

describe("làng đọc kết quả soi TRUNG LẬP theo bộ bài", () => {
  function seerKnowledge(neutralRoles: BotKnowledgeView["neutralRolesInPlay"]): BotKnowledgeView {
    return knowledge({
      phase: "DAY_DISCUSSION",
      selfRole: "SEER",
      knownRoles: { me: "SEER" },
      night: null,
      neutralRolesInPlay: neutralRoles,
      seerResult: { targetId: "quiet", targetName: "QUIET", isWolf: false, team: "neutral" },
    });
  }

  it("ván chỉ có Thằng Hề: trung lập là VÔ HẠI, xoá nghi ngờ", () => {
    const state = stateFor();
    applyPrivateInformation(state, seerKnowledge(["JESTER"]));

    expect(state.suspicion.quiet?.score ?? 0).toBe(0);
    expect(state.trust.quiet?.score ?? 0).toBeGreaterThan(0);
  });

  it("ván CÓ Sát Nhân: cùng kết quả ấy thành một mối nguy", () => {
    const state = stateFor();
    applyPrivateInformation(state, seerKnowledge(["SERIAL_KILLER"]));

    /*
     * Cùng một lượt soi, hai kết luận trái ngược - vì câu hỏi đã đổi. Tiên Tri
     * KHÔNG phân biệt được hai vai trung lập, nên nó không được đem uy tín ra
     * bảo lãnh cho một người có thể chính là kẻ đang giết người mỗi đêm.
     */
    expect(state.trust.quiet?.score ?? 0).toBe(0);
    expect(state.suspicion.quiet!.score).toBeGreaterThan(0);
    // Nhưng vẫn DƯỚI trần: "có thể là hung thủ" khác "chính là hung thủ".
    expect(state.suspicion.quiet!.score).toBeLessThan(MAX_BELIEF_SCORE);
  });

  it("áp lại nhiều lần vẫn ra đúng một điểm và đúng một mục bằng chứng", () => {
    const state = stateFor();
    const view = seerKnowledge(["SERIAL_KILLER"]);
    for (let i = 0; i < 4; i += 1) applyPrivateInformation(state, view);

    const once = stateFor();
    applyPrivateInformation(once, view);

    // `observe()` chạy nhiều lần mỗi vòng; một niềm tin cộng dồn theo số lần
    // gọi phụ thuộc vào lịch chạy của scheduler chứ không vào ván đấu.
    expect(state.suspicion.quiet!.score).toBe(once.suspicion.quiet!.score);
    expect(state.suspicion.quiet!.reasons).toHaveLength(1);
  });

  it("soi ra Sói hay soi ra người làng thì không đổi gì cả", () => {
    const wolfRead = stateFor();
    applyPrivateInformation(wolfRead, {
      ...seerKnowledge(["SERIAL_KILLER"]),
      seerResult: { targetId: "quiet", targetName: "QUIET", isWolf: true, team: "wolves" },
    });
    expect(wolfRead.suspicion.quiet!.score).toBe(MAX_BELIEF_SCORE);

    const villageRead = stateFor();
    applyPrivateInformation(villageRead, {
      ...seerKnowledge(["SERIAL_KILLER"]),
      seerResult: { targetId: "quiet", targetName: "QUIET", isWolf: false, team: "village" },
    });
    expect(villageRead.trust.quiet!.score).toBe(MAX_BELIEF_SCORE);
    expect(villageRead.suspicion.quiet!.score).toBe(0);
  });
});
