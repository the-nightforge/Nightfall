import { describe, expect, it } from "vitest";
import { LAST_LETTER_MAX_LENGTH } from "@masoi/shared";
import type { Role } from "@masoi/shared";
import { decideLastLetter } from "../src/bot/decision/last-letter-decision";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import type { BotBrainState, BotDecisionContext, BotKnowledgeView } from "../src/bot/types";

/**
 * Phong thư của BOT.
 *
 * Ba ràng buộc, và ràng buộc thứ ba là ràng buộc khó nhất:
 *   1. TẤT ĐỊNH: cùng state cho ra cùng chữ, không đọc đồng hồ, không random.
 *   2. Đúng pha, đúng trạng thái sống - y hệt luật của người thật.
 *   3. KHÔNG RÒ THÔNG TIN NGOÀI QUYỀN CỦA VAI. Một lá thư mở ra giữa ban ngày
 *      thì cả làng đọc, nên nó là một đường rò rộng bằng cả bàn chơi. Dân Làng
 *      không được viết ra kết quả soi; Sói không được viết ra danh sách đồng bọn.
 */

const PLAYERS = [
  { id: "b1", name: "Bot", alive: true },
  { id: "p2", name: "Bình", alive: true },
  { id: "p3", name: "Cường", alive: true },
  { id: "p4", name: "Dũng", alive: true },
  { id: "p5", name: "Hạnh", alive: false },
];

function knowledge(overrides: Partial<BotKnowledgeView> = {}): BotKnowledgeView {
  return {
    botId: "b1",
    round: 2,
    phase: "DAY_DISCUSSION",
    phaseStartedAt: 0,
    phaseEndsAt: null,
    selfRole: "VILLAGER",
    players: PLAYERS,
    knownRoles: {},
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
  };
}

function context(overrides: Partial<BotKnowledgeView> = {}): BotDecisionContext {
  return { knowledge: knowledge(overrides), visibleChat: [] };
}

function brain(suspicion: Record<string, number> = {}): BotBrainState {
  const state = createBotBrainState(
    "b1",
    createBotPersonality(createSeededRng("seed-cố-định")),
    PLAYERS.map((player) => player.id),
  );
  for (const [id, score] of Object.entries(suspicion)) {
    state.suspicion[id] = { score, reasons: [], lastUpdatedRound: 1 };
  }
  return state;
}

describe("khi nào BOT viết", () => {
  it("viết trong DAY_DISCUSSION khi còn sống", () => {
    const letter = decideLastLetter(context(), brain({ p2: 30 }));
    expect(letter.text).not.toBeNull();
  });

  it("không viết ở pha khác", () => {
    for (const phase of ["NIGHT", "VOTING", "DEFENSE", "FINAL_VOTE", "GAME_OVER"] as const) {
      expect(decideLastLetter(context({ phase }), brain({ p2: 30 })).text).toBeNull();
    }
  });

  it("BOT đã chết không viết", () => {
    const dead = PLAYERS.map((player) =>
      player.id === "b1" ? { ...player, alive: false } : player,
    );
    expect(decideLastLetter(context({ players: dead }), brain({ p2: 30 })).text).toBeNull();
  });

  it("không nghi ai thì im lặng, không bịa ra một lá thư rỗng nghĩa", () => {
    expect(decideLastLetter(context(), brain()).text).toBeNull();
  });
});

describe("tất định", () => {
  it("cùng state cho ra cùng chữ, qua nhiều lần gọi", () => {
    const first = decideLastLetter(context(), brain({ p2: 30, p3: 12 }));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(decideLastLetter(context(), brain({ p2: 30, p3: 12 })).text).toBe(first.text);
    }
  });

  it("hoà điểm nghi ngờ vẫn ra cùng một người - phân định theo id", () => {
    const a = decideLastLetter(context(), brain({ p4: 20, p2: 20, p3: 20 }));
    const b = decideLastLetter(context(), brain({ p3: 20, p2: 20, p4: 20 }));
    expect(a.text).toBe(b.text);
  });

  it("không bao giờ vượt trần độ dài", () => {
    const longNames = PLAYERS.map((player) => ({ ...player, name: "N".repeat(80) }));
    const letter = decideLastLetter(context({ players: longNames }), brain({ p2: 40 }));
    expect(letter.text!.length).toBeLessThanOrEqual(LAST_LETTER_MAX_LENGTH);
  });
});

