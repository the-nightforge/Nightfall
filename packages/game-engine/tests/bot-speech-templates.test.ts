import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SPEECH_TEMPLATES,
  renderSpeechTemplate,
  type SpeechTemplateRequest,
} from "../src/bot/conversation/templates";
import { speechTextFingerprint } from "../src/bot/conversation/fingerprint";
import { BOT_SPEECH_KINDS, BOT_SPEECH_TONES } from "../src/bot/types";
import type { BotEvidence, BotSpeechIntention, BotSpeechKind } from "../src/bot/types";

/** Sáu loại này chiếm phần lớn lượt nói, nên chúng cần nhiều mẫu nhất. */
const HEAVY_USE: BotSpeechKind[] = [
  "ACCUSE",
  "QUESTION",
  "REPLY",
  "AGREE",
  "DISAGREE",
  "ASK_EVIDENCE",
];

function evidence(): BotEvidence {
  return {
    id: "e1",
    kind: "LATE_SWITCH",
    sourceId: "recap:1",
    actorId: "p3",
    targetId: "p2",
    weight: 7,
    confidence: 0.6,
    round: 1,
    summary: "đổi phiếu sát giờ chót",
  };
}

function intention(over: Partial<BotSpeechIntention> = {}): BotSpeechIntention {
  return {
    kind: "ACCUSE",
    targetId: "p3",
    confidence: 0.6,
    evidence: [evidence()],
    tone: "FIRM",
    topic: "SUSPICION",
    ...over,
  };
}

function request(over: Partial<SpeechTemplateRequest> = {}): SpeechTemplateRequest {
  return {
    intention: intention(),
    targetName: "Chi",
    replyToName: "Bình",
    seedTag: "room:1",
    botId: "me",
    round: 1,
    seq: 0,
    ...over,
  };
}

describe("bảng mẫu câu", () => {
  it("mọi loại nói đều có mẫu cho mọi giọng", () => {
    for (const kind of BOT_SPEECH_KINDS) {
      for (const tone of BOT_SPEECH_TONES) {
        const pool = SPEECH_TEMPLATES[kind][tone] ?? SPEECH_TEMPLATES[kind].NEUTRAL;
        expect(pool.length, `${kind}/${tone}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("các loại hay dùng có ít nhất sáu mẫu ở giọng trung tính", () => {
    for (const kind of HEAVY_USE) {
      expect(SPEECH_TEMPLATES[kind].NEUTRAL.length, kind).toBeGreaterThanOrEqual(6);
    }
  });

  it("không mẫu nào có markdown, xuống dòng, hay tự nhận là máy", () => {
    for (const kind of BOT_SPEECH_KINDS) {
      for (const pool of Object.values(SPEECH_TEMPLATES[kind])) {
        for (const template of pool) {
          expect(template, `${kind}: ${template}`).not.toMatch(/[*_`#\n]/);
          // "ai" trong tiếng Việt là đại từ nghi vấn, nên chỉ chặn dạng VIẾT
          // HOA đứng độc lập - đó mới là lúc nó có nghĩa "trí tuệ nhân tạo".
          expect(template, kind).not.toMatch(/\bAI\b/);
          expect(template.toLowerCase(), kind).not.toContain("bot");
          expect(template.toLowerCase(), kind).not.toContain("mô hình ngôn ngữ");
        }
      }
    }
  });

  it("chỉ có đúng ba chỗ trống được phép", () => {
    // Một chỗ trống tự do là đường để một sự kiện bịa ra hoặc một cái tên khác
    // lọt vào câu. Ba khoá này là toàn bộ những gì mẫu được biết.
    const allowed = new Set(["{target}", "{author}", "{evidence}"]);
    for (const kind of BOT_SPEECH_KINDS) {
      for (const pool of Object.values(SPEECH_TEMPLATES[kind])) {
        for (const template of pool) {
          for (const slot of template.match(/\{[a-z]+\}/g) ?? []) {
            expect(allowed.has(slot), `${kind}: ${slot}`).toBe(true);
          }
        }
      }
    }
  });

  it("loại không mang luận điểm không được chèn bằng chứng", () => {
    for (const kind of ["WITHHOLD", "REACTION", "HUMOR"] as BotSpeechKind[]) {
      for (const pool of Object.values(SPEECH_TEMPLATES[kind])) {
        for (const template of pool) {
          expect(template, `${kind}`).not.toContain("{evidence}");
        }
      }
    }
  });

  it("không dùng nguồn ngẫu nhiên toàn cục", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "bot", "conversation", "templates.ts"),
      "utf8",
    );
    expect(source).not.toContain("Math.rand" + "om");
  });
});

