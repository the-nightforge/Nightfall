import { describe, expect, it } from "vitest";
import { applyPrivateInformation } from "../src/bot/belief/private-info";
import { MAX_BELIEF_SCORE } from "../src/bot/belief/evidence";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import type { BotBrainState, BotKnowledgeView } from "../src/bot/types";

const IDS = ["me", "jester", "villager", "wolf"];

function stateFor(seed = "review"): BotBrainState {
  return createBotBrainState("me", createBotPersonality(createSeededRng(seed)), IDS);
}

function knowledgeWithSeerResult(
  targetId: string,
  team: "wolves" | "village" | "neutral",
  round = 1,
): BotKnowledgeView {
  return {
    botId: "me",
    round,
    phase: "DAY_DISCUSSION",
    phaseStartedAt: 0,
    phaseEndsAt: null,
    selfRole: "SEER",
    players: IDS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
    knownRoles: { me: "SEER" },
    mediumResult: null,
    seerResult: {
      targetId,
      targetName: targetId.toUpperCase(),
      isWolf: team === "wolves",
      team,
    },
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
    dayOfTruthClaims: {},
    // Bộ bài của những ván này chỉ có Thằng Hề. Đó là điều kiện để mọi khẳng
    // định bên dưới còn đúng: một ván CÓ Sát Nhân đọc cùng kết quả soi ấy theo
    // hướng ngược lại, và bộ test đó nằm riêng ở `serial-killer-bot.test.ts`.
    neutralRolesInPlay: ["JESTER"],
  };
}

/** Điểm tin tưởng sau `times` lần `observe` trên CÙNG một kết quả soi. */
function trustAfter(times: number, team: "village" | "neutral", seed = "review"): number {
  const state = stateFor(seed);
  const knowledge = knowledgeWithSeerResult("jester", team);
  for (let i = 0; i < times; i += 1) applyPrivateInformation(state, knowledge);
  return state.trust.jester?.score ?? 0;
}

describe("kết quả soi TRUNG LẬP không cộng dồn", () => {
  it("áp lại nhiều lần trong cùng một vòng cho ra cùng một điểm", () => {
    /*
     * Ca hồi quy, tái hiện đúng con số đã đo: với seed "review", bốn lần áp
     * cùng một kết quả cho ra 29.88 → 59.76 → 89.64 → 100, trong khi danh sách
     * bằng chứng vẫn chỉ có MỘT mục.
     *
     * `observe()` chạy nhiều lần mỗi vòng (mỗi checkpoint của scheduler gọi
     * một lần), nên một niềm tin cộng dồn theo số lần gọi phụ thuộc vào lịch
     * chạy của scheduler - một biến số không liên quan gì tới ván đấu, và đủ
     * để phá tính tái lập theo seed.
     */
    const once = trustAfter(1, "neutral");
    expect(once).toBeGreaterThan(0);
    for (const times of [2, 3, 4, 10]) {
      expect(trustAfter(times, "neutral")).toBe(once);
    }
  });

  it("chỉ ghi đúng MỘT mục bằng chứng dù áp bao nhiêu lần", () => {
    const state = stateFor();
    const knowledge = knowledgeWithSeerResult("jester", "neutral");
    for (let i = 0; i < 5; i += 1) applyPrivateInformation(state, knowledge);

    expect(state.trust.jester.reasons).toHaveLength(1);
    expect(state.trust.jester.reasons[0].kind).toBe("SEER_RESULT_CLEAR");
    expect(state.trust.jester.reasons[0].summary).toContain("trung lập");
  });

  it("KHÔNG bao giờ leo tới trần như một người làng đã được soi sạch", () => {
    // Đây là điều phân biệt "không phải Sói" với "đồng đội thuộc phe Dân", và
    // nó là cả lý do nhánh trung lập tồn tại: một Tiên Tri không được đem uy
    // tín của mình ra bảo lãnh cho kẻ không chơi cho làng.
    expect(trustAfter(10, "neutral")).toBeLessThan(MAX_BELIEF_SCORE);
    expect(trustAfter(10, "village")).toBe(MAX_BELIEF_SCORE);
  });

  it("vẫn xoá sạch nghi ngờ: soi ra trung lập là soi ra KHÔNG phải Sói", () => {
    const state = stateFor();
    state.suspicion.jester = { score: 40, reasons: [], lastUpdatedRound: 0 };
    applyPrivateInformation(state, knowledgeWithSeerResult("jester", "neutral"));

    expect(state.suspicion.jester.score).toBe(0);
  });
});

