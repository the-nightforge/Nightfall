import { describe, expect, it } from "vitest";
import type { PublicVoteChoice } from "@masoi/shared";
import { BotRuntime } from "../src/bot/BotRuntime";
import { BOT_WEIGHTS_PRESETS } from "../src/bot/config/presets";
import {
  BOT_WEIGHTS_V16,
  BOT_WEIGHTS_V17,
  BOT_WEIGHTS_V18,
  type BotWeights,
} from "../src/bot/config/weights";
import {
  hasFreshExculpation,
  linesSpokenThisRound,
  voteHysteresis,
} from "../src/bot/decision/vote-decision";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import type {
  BotChatObservation,
  BotDecisionContext,
  BotKnowledgeView,
  BotPersonality,
} from "../src/bot/types";

/**
 * Khả năng bị thuyết phục trước người thật - kịch bản có kiểm soát cho quy tắc
 * v17 ("phiếu dính hơn khi mục tiêu đang bầu đã nói >= 3 câu").
 *
 * Đi qua `BotRuntime.observe` + `decideVote` THẬT với chat tiếng Việt thật -
 * có dấu, không dấu, viết tắt, gọi đích danh - chứ không dựng sẵn memory. Nhờ
 * vậy test này đo cả parser lẫn belief lẫn quyết định, đúng đường mà một câu
 * người thật gõ vào phòng sẽ đi.
 *
 * Bàn: Minh (bot, dân), An (đang bị bầu), Bình (ứng viên thay thế), Chi, Dũng,
 * Em. Vòng 1 cả bàn dồn nghi ngờ lên An và một ít lên Bình; bot bầu An. Sau đó
 * bốn người khác đẩy Bình lên tới mức chênh lệch với An rơi ĐÚNG vào khoảng
 * giữa hysteresis thường (3.5) và hysteresis có bonus (5.5) - nên chỉ riêng
 * chuyện bonus có áp hay không quyết định lá phiếu.
 */

const NAMES: Record<string, string> = { me: "Minh", a: "An", b: "Bình", c: "Chi", d: "Dũng", e: "Em" };
const IDS = Object.keys(NAMES);
const P: BotPersonality = {
  ...createBotPersonality(createSeededRng("persuasion")),
  stubbornness: 0.5,
};

let seq = 0;
function msg(actorId: string, text: string): BotChatObservation {
  seq += 1;
  return { id: `chat:${seq}`, actorId, text, at: seq * 1_000 };
}

function ctx(over: Partial<BotKnowledgeView>, chat: BotChatObservation[]): BotDecisionContext {
  return {
    knowledge: {
      botId: "me",
      round: 2,
      phase: "VOTING",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: "VILLAGER",
      players: IDS.map((id) => ({ id, name: NAMES[id]!, alive: true })),
      knownRoles: { me: "VILLAGER" },
      seerResult: null,
      sorcererResult: null,
      neutralRolesInPlay: [],
      night: null,
      trialAccusedId: null,
      canFinalVote: false,
      hunterShot: null,
      publicVoteHistory: [],
      currentVoteCounts: { players: {}, noElimination: 0 },
      hasVoted: false,
      myVote: null,
      legalVoteChoices: IDS.filter((id) => id !== "me").map(
        (targetId): PublicVoteChoice => ({ type: "PLAYER", targetId }),
      ),
      lastNightDeaths: [],
      activeEventId: null,
      dayOfTruthClaims: {},
      ...over,
    },
    visibleChat: chat,
  };
}

interface Outcome {
  /** Lá phiếu đầu (trước khi An/Bình nói gì) và lá phiếu sau. */
  first: string | null;
  second: string | null;
  linesA: number;
  exculpatedA: boolean;
  suspicionA: number;
}

/**
 * `setup`: câu của người thứ ba; `lines`: câu của người đang bị bầu (hoặc Sói).
 * `pressureOnB`: số câu tố Bình để đẩy Bình lên khoảng phân biệt (mặc định 4).
 */
function play(
  weights: BotWeights,
  scenario: { setup?: BotChatObservation[]; lines: BotChatObservation[] },
  pressureOnB = 4,
): Outcome {
  // Jitter 0 để so đúng: `(0.5 - 0.5) x jitterSpan = 0`.
  const bot = new BotRuntime({ playerId: "me", rng: () => 0.5, playerIds: IDS, personality: P, weights });

  const round1 = [
    msg("c", "tôi nghi An"),
    msg("d", "nghi An"),
    msg("e", "An đáng ngờ"),
    msg("c", "nghi Bình"),
    msg("d", "Bình hơi lạ"),
  ];
  bot.observe(ctx({}, round1));
  const first = bot.decideVote(ctx({}, round1));
  const firstTarget = first.choice.type === "PLAYER" ? first.choice.targetId : null;

  const pressure = [
    msg("e", "nghi Bình"),
    msg("d", "Bình là sói"),
    msg("c", "vote Bình"),
    msg("e", "Bình sói chắc"),
  ].slice(0, pressureOnB);
  const later = [...round1, ...(scenario.setup ?? []), ...pressure, ...scenario.lines];
  const knowledge: Partial<BotKnowledgeView> = {
    myVote: firstTarget ? { type: "PLAYER", targetId: firstTarget } : null,
    // Bảng phiếu công khai: An đang dẫn (bot + Chi + Dũng), Bình có một phiếu.
    currentVoteCounts: { players: { a: 3, b: 1 }, noElimination: 0 },
    hasVoted: true,
  };
  bot.observe(ctx(knowledge, later));
  const second = bot.decideVote(ctx(knowledge, later));
  return {
    first: firstTarget,
    second: second.choice.type === "PLAYER" ? second.choice.targetId : null,
    linesA: linesSpokenThisRound(bot.state, "a", 2),
    exculpatedA: hasFreshExculpation(bot.state, "a", 2),
    suspicionA: bot.state.suspicion.a?.score ?? 0,
  };
}