describe("nội dung theo vai", () => {
  it("phe làng ghi tên người bị nghi nhất", () => {
    const letter = decideLastLetter(context(), brain({ p2: 10, p3: 40 }));
    expect(letter.text).toContain("Cường");
    expect(letter.text).not.toContain("Bình");
  });

  it("không nhắc người đã chết - chỉ ra họ thì chẳng treo được ai", () => {
    const letter = decideLastLetter(context(), brain({ p5: 99, p2: 5 }));
    expect(letter.text).toContain("Bình");
    expect(letter.text).not.toContain("Hạnh");
  });

  it("không bao giờ tự tố chính mình", () => {
    const letter = decideLastLetter(context(), brain({ b1: 99, p2: 5 }));
    expect(letter.text).toContain("Bình");
    expect(letter.text).not.toContain("Bot");
  });

  it("Tiên Tri được ghi kết quả THỰC SỰ đã soi", () => {
    const letter = decideLastLetter(
      context({
        selfRole: "SEER",
        seerResult: { targetId: "p3", targetName: "Cường", isWolf: true, team: "wolves" },
      }),
      brain({ p2: 40 }),
    );
    expect(letter.text).toContain("Cường");
    expect(letter.text).toMatch(/soi/i);
  });

  it("Tiên Tri chưa soi ai thì viết như phe làng, không bịa kết quả", () => {
    const letter = decideLastLetter(context({ selfRole: "SEER" }), brain({ p2: 40 }));
    expect(letter.text).toContain("Bình");
    expect(letter.text).not.toMatch(/soi/i);
  });

  it("Sói buộc tội một người KHÔNG phải đồng bọn", () => {
    const wolfKnowledge: Partial<BotKnowledgeView> = {
      selfRole: "WEREWOLF",
      knownRoles: { b1: "WEREWOLF" as Role, p2: "WEREWOLF" as Role },
    };
    // Nghi ngờ cao nhất rơi vào chính đồng bọn: Sói vẫn phải chỉ sang người khác.
    const letter = decideLastLetter(context(wolfKnowledge), brain({ p2: 90, p3: 10 }));
    expect(letter.text).toContain("Cường");
    expect(letter.text).not.toContain("Bình");
  });

  it("Sói chỉ còn một mình vẫn viết được, không kẹt", () => {
    const letter = decideLastLetter(
      context({ selfRole: "WEREWOLF", knownRoles: { b1: "WEREWOLF" as Role } }),
      brain({ p3: 30 }),
    );
    expect(letter.text).toContain("Cường");
  });
});

describe("không rò thông tin bí mật", () => {
  it("phe làng không viết ra vai của ai", () => {
    const letter = decideLastLetter(
      context({ knownRoles: { p2: "WEREWOLF" as Role } }),
      brain({ p2: 40 }),
    );
    expect(letter.text).not.toMatch(/Ma Sói|WEREWOLF|Tiên Tri|SEER/);
  });

  it("Sói không viết ra tên đồng bọn dưới bất kỳ dạng nào", () => {
    const letter = decideLastLetter(
      context({
        selfRole: "WEREWOLF",
        knownRoles: { b1: "WEREWOLF" as Role, p2: "WEREWOLF" as Role },
      }),
      brain({ p3: 30 }),
    );
    expect(letter.text).not.toContain("Bình");
    expect(letter.text).not.toMatch(/WEREWOLF|đồng bọn|phe tôi/i);
  });

  it("Tiên Tri chỉ viết ra kết quả engine đã cấp, không viết knownRoles", () => {
    const letter = decideLastLetter(
      context({
        selfRole: "SEER",
        seerResult: { targetId: "p3", targetName: "Cường", isWolf: false, team: "village" },
        knownRoles: { p4: "WEREWOLF" as Role },
      }),
      brain({ p2: 40 }),
    );
    expect(letter.text).toContain("Cường");
    expect(letter.text).not.toContain("Dũng");
  });
});