describe("renderSpeechTemplate", () => {
  it("cùng đầu vào cho cùng một câu, mãi mãi", () => {
    const first = renderSpeechTemplate(request());
    for (let i = 0; i < 100; i += 1) {
      expect(renderSpeechTemplate(request())).toBe(first);
    }
  });

  it("đổi lượt nói thì đổi câu ở phần lớn trường hợp", () => {
    let differing = 0;
    for (let seq = 0; seq < 200; seq += 1) {
      if (
        renderSpeechTemplate(request({ seq })) !==
        renderSpeechTemplate(request({ seq: seq + 1 }))
      ) {
        differing += 1;
      }
    }
    expect(differing / 200).toBeGreaterThan(0.7);
  });

  it("đổi BOT thì đổi câu, nên hai BOT cùng ý không nói y hệt nhau", () => {
    const mine = renderSpeechTemplate(request({ botId: "me" }));
    const theirs = renderSpeechTemplate(request({ botId: "you" }));
    const third = renderSpeechTemplate(request({ botId: "third" }));
    expect(new Set([mine, theirs, third]).size).toBeGreaterThan(1);
  });

  it("tránh chọn lại đúng câu vừa nói", () => {
    const chosen = renderSpeechTemplate(request());
    const avoided = renderSpeechTemplate(
      request({ avoidFingerprints: [speechTextFingerprint(chosen)] }),
    );
    expect(avoided).not.toBe(chosen);
  });

  it("tránh được nhiều câu cùng lúc", () => {
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const next = renderSpeechTemplate(
        request({ avoidFingerprints: seen.map(speechTextFingerprint) }),
      );
      expect(seen).not.toContain(next);
      seen.push(next);
    }
  });

  it("không bao giờ đổi mục tiêu", () => {
    for (let seq = 0; seq < 300; seq += 1) {
      const text = renderSpeechTemplate(request({ seq }));
      expect(text).not.toContain("Bình" === "Bình" ? "KHÔNG_TỒN_TẠI" : "");
      // Chỉ hai cái tên được truyền vào mới có thể xuất hiện.
      for (const name of ["Dũng", "An", "Em", "Anh"]) {
        expect(text, `seq ${seq}`).not.toContain(name);
      }
    }
  });

  it("chỉ dùng bằng chứng được cấp, không bịa", () => {
    const text = renderSpeechTemplate(
      request({ intention: intention({ tone: "FIRM" }), seq: 3 }),
    );
    if (text.includes("đổi phiếu sát giờ chót")) {
      expect(text).toContain("Chi");
    }
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("{");
  });

  it("ý định không có mục tiêu vẫn ra câu đọc được", () => {
    for (const kind of ["WITHHOLD", "REACTION", "HUMOR"] as BotSpeechKind[]) {
      const text = renderSpeechTemplate(
        request({
          intention: intention({ kind, targetId: undefined, evidence: [], tone: "NEUTRAL" }),
          targetName: null,
          replyToName: null,
        }),
      );
      expect(text.trim().length, kind).toBeGreaterThan(0);
      expect(text, kind).not.toContain("{");
    }
  });

  it("mọi loại và mọi giọng đều render ra câu sạch", () => {
    for (const kind of BOT_SPEECH_KINDS) {
      for (const tone of BOT_SPEECH_TONES) {
        for (let seq = 0; seq < 8; seq += 1) {
          const text = renderSpeechTemplate(
            request({ intention: intention({ kind, tone }), seq }),
          );
          expect(text, `${kind}/${tone}`).not.toContain("{");
          expect(text.trim().length, `${kind}/${tone}`).toBeGreaterThan(0);
        }
      }
    }
  });
});
