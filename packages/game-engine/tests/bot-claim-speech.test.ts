import { describe, expect, it } from "vitest";
import { ROLES, ROLE_META, type Role } from "@masoi/shared";
import { analyzeChat } from "../src/bot/analysis/chat-analysis";
import { BOT_WEIGHTS_V3, BOT_WEIGHTS_V4 } from "../src/bot/config/weights";
import { SPEECH_TEMPLATES, renderSpeechTemplate } from "../src/bot/conversation/templates";
import { planSpeech } from "../src/bot/conversation/speech-planner";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { deriveSpeechStyle } from "../src/bot/personality/speech-style";
import { createSeededRng } from "../src/bot/rng";
import {
  BOT_SPEECH_TONES,
  type BotBrainState,
  type BotDecisionContext,
  type BotMemory,
  type BotSpeechIntention,
} from "../src/bot/types";

const PLAYERS = [
  { id: "p1", name: "An", alive: true },
  { id: "p2", name: "Bình", alive: true },
];

function claimIntention(role: Role, kind: "CLAIM_ROLE" | "COUNTER_CLAIM"): BotSpeechIntention {
  return {
    kind,
    targetId: kind === "COUNTER_CLAIM" ? "p2" : undefined,
    claimedRole: role,
    topic: "ROLE_CLAIM",
    confidence: 0.8,
    evidence: [],
    tone: "FIRM",
  };
}

function render(intention: BotSpeechIntention, seq = 0): string {
  return renderSpeechTemplate({
    intention,
    targetName: intention.targetId ? "Bình" : null,
    replyToName: null,
    seedTag: "ROOM",
    botId: "p1",
    round: 1,
    seq,
  });
}

function claimedRoleIn(text: string): Role | undefined {
  const memories = analyzeChat([{ id: "m1", actorId: "p1", text, at: 0 }], PLAYERS);
  const claim = memories.find((memory) => memory.type === "ROLE_CLAIM");
  return claim?.data.role as Role | undefined;
}

describe("mẫu câu khai vai đọc ngược được", () => {
  // Đây là test chặn A4: hai bảng chữ tiếng Việt song song (ROLE_META và
  // ROLE_PHRASES) sẽ trôi lệch, và ngày đó lời khai của vai mới sẽ lặng lẽ
  // không ai đọc được. Quét TOÀN BỘ vai chứ không lấy mẫu.
  for (const role of ROLES) {
    it(`CLAIM_ROLE cho ${ROLE_META[role].name} quay về đúng vai đó`, () => {
      expect(claimedRoleIn(render(claimIntention(role, "CLAIM_ROLE")))).toBe(role);
    });
  }

  it("mọi giọng đều đọc ngược được, không chỉ giọng mặc định", () => {
    for (const tone of BOT_SPEECH_TONES) {
      const text = render({ ...claimIntention("SEER", "CLAIM_ROLE"), tone });
      expect(claimedRoleIn(text)).toBe("SEER");
    }
  });

  it("mọi mẫu trong bể đều đọc ngược được, không chỉ mẫu đầu", () => {
    for (let seq = 0; seq < 12; seq += 1) {
      expect(claimedRoleIn(render(claimIntention("WITCH", "CLAIM_ROLE"), seq))).toBe("WITCH");
    }
  });

  it("COUNTER_CLAIM sinh ra một phản bác nhắm đúng người", () => {
    const text = render(claimIntention("SEER", "COUNTER_CLAIM"));
    const memories = analyzeChat([{ id: "m1", actorId: "p1", text, at: 0 }], PLAYERS);
    const counter = memories.find((memory) => memory.type === "COUNTER_CLAIM");
    expect(counter?.targetId).toBe("p2");
    expect(counter?.data.role).toBe("SEER");
  });
});

