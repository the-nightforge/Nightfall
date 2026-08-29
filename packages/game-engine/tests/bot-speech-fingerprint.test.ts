import { describe, expect, it } from "vitest";
import {
  normalizeSpeechText,
  openingOf,
  speechSemanticFingerprint,
  speechTextFingerprint,
} from "../src/bot/conversation/fingerprint";
import type { BotEvidence, BotSpeechIntention } from "../src/bot/types";

function evidence(sourceId: string): BotEvidence {
  return {
    id: `${sourceId}:ACCUSE:x`,
    kind: "ACCUSE",
    sourceId,
    actorId: "p2",
    targetId: "p1",
    weight: 4,
    confidence: 0.45,
    round: 1,
    summary: "tóm tắt",
  };
}

function intention(over: Partial<BotSpeechIntention> = {}): BotSpeechIntention {
  return {
    kind: "ACCUSE",
    targetId: "p1",
    confidence: 0.5,
    evidence: [],
    tone: "FIRM",
    topic: "SUSPICION",
    ...over,
  };
}

describe("normalizeSpeechText", () => {
  it("bỏ dấu câu và gộp khoảng trắng", () => {
    expect(normalizeSpeechText("Tôi nghi An!!!")).toBe("tôi nghi an");
    expect(normalizeSpeechText("  tôi   nghi   an  ")).toBe("tôi nghi an");
  });

  it("bỏ từ đệm Ở ĐẦU câu", () => {
    expect(normalizeSpeechText("Ừ, tôi nghi An")).toBe("tôi nghi an");
    expect(normalizeSpeechText("hmm khoan đã, tôi nghi An")).toBe("đã tôi nghi an");
  });

  it("KHÔNG bỏ từ đệm nằm giữa câu", () => {
    // "tôi không tin thì thôi" và "tôi không tin" là hai ý khác nhau. Chuẩn hoá
    // quá tay biến chúng thành một, và bộ đếm lặp sẽ báo động giả mãi mãi.
    expect(normalizeSpeechText("tôi không tin thì thôi")).not.toBe(
      normalizeSpeechText("tôi không tin"),
    );
  });

  it("giữ nguyên dấu tiếng Việt", () => {
    expect(normalizeSpeechText("sói")).not.toBe(normalizeSpeechText("soi"));
  });

  it("một câu toàn từ đệm không rút về rỗng vô nghĩa", () => {
    expect(normalizeSpeechText("Ừ.")).toBe("ừ");
    expect(normalizeSpeechText("hmm")).toBe("hmm");
  });
});

describe("speechTextFingerprint", () => {
  it("hai cách viết cùng một câu cho cùng vân tay", () => {
    expect(speechTextFingerprint("Tôi nghi An!!!")).toBe(speechTextFingerprint("tôi   nghi an"));
    expect(speechTextFingerprint("Ừ, tôi nghi An")).toBe(speechTextFingerprint("Tôi nghi An."));
  });

  it("hai câu khác nhau cho vân tay khác nhau", () => {
    expect(speechTextFingerprint("tôi nghi An")).not.toBe(speechTextFingerprint("tôi nghi Bình"));
  });

  it("vân tay là chuỗi hex ổn định, không phải object", () => {
    const fp = speechTextFingerprint("tôi nghi An");
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
    expect(speechTextFingerprint("tôi nghi An")).toBe(fp);
  });
});

describe("speechSemanticFingerprint", () => {
  const base = intention();

  it("đổi loại ý định thì đổi vân tay", () => {
    expect(speechSemanticFingerprint(intention({ kind: "QUESTION" }))).not.toBe(
      speechSemanticFingerprint(base),
    );
  });

  it("đổi mục tiêu thì đổi vân tay", () => {
    expect(speechSemanticFingerprint(intention({ targetId: "p9" }))).not.toBe(
      speechSemanticFingerprint(base),
    );
  });

  it("đổi message được phản hồi thì đổi vân tay", () => {
    expect(speechSemanticFingerprint(intention({ replyToMessageId: "m7" }))).not.toBe(
      speechSemanticFingerprint(base),
    );
  });

  it("đổi topic thì đổi vân tay", () => {
    expect(speechSemanticFingerprint(intention({ topic: "VOTE" }))).not.toBe(
      speechSemanticFingerprint(base),
    );
  });

  it("đổi tập bằng chứng thì đổi vân tay", () => {
    expect(speechSemanticFingerprint(intention({ evidence: [evidence("m1")] }))).not.toBe(
      speechSemanticFingerprint(base),
    );
  });

  it("THỨ TỰ bằng chứng không đổi vân tay", () => {
    // Cùng luận điểm, chỉ khác thứ tự liệt kê, vẫn là cùng một ý.
    const a = intention({ evidence: [evidence("m1"), evidence("m2")] });
    const b = intention({ evidence: [evidence("m2"), evidence("m1")] });
    expect(speechSemanticFingerprint(a)).toBe(speechSemanticFingerprint(b));
  });

  it("tone KHÔNG tham gia vân tay ngữ nghĩa", () => {
    // Cùng một ý nói bằng hai giọng vẫn là lặp ý. Nếu tone tham gia, một BOT
    // lặp mãi cùng luận điểm chỉ cần đổi giọng là lách được cơ chế chống lặp.
    expect(speechSemanticFingerprint(intention({ tone: "SOFT" }))).toBe(
      speechSemanticFingerprint(intention({ tone: "TENSE" })),
    );
  });
});

describe("openingOf", () => {
  it("lấy ba token đầu sau khi bỏ từ đệm", () => {
    expect(openingOf("Ừ khoan đã, tôi nghi An")).toBe("đã tôi nghi");
  });

  it("câu ngắn hơn ba token vẫn ra chuỗi không rỗng", () => {
    expect(openingOf("Ừ.")).toBe("ừ");
  });

  it("hai câu cùng cách mở đầu, khác phần sau, cho cùng opening", () => {
    expect(openingOf("tôi nghi An vì lá phiếu")).toBe(openingOf("tôi nghi An thật đấy"));
  });

  it("chuỗi rỗng trả về null chứ không phải chuỗi rỗng", () => {
    expect(openingOf("   ")).toBeNull();
  });
});