/** An đưa bằng chứng mới: khai Bảo Vệ, hỏi thẳng Dũng, bênh Chi; Chi bênh An. */
const GOOD_EVIDENCE = {
  setup: [msg("c", "tôi tin An")],
  lines: [
    msg("a", "Tôi là bảo vệ, đêm qua tôi bảo vệ Chi"),
    msg("a", "Dũng ơi, sao lại vote tôi?"),
    msg("a", "tôi tin Chi"),
  ],
};
/** Cùng nội dung, gõ không dấu, viết tắt, gọi đích danh. */
const GOOD_EVIDENCE_ASCII = {
  setup: [msg("c", "dung treo An")],
  lines: [msg("a", "t la bv"), msg("a", "Dung oi sao vote t?"), msg("a", "tin Chi")],
};
/** Chỉ phủ nhận: parser cố ý bỏ qua câu có phủ định. */
const DENIAL_ONLY = {
  lines: [msg("a", "tôi không phải sói"), msg("a", "tôi không phải sói mà"), msg("a", "ko phải sói nha")],
};
/** Ba câu "tôi là dân": parser hiểu, nhưng không có gì gỡ tội. */
const HOLLOW_CLAIMS = {
  lines: [msg("a", "tôi là dân"), msg("a", "tôi là dân mà"), msg("a", "tôi là dân thật")],
};
/** Ba câu phản công vô căn cứ. */
const COUNTER_ACCUSE = {
  lines: [msg("a", "nghi Chi"), msg("a", "vote Dũng đi"), msg("a", "Em là sói")],
};
/** Sói (Bình) nói nhiều để đánh lạc hướng trong khi bot đang bầu An. */
const WOLF_NOISE = {
  setup: [msg("c", "tôi tin An")],
  lines: [msg("b", "nghi Chi"), msg("b", "vote Dũng"), msg("b", "Em là sói"), msg("a", "Tôi là bảo vệ")],
};
/** Đối chứng: An im lặng, chỉ có Chi bênh. */
const SILENT = { setup: [msg("c", "tôi tin An")], lines: [] };

describe("preset v18", () => {
  it("v18 khác v17 ĐÚNG ở confidence.talkerHysteresisExculpatedScale", () => {
    for (const key of Object.keys(BOT_WEIGHTS_V17) as Array<keyof BotWeights>) {
      if (key === "version" || key === "confidence") continue;
      expect(BOT_WEIGHTS_V18[key]).toBe(BOT_WEIGHTS_V17[key]);
    }
    expect(BOT_WEIGHTS_V18.confidence).toEqual({
      ...BOT_WEIGHTS_V17.confidence,
      talkerHysteresisExculpatedScale: 0,
    });
  });

  it("v1..v17 giữ hệ số 1 (bonus áp phẳng)", () => {
    for (const preset of Object.values(BOT_WEIGHTS_PRESETS)) {
      if (Number(preset.version.split(".")[0]) >= 18) continue;
      expect(preset.confidence.talkerHysteresisExculpatedScale).toBe(1);
    }
  });

  it("voteHysteresis: bonus bị nhân hệ số khi mục tiêu vừa được gỡ tội", () => {
    const base = voteHysteresis(P, BOT_WEIGHTS_V18);
    expect(voteHysteresis(P, BOT_WEIGHTS_V18, 3, false)).toBe(base + 2);
    expect(voteHysteresis(P, BOT_WEIGHTS_V18, 3, true)).toBe(base);
    // v17 không phân biệt.
    expect(voteHysteresis(P, BOT_WEIGHTS_V17, 3, true)).toBe(base + 2);
  });
});

