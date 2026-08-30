import { describe, expect, it } from "vitest";
import { ROLES, ROLE_META, type Role } from "@masoi/shared";
import { analyzeChat } from "../src/bot/analysis/chat-analysis";
import { SPEECH_TEMPLATES, renderSpeechTemplate } from "../src/bot/conversation/templates";
import { BOT_SPEECH_TONES, type BotSpeechIntention } from "../src/bot/types";

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
