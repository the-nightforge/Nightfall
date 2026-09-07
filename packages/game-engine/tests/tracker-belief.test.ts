import { describe, expect, it } from "vitest";
import type { PublicVoteChoice } from "@masoi/shared";
import { applyPrivateInformation } from "../src/bot/belief/private-info";
import { decayBeliefs } from "../src/bot/belief/belief-state";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import type { BotKnowledgeView } from "../src/bot/types";

const PLAYERS = ["me", "a", "b", "c"];

// Chép nguyên từ `tests/bot-weights.test.ts` để không lệch khuôn dữ liệu giữa
// hai file test; thêm `trackerResult` cho đúng nhu cầu của file này.
function knowledge(over: Partial<BotKnowledgeView> = {}): BotKnowledgeView {
  return {
    dayOfTruthClaims: {},
    neutralRolesInPlay: [],
    activeEventId: null,
    botId: "me",
    round: 2,
    phase: "VOTING",
    phaseStartedAt: 0,
    phaseEndsAt: 30_000,
    selfRole: "VILLAGER",
    players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
    knownRoles: { me: "VILLAGER" },
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
    legalVoteChoices: [
      { type: "PLAYER", targetId: "a" },
      { type: "PLAYER", targetId: "b" },
      { type: "PLAYER", targetId: "c" },
      { type: "NO_ELIMINATION" },
    ] as PublicVoteChoice[],
    lastNightDeaths: [],
    ...over,
  };
}

describe("kết quả theo dõi đi vào bảng belief", () => {
  it("ra tay thì cộng nghi ngờ lên mục tiêu", () => {
    const state = createBotBrainState("me", createBotPersonality(createSeededRng("p")), ["me", "a"]);
    applyPrivateInformation(state, knowledge({
      selfRole: "TRACKER",
      trackerResult: { targetId: "a", acted: true },
    }));
    expect(state.suspicion.a.score).toBeGreaterThan(0);
  });

  it("không ra tay thì gỡ tội nhẹ", () => {
    /*
     * `suspicion` có sàn tại 0 (xem `MIN_BELIEF_SCORE` / `neutralBelief`): "chưa
     * làm gì" nghĩa là "chưa có bằng chứng nào", không phải một mức tín nhiệm âm.
     * Vì vậy áp thẳng bằng chứng IDLE lên một mục tiêu trung lập không đẩy được
     * điểm xuống dưới 0 - phép thử đúng là so sánh TRƯỚC/SAU trên một mục tiêu
     * đã có sẵn nghi ngờ, để thấy IDLE kéo điểm đó xuống.
     */
    const state = createBotBrainState("me", createBotPersonality(createSeededRng("p")), ["me", "a"]);
    applyPrivateInformation(state, knowledge({
      round: 1,
      selfRole: "TRACKER",
      trackerResult: { targetId: "a", acted: true },
    }));
    const before = state.suspicion.a.score;

    applyPrivateInformation(state, knowledge({
      round: 2,
      selfRole: "TRACKER",
      trackerResult: { targetId: "a", acted: false },
    }));
    expect(state.suspicion.a.score).toBeLessThan(before);
  });

  it("NGUỘI ĐI, khác kết quả soi", () => {
    /*
     * Kết quả soi là sự thật về PHE - đúng mãi mãi, nên được miễn decay. Kết
     * quả theo dõi là sự thật về MỘT HÀNH VI TRONG MỘT ĐÊM: nó không nói người
     * đó là Sói, và đêm sau nó đã cũ. Ghim nó ngang kết quả soi sẽ đóng đinh
     * nghi ngờ cả ván lên một Bảo Vệ đang làm việc chăm chỉ.
     */
    const state = createBotBrainState("me", createBotPersonality(createSeededRng("p")), ["me", "a"]);
    applyPrivateInformation(state, knowledge({
      selfRole: "TRACKER",
      trackerResult: { targetId: "a", acted: true },
    }));
    const before = state.suspicion.a.score;
    decayBeliefs(state, 5);
    expect(state.suspicion.a.score).toBeLessThan(before);
  });
});
