import { describe, expect, it } from "vitest";
import {
  normalizeSpeechText,
  openingOf,
  speechSemanticFingerprint,
  speechShapeFingerprint,
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

  it("teencode mở đầu cũng là từ đệm: ủa/alo/kkk/haizz không tính vào cách mở đầu", () => {
    // Nếu không thì "ủa, tôi nghi An" và "tôi nghi An" có hai opening khác
    // nhau, và một bot chỉ cần đệm "ủa" là lách được luật chống lặp mở đầu.
    expect(openingOf("ủa, tôi nghi An thật")).toBe("tôi nghi an");
    expect(openingOf("alo alo, tôi nghi An")).toBe("tôi nghi an");
    expect(openingOf("kkk tôi nghi An")).toBe("tôi nghi an");
    expect(openingOf("haizz, tôi nghi An")).toBe("tôi nghi an");
    expect(openingOf("ơ, tôi nghi An")).toBe("tôi nghi an");
  });

  it("chuỗi rỗng trả về null chứ không phải chuỗi rỗng", () => {
    expect(openingOf("   ")).toBeNull();
  });
});

describe("speechShapeFingerprint", () => {
  const NAMES = ["An", "Bình", "Người 2", "Người 12", "Chi"];

  it("cùng khuôn, khác tên người, cho cùng một vân tay", () => {
    // Đây là toàn bộ lý do hàm này tồn tại: `speechTextFingerprint` cho hai giá
    // trị khác nhau ở đúng cặp câu mà người chơi đọc lên thấy y hệt nhau.
    expect(speechShapeFingerprint("hỏi thật, An đang nghĩ gì", NAMES)).toBe(
      speechShapeFingerprint("hỏi thật, Bình đang nghĩ gì", NAMES),
    );
    expect(speechTextFingerprint("hỏi thật, An đang nghĩ gì")).not.toBe(
      speechTextFingerprint("hỏi thật, Bình đang nghĩ gì"),
    );
  });

  it("khác khuôn thì khác vân tay, dù cùng tên", () => {
    expect(speechShapeFingerprint("tôi nghi An", NAMES)).not.toBe(
      speechShapeFingerprint("An nói rõ ra đi", NAMES),
    );
  });

  it("tên nhiều token khớp cả cụm, và tên dài xét trước tên ngắn", () => {
    // "Người 12" phải khớp trọn; nếu "Người 2" hay một token "người" nuốt trước
    // thì phần đuôi rơi lại thành một token số và hai khuôn khác nhau.
    expect(speechShapeFingerprint("tôi nghi Người 12", NAMES)).toBe(
      speechShapeFingerprint("tôi nghi Người 2", NAMES),
    );
    expect(speechShapeFingerprint("tôi nghi Người 12", NAMES)).toBe(
      speechShapeFingerprint("tôi nghi An", NAMES),
    );
  });

  it("dùng chung phép chuẩn hoá với vân tay văn bản", () => {
    // Dấu câu, chữ hoa và từ đệm đầu câu không được tạo ra hai khuôn.
    expect(speechShapeFingerprint("Ừ, tôi nghi An.", NAMES)).toBe(
      speechShapeFingerprint("tôi nghi Bình", NAMES),
    );
  });

  it("không có tên nào trong câu thì bằng đúng vân tay văn bản của câu đó", () => {
    expect(speechShapeFingerprint("thôi chốt đi cho lẹ", NAMES)).toBe(
      speechShapeFingerprint("thôi chốt đi cho lẹ", []),
    );
  });

  it("câu rỗng không ném và không trùng một câu có chữ", () => {
    expect(speechShapeFingerprint("   ", NAMES)).not.toBe(
      speechShapeFingerprint("tôi nghi An", NAMES),
    );
  });
});