describe("kết quả soi trung lập sau khi lưu/khôi phục", () => {
  it("nạp lại state rồi observe tiếp không cộng thêm điểm", () => {
    /*
     * Đường đi thật của lỗi này ở production: một ván được lưu vào Redis rồi
     * dựng lại sau restart, và runtime của BOT `observe` tiếp trên cùng kết quả
     * soi cũ. Nếu điểm cộng dồn thì mỗi lần restart lại đẩy niềm tin lên một
     * nấc - và không có gì trong ván giải thích được vì sao.
     */
    const state = stateFor();
    const knowledge = knowledgeWithSeerResult("jester", "neutral");
    applyPrivateInformation(state, knowledge);
    const before = state.trust.jester.score;

    const restored = JSON.parse(JSON.stringify(state)) as BotBrainState;
    applyPrivateInformation(restored, knowledge);
    applyPrivateInformation(restored, knowledge);

    expect(restored.trust.jester.score).toBe(before);
  });
});

describe("thông tin riêng - hành vi soi Dân/Sói giữ nguyên", () => {
  it("soi trúng Sói ghim nghi ngờ lên trần và áp lại là idempotent", () => {
    const state = stateFor();
    const knowledge = knowledgeWithSeerResult("wolf", "wolves");
    applyPrivateInformation(state, knowledge);
    const once = state.suspicion.wolf.score;
    applyPrivateInformation(state, knowledge);
    applyPrivateInformation(state, knowledge);

    expect(once).toBe(MAX_BELIEF_SCORE);
    expect(state.suspicion.wolf.score).toBe(MAX_BELIEF_SCORE);
    expect(state.suspicion.wolf.reasons).toHaveLength(1);
  });

  it("soi ra người làng ghim tin tưởng lên trần và áp lại là idempotent", () => {
    const state = stateFor();
    const knowledge = knowledgeWithSeerResult("villager", "village");
    applyPrivateInformation(state, knowledge);
    applyPrivateInformation(state, knowledge);

    expect(state.trust.villager.score).toBe(MAX_BELIEF_SCORE);
    expect(state.suspicion.villager.score).toBe(0);
  });

  it("một kết quả soi MỚI ở người khác vẫn được ghi bình thường", () => {
    // Chặn đúng cái bẫy của mọi bản vá kiểu "đã áp rồi thì thôi": khoá phải
    // theo TỪNG mục tiêu, không phải một cờ chung cho cả bảng.
    const state = stateFor();
    applyPrivateInformation(state, knowledgeWithSeerResult("jester", "neutral"));
    applyPrivateInformation(state, knowledgeWithSeerResult("villager", "village", 2));

    expect(state.trust.jester.score).toBeGreaterThan(0);
    expect(state.trust.villager.score).toBe(MAX_BELIEF_SCORE);
  });

  it("cùng một người đổi kết quả (trung lập rồi hoá Sói) thì cập nhật theo", () => {
    // Kẻ Nguyền Rủa hoá Sói là ca thật: cùng một mục tiêu, hai đêm, hai kết quả.
    const state = stateFor();
    applyPrivateInformation(state, knowledgeWithSeerResult("jester", "neutral"));
    applyPrivateInformation(state, knowledgeWithSeerResult("jester", "wolves", 2));

    expect(state.suspicion.jester.score).toBe(MAX_BELIEF_SCORE);
  });
});