/**
 * Sweep trực tiếp mọi mẫu trong `SPEECH_TEMPLATES`, không đi qua
 * `renderSpeechTemplate`.
 *
 * Lý do tách riêng khối này: chỉ số mẫu của `renderSpeechTemplate` là hash của
 * `(seedTag, botId, round, seq, kind, targetId, replyToMessageId, topic)` và
 * KHÔNG phụ thuộc `tone`. Ba `it` phía trên dùng chung `seq`/semantic key nên
 * mọi giọng luôn rơi vào đúng MỘT chỉ số mẫu như nhau; seq-sweep phía trên
 * cũng chỉ chạy trên một giọng (WITCH/FIRM); còn COUNTER_CLAIM không được
 * sweep chỉ số nào cả. Cộng lại, phần lớn mẫu trong bể chưa từng được render
 * qua bất kỳ test nào — hai mẫu SOFT[2]/PLAYFUL[2] hỏng trước đây chỉ bị bắt
 * vì tình cờ trúng đúng chỉ số mà vòng lặp giọng ở trên chạm tới.
 *
 * Khối này đọc thẳng bảng mẫu và tự điền `{role}`/`{target}`, nên độ phủ là
 * CẤU TRÚC: một mẫu thêm sau này vào `SPEECH_TEMPLATES` tự động bị quét, không
 * phụ thuộc hash rơi trúng đâu.
 */
function fillRaw(template: string, role: Role, target = "Bình"): string {
  return template.replaceAll("{role}", ROLE_META[role].name).replaceAll("{target}", target);
}

describe("mọi mẫu trong SPEECH_TEMPLATES đọc ngược được, quét trực tiếp", () => {
  for (const role of ROLES) {
    for (const [tone, pool] of Object.entries(SPEECH_TEMPLATES.CLAIM_ROLE)) {
      (pool ?? []).forEach((template, index) => {
        it(`CLAIM_ROLE ${tone}[${index}] cho ${role} đọc ngược đúng vai`, () => {
          const text = fillRaw(template, role);
          const memories = analyzeChat([{ id: "m1", actorId: "p1", text, at: 0 }], PLAYERS);
          const claim = memories.find((memory) => memory.type === "ROLE_CLAIM");
          expect(claim?.data.role, text).toBe(role);
        });
      });
    }
  }

  for (const role of ROLES) {
    for (const [tone, pool] of Object.entries(SPEECH_TEMPLATES.COUNTER_CLAIM)) {
      (pool ?? []).forEach((template, index) => {
        it(`COUNTER_CLAIM ${tone}[${index}] cho ${role} đọc ngược đúng vai và đúng người`, () => {
          const text = fillRaw(template, role);
          const memories = analyzeChat([{ id: "m1", actorId: "p1", text, at: 0 }], PLAYERS);
          const counter = memories.find((memory) => memory.type === "COUNTER_CLAIM");
          expect(counter?.targetId, text).toBe("p2");
          expect(counter?.data.role, text).toBe(role);
        });
      });
    }
  }
});

// Sao chép từ bot-claim-decision.test.ts thay vì import chéo giữa hai file
// test: mỗi file test giữ nguyên bộ fixture của mình để không file nào âm thầm
// vỡ khi file kia đổi shape.
const CLAIM_SPEECH_IDS = ["p1", "p2", "p3", "p4"];

function stateFor(id: string): BotBrainState {
  return createBotBrainState(id, createBotPersonality(createSeededRng(id)), CLAIM_SPEECH_IDS);
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
      players: CLAIM_SPEECH_IDS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
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

function styleFor(state: BotBrainState) {
  return deriveSpeechStyle(state.personality);
}

describe("planner phát ra lời khai", () => {
  it("Tiên Tri cầm kết quả trúng Sói thì nói ra, kèm tên con Sói", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push(seerResultMemory("p3"));
    const speech = planSpeech({
      context: contextFor("p1", "SEER"),
      state,
      vote: { kind: "VOTE", choice: { type: "PLAYER", targetId: "p3" }, confidence: 0.9, evidence: [] },
      style: styleFor(state),
      rng: createSeededRng("a"),
      weights: BOT_WEIGHTS_V4,
    });
    expect(speech?.kind).toBe("CLAIM_ROLE");
    expect(speech?.claimedRole).toBe("SEER");
    expect(speech?.targetId).toBe("p3");
  });

  it("v3 không bao giờ phát ra lời khai nào", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push(seerResultMemory("p3"));
    const speech = planSpeech({
      context: contextFor("p1", "SEER"),
      state,
      vote: { kind: "VOTE", choice: { type: "PLAYER", targetId: "p3" }, confidence: 0.9, evidence: [] },
      style: styleFor(state),
      rng: createSeededRng("a"),
      weights: BOT_WEIGHTS_V3,
    });
    expect(speech?.kind).not.toBe("CLAIM_ROLE");
  });
});