describe("parser đọc đúng các dạng câu người thật", () => {
  it("có dấu, không dấu và viết tắt đều ra 3 câu và có bằng chứng gỡ tội", () => {
    for (const scenario of [GOOD_EVIDENCE, GOOD_EVIDENCE_ASCII]) {
      const out = play(BOT_WEIGHTS_V18, scenario);
      expect(out.linesA).toBe(3);
      expect(out.exculpatedA).toBe(true);
    }
  });

  it("phủ nhận thuần không thành câu nào; 'tôi là dân' x3 thành 3 câu nhưng không gỡ tội", () => {
    expect(play(BOT_WEIGHTS_V18, DENIAL_ONLY).linesA).toBe(0);
    const hollow = play(BOT_WEIGHTS_V18, HOLLOW_CLAIMS);
    expect(hollow.linesA).toBe(3);
    expect(hollow.exculpatedA).toBe(false);
    const counter = play(BOT_WEIGHTS_V18, COUNTER_ACCUSE);
    expect(counter.linesA).toBe(3);
    expect(counter.exculpatedA).toBe(false);
  });

  it("bằng chứng tốt hạ nghi ngờ so với im lặng, ở mọi phiên bản", () => {
    for (const weights of [BOT_WEIGHTS_V16, BOT_WEIGHTS_V17, BOT_WEIGHTS_V18]) {
      expect(play(weights, GOOD_EVIDENCE).suspicionA).toBeLessThan(play(weights, SILENT).suspicionA);
    }
  });
});

describe("v17: người đưa bằng chứng tốt khó thoát phiếu hơn người im lặng", () => {
  // Đây là hành vi bất hợp lý mà v18 sửa. Giữ test này để nó là bằng chứng có
  // thể chạy lại được, không phải một dòng trong báo cáo.
  it("im lặng thì bot đổi phiếu, nói 3 câu có bằng chứng thì bot giữ", () => {
    expect(play(BOT_WEIGHTS_V17, SILENT).second).toBe("b");
    expect(play(BOT_WEIGHTS_V17, GOOD_EVIDENCE).second).toBe("a");
    expect(play(BOT_WEIGHTS_V17, GOOD_EVIDENCE_ASCII).second).toBe("a");
  });

  it("v16 (chưa có bonus) đổi phiếu trong cả hai trường hợp", () => {
    expect(play(BOT_WEIGHTS_V16, SILENT).second).toBe("b");
    expect(play(BOT_WEIGHTS_V16, GOOD_EVIDENCE).second).toBe("b");
  });
});

describe("v18: dính theo chất lượng bằng chứng, không theo số câu", () => {
  it("bằng chứng tốt (có dấu và không dấu): bot đổi phiếu như khi An im lặng", () => {
    expect(play(BOT_WEIGHTS_V18, GOOD_EVIDENCE).second).toBe("b");
    expect(play(BOT_WEIGHTS_V18, GOOD_EVIDENCE_ASCII).second).toBe("b");
    expect(play(BOT_WEIGHTS_V18, SILENT).second).toBe("b");
  });

  it("ba câu 'tôi là dân' hay ba câu phản công vô căn cứ: vẫn dính như v17", () => {
    expect(play(BOT_WEIGHTS_V18, HOLLOW_CLAIMS).second).toBe("a");
    expect(play(BOT_WEIGHTS_V18, COUNTER_ACCUSE).second).toBe("a");
    expect(play(BOT_WEIGHTS_V17, HOLLOW_CLAIMS).second).toBe("a");
    expect(play(BOT_WEIGHTS_V17, COUNTER_ACCUSE).second).toBe("a");
  });

  it("chỉ phủ nhận: parser không đếm câu nào, nên không dính thêm ở cả v17 lẫn v18", () => {
    expect(play(BOT_WEIGHTS_V17, DENIAL_ONLY).second).toBe("b");
    expect(play(BOT_WEIGHTS_V18, DENIAL_ONLY).second).toBe("b");
  });

  it("Sói nói nhiều không làm phiếu đang bầu người khác dính hơn", () => {
    // Bonus chỉ áp lên MỤC TIÊU đang bầu. Bình nói ba câu trong khi bot bầu An:
    // không có gì đổi so với đối chứng, ở mọi phiên bản.
    for (const weights of [BOT_WEIGHTS_V17, BOT_WEIGHTS_V18]) {
      const out = play(weights, WOLF_NOISE);
      expect(out.first).toBe("a");
      expect(out.second).toBe("b");
    }
  });

  it("không ép bot tin người: áp lực lên Bình chưa đủ thì bằng chứng tốt cũng chưa lật được", () => {
    // Chênh lệch dưới hysteresis THƯỜNG (3.5): bot giữ An dù An khai Bảo Vệ và
    // được bênh. Đổi ý vẫn cần một lý do đủ lớn ở phía bên kia.
    expect(play(BOT_WEIGHTS_V18, GOOD_EVIDENCE, 2).second).toBe("a");
  });
});

describe("hasFreshExculpation", () => {
  it("chỉ đếm reason âm của ĐÚNG vòng hiện tại", () => {
    const bot = new BotRuntime({ playerId: "me", rng: () => 0.5, playerIds: IDS, personality: P, weights: BOT_WEIGHTS_V18 });
    const chat = [msg("c", "tôi tin An")];
    bot.observe(ctx({}, chat));
    expect(hasFreshExculpation(bot.state, "a", 2)).toBe(true);
    expect(hasFreshExculpation(bot.state, "a", 3)).toBe(false);
    expect(hasFreshExculpation(bot.state, "b", 2)).toBe(false);
  });
});
