import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SPEECH_TEMPLATES,
  fillSpeechTemplate,
  renderSpeechTemplate,
  templatePoolSizes,
  type SpeechTemplateRequest,
} from "../src/bot/conversation/templates";
import { speechTextFingerprint } from "../src/bot/conversation/fingerprint";
import { analyzeChat } from "../src/bot/analysis/chat-analysis";
import { BOT_SPEECH_KINDS, BOT_SPEECH_TONES } from "../src/bot/types";
import type {
  BotEvidence,
  BotSpeechIntention,
  BotSpeechKind,
  BotSpeechTone,
} from "../src/bot/types";

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

  it("chỉ có đúng bốn chỗ trống được phép", () => {
    // Một chỗ trống tự do là đường để một sự kiện bịa ra hoặc một cái tên khác
    // lọt vào câu. Bốn khoá này là toàn bộ những gì mẫu được biết. `{role}` do
    // Task 2 thêm cho CLAIM_ROLE/COUNTER_CLAIM, luôn được `fill()` thay bằng
    // `ROLE_META[claimedRole].name` chứ không phải chuỗi tự do.
    const allowed = new Set(["{target}", "{author}", "{evidence}", "{role}"]);
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

/**
 * Task A — bảng mẫu giống người chat hơn.
 *
 * Ba thứ được đo ở đây, và cả ba đều là thứ một người đọc chat nhận ra ngay:
 * bể mẫu đủ rộng để không thấy lặp, một phần đáng kể là câu cụt/teencode, và
 * một chút "nhiễu người" (hạ chữ đầu, typo hiếm) đi qua đúng một hàm băm chứ
 * không qua RNG.
 */
const CLAIM_KINDS = new Set<BotSpeechKind>(["CLAIM_ROLE", "COUNTER_CLAIM"]);

/** Dấu hiệu teencode/câu chat mà người Việt thật hay gõ. */
const TEEN_MARKERS = new Set([
  "k", "ko", "ủa", "alo", "hmm", "kk", "kkk", "hóng", "ok", "oke", "okie", "nha", "nè",
  "ơ", "vl", "dc", "đc", "z", "j", "mn", "ae", "t", "m", "vs", "chớ", "quá", "ê",
]);

function tokensOf(template: string): string[] {
  return template
    .replace(/\{[a-z]+\}/g, " ")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function isTeenOrShort(template: string): boolean {
  if (template.includes("=))") || template.includes("quay xe")) return true;
  const tokens = tokensOf(template);
  if (tokens.length <= 4) return true;
  return tokens.some((token) => TEEN_MARKERS.has(token));
}

const PLAYERS = [
  { id: "me", name: "An", alive: true },
  { id: "p3", name: "Chi", alive: true },
  { id: "p4", name: "Bình", alive: true },
];

function memoriesOf(text: string) {
  return analyzeChat([{ id: "m", actorId: "me", text, at: 0 }], PLAYERS);
}

describe("bảng mẫu mở rộng", () => {
  it("mọi loại x mọi giọng có ít nhất 12 mẫu", () => {
    for (const kind of BOT_SPEECH_KINDS) {
      const sizes = templatePoolSizes(kind);
      for (const tone of BOT_SPEECH_TONES) {
        expect(sizes[tone], `${kind}/${tone}`).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it("không giọng nào phải rơi về NEUTRAL nữa", () => {
    for (const kind of BOT_SPEECH_KINDS) {
      for (const tone of BOT_SPEECH_TONES) {
        expect(SPEECH_TEMPLATES[kind][tone], `${kind}/${tone}`).toBeDefined();
      }
    }
  });

  it("ít nhất 30% mẫu của mỗi loại là câu cụt hoặc teencode", () => {
    for (const kind of BOT_SPEECH_KINDS) {
      const all = Object.values(SPEECH_TEMPLATES[kind]).flat();
      const teen = all.filter(isTeenOrShort).length;
      expect(teen / all.length, `${kind}: ${teen}/${all.length}`).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("không có hai mẫu y hệt nhau trong cùng một bể", () => {
    for (const kind of BOT_SPEECH_KINDS) {
      for (const [tone, pool] of Object.entries(SPEECH_TEMPLATES[kind])) {
        expect(new Set(pool).size, `${kind}/${tone}`).toBe(pool.length);
      }
    }
  });

  it("mẫu ngoài nhóm khai vai không bao giờ đọc ngược ra một lời khai", () => {
    // Đường bảng mẫu KHÔNG đi qua cổng `claimSurvivesRoundTrip` ở server, nên
    // mẫu là chỗ duy nhất gác việc này. Một câu đùa "tôi là dân đây" ở HUMOR sẽ
    // ghim một ROLE_CLAIM vĩnh viễn vào state của mọi BOT khác.
    for (const kind of BOT_SPEECH_KINDS) {
      if (CLAIM_KINDS.has(kind)) continue;
      for (const [tone, pool] of Object.entries(SPEECH_TEMPLATES[kind])) {
        for (const template of pool) {
          const text = fillSpeechTemplate(template, request({ intention: intention({ kind }) }));
          const claim = memoriesOf(text).find(
            (memory) => memory.type === "ROLE_CLAIM" || memory.type === "COUNTER_CLAIM",
          );
          expect(claim, `${kind}/${tone}: ${text}`).toBeUndefined();
        }
      }
    }
  });

  it("mẫu không nhắm ai thì không được sinh cáo buộc hay bênh vực", () => {
    // WITHHOLD/REACTION/HUMOR không mang mục tiêu. Nếu một mẫu trong đó tình
    // cờ khớp "X là sói" với X là tên ai đó thì nó vừa bịa ra một cáo buộc.
    for (const kind of ["WITHHOLD", "REACTION", "HUMOR"] as BotSpeechKind[]) {
      for (const [tone, pool] of Object.entries(SPEECH_TEMPLATES[kind])) {
        for (const template of pool) {
          const text = fillSpeechTemplate(template, request({ intention: intention({ kind }) }));
          const parsed = memoriesOf(text).find(
            (memory) => memory.type === "ACCUSE" || memory.type === "DEFEND",
          );
          expect(parsed, `${kind}/${tone}: ${text}`).toBeUndefined();
        }
      }
    }
  });

  it("mẫu cáo buộc vẫn có một phần đọc ngược được thành ACCUSE", () => {
    // Bot khác đọc chat bằng parser. Nếu KHÔNG mẫu nào còn "tôi nghi X" thì
    // belief của cả bàn mất một nguồn, và win-rate trôi vì một lý do không ai
    // thấy. Không đòi tất cả - người thật cũng không nói vậy - chỉ đòi còn.
    for (const tone of BOT_SPEECH_TONES) {
      const parsed = SPEECH_TEMPLATES.ACCUSE[tone]!.filter((template) => {
        const text = fillSpeechTemplate(template, request());
        return memoriesOf(text).some(
          (memory) => memory.type === "ACCUSE" && memory.targetId === "p3",
        );
      });
      expect(parsed.length, tone).toBeGreaterThanOrEqual(1);
    }
  });

  it("mẫu bênh vực vẫn có một phần đọc ngược được thành DEFEND", () => {
    for (const tone of BOT_SPEECH_TONES) {
      const parsed = SPEECH_TEMPLATES.DEFEND[tone]!.filter((template) => {
        const text = fillSpeechTemplate(template, request({ intention: intention({ kind: "DEFEND" }) }));
        return memoriesOf(text).some(
          (memory) => memory.type === "DEFEND" && memory.targetId === "p3",
        );
      });
      expect(parsed.length, tone).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("nhiễu người trong renderSpeechTemplate", () => {
  function upperFirst(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  interface NoiseCounts {
    clean: number;
    lowered: number;
    typo: number;
    /** Câu (không typo) mà mẫu gốc mở đầu bằng CHỮ HOA, tức hạ chữ đầu mới thấy được. */
    letterStart: number;
  }

  function sample(kind: BotSpeechKind, tone: BotSpeechTone, bots: number, seqs: number): NoiseCounts {
    const base = request({ intention: intention({ kind, tone, evidence: [evidence()] }) });
    const pool = SPEECH_TEMPLATES[kind][tone]!;
    const cleanOf = new Map(pool.map((template) => [fillSpeechTemplate(template, base), template]));
    const counts: NoiseCounts = { clean: 0, lowered: 0, typo: 0, letterStart: 0 };
    for (let bot = 0; bot < bots; bot += 1) {
      for (let seq = 0; seq < seqs; seq += 1) {
        const text = renderSpeechTemplate({ ...base, botId: `bot-${bot}`, seq });
        const template = cleanOf.get(text) ?? cleanOf.get(upperFirst(text));
        if (template === undefined) {
          counts.typo += 1;
          continue;
        }
        if (cleanOf.has(text)) counts.clean += 1;
        else counts.lowered += 1;
        // Chỉ mẫu mở đầu bằng CHỮ HOA mới "thấy" được việc hạ chữ đầu; mẫu
        // teencode vốn viết thường sẵn thì hạ hay không cũng ra cùng một chuỗi.
        if (/^\p{Uppercase}/u.test(template)) counts.letterStart += 1;
      }
    }
    return counts;
  }

  it("khoảng 30% câu mở đầu bằng chữ được hạ chữ đầu", () => {
    let lowered = 0;
    let letterStart = 0;
    for (const kind of ["ACCUSE", "WITHHOLD", "REPLY", "DISAGREE", "HUMOR"] as BotSpeechKind[]) {
      for (const tone of BOT_SPEECH_TONES) {
        const counts = sample(kind, tone, 6, 20);
        lowered += counts.lowered;
        letterStart += counts.letterStart;
      }
    }
    const rate = lowered / letterStart;
    expect(rate, `${lowered}/${letterStart}`).toBeGreaterThan(0.2);
    expect(rate, `${lowered}/${letterStart}`).toBeLessThan(0.42);
  });

  it("mẫu mở đầu bằng tên người thì tên vẫn viết hoa", () => {
    const base = request({ intention: intention({ kind: "QUESTION", tone: "FIRM" }) });
    for (let seq = 0; seq < 80; seq += 1) {
      const text = renderSpeechTemplate({ ...base, seq });
      expect(text.startsWith("chi")).toBe(false);
    }
  });

  it("typo hiếm: khoảng 2-3% câu, không hơn 5%", () => {
    let typo = 0;
    let total = 0;
    for (const kind of ["ACCUSE", "QUESTION", "WITHHOLD", "REPLY", "DEFEND", "HUMOR"] as BotSpeechKind[]) {
      for (const tone of BOT_SPEECH_TONES) {
        const counts = sample(kind, tone, 12, 20);
        typo += counts.typo;
        total += counts.clean + counts.lowered + counts.typo;
      }
    }
    const rate = typo / total;
    expect(rate, `${typo}/${total}`).toBeGreaterThan(0.005);
    expect(rate, `${typo}/${total}`).toBeLessThan(0.05);
  });

  it("không bao giờ typo ở lời khai vai", () => {
    for (const kind of ["CLAIM_ROLE", "COUNTER_CLAIM"] as BotSpeechKind[]) {
      for (const tone of BOT_SPEECH_TONES) {
        const counts = sample(kind, tone, 30, 12);
        expect(counts.typo, `${kind}/${tone}`).toBe(0);
      }
    }
  });

  it("typo không chạm vào tên người hay chuỗi bằng chứng", () => {
    for (const kind of ["ACCUSE", "QUESTION", "DEFEND", "REPLY", "AGREE"] as BotSpeechKind[]) {
      for (let bot = 0; bot < 40; bot += 1) {
        for (let seq = 0; seq < 12; seq += 1) {
          const text = renderSpeechTemplate(
            request({ intention: intention({ kind, evidence: [evidence()] }), botId: `b${bot}`, seq }),
          );
          // Tên nào xuất hiện thì phải xuất hiện NGUYÊN VẸN; không có dạng "chi"
          // hay "Binh" do rớt dấu/hạ chữ.
          expect(text, text).not.toMatch(/\bchi\b/);
          expect(text, text).not.toMatch(/Binh/);
          if (/sát giờ|gio chot|giờ chót/.test(text)) expect(text, text).toContain("đổi phiếu sát giờ chót");
        }
      }
    }
  });

  it("typo không chạm vào dấu hiệu mà parser dựa vào", () => {
    // "tôi nghi", "đừng treo", "tôi tin", "là sói" là chữ mà bot khác đọc.
    // Rớt dấu ở đó là mất một bằng chứng cho cả bàn.
    for (const kind of ["ACCUSE", "DEFEND"] as BotSpeechKind[]) {
      for (let bot = 0; bot < 60; bot += 1) {
        for (let seq = 0; seq < 12; seq += 1) {
          const text = renderSpeechTemplate(
            request({ intention: intention({ kind }), botId: `b${bot}`, seq }),
          ).toLowerCase();
          expect(text, text).not.toMatch(/\btoi nghi\b|\bdung treo\b|\btoi tin\b|\bla soi\b|\btôinghi\b|\bnghichi\b/);
        }
      }
    }
  });

  it("typo ổn định theo bot và mẫu: cùng bot, cùng mẫu thì cùng chữ", () => {
    // Cơ chế chống lặp so vân tay của câu ĐÃ PHÁT. Nếu cùng một mẫu lúc có typo
    // lúc không tuỳ theo lượt, hai lần phát cùng mẫu có hai vân tay khác nhau và
    // cửa sổ chống lặp không nhận ra chúng là một câu.
    const base = request({ intention: intention({ kind: "ACCUSE", tone: "NEUTRAL" }) });
    const pool = SPEECH_TEMPLATES.ACCUSE.NEUTRAL;
    const clean = new Set(pool.map((template) => fillSpeechTemplate(template, base)));
    for (let bot = 0; bot < 60; bot += 1) {
      /** Vân tay của mọi câu bot này đã phát, không kể hoa/thường chữ đầu. */
      const fingerprints = new Set<string>();
      for (let seq = 0; seq < 60; seq += 1) {
        const text = renderSpeechTemplate({ ...base, botId: `b${bot}`, seq });
        fingerprints.add(speechTextFingerprint(text));
      }
      // Số vân tay khác nhau không được vượt số mẫu: mỗi mẫu đúng MỘT dạng chữ
      // với bot này (sạch, hoặc một typo cố định), không phải hai.
      expect(fingerprints.size, `bot ${bot}`).toBeLessThanOrEqual(clean.size);
    }
  });

  it("cùng đầu vào vẫn cho cùng một câu sau khi có nhiễu", () => {
    for (const kind of BOT_SPEECH_KINDS) {
      const a = renderSpeechTemplate(request({ intention: intention({ kind }), seq: 7 }));
      const b = renderSpeechTemplate(request({ intention: intention({ kind }), seq: 7 }));
      expect(a).toBe(b);
    }
  });

  it("hạ chữ đầu KHÔNG đổi vân tay, nên chống lặp vẫn nhận ra câu cũ", () => {
    const base = request();
    for (let seq = 0; seq < 60; seq += 1) {
      const text = renderSpeechTemplate({ ...base, seq });
      expect(speechTextFingerprint(text)).toBe(speechTextFingerprint(upperFirst(text)));
    }
  });

  it("câu sau nhiễu vẫn sạch: không ngoặc sót, không undefined, không hai khoảng trắng", () => {
    for (const kind of BOT_SPEECH_KINDS) {
      for (const tone of BOT_SPEECH_TONES) {
        for (let bot = 0; bot < 8; bot += 1) {
          for (let seq = 0; seq < 6; seq += 1) {
            const text = renderSpeechTemplate(
              request({ intention: intention({ kind, tone }), botId: `b${bot}`, seq }),
            );
            expect(text, `${kind}/${tone}`).not.toContain("{");
            expect(text, `${kind}/${tone}`).not.toContain("undefined");
            expect(text, `${kind}/${tone}`).not.toMatch(/\s{2}/);
            expect(text.trim(), `${kind}/${tone}`).toBe(text);
          }
        }
      }
    }
  });
});

/**
 * Task B — chống lặp cách mở đầu.
 *
 * "Mọi câu đều bắt đầu bằng *tôi nghi*" là triệu chứng dễ nhận nhất của một
 * bot. Vân tay toàn câu không bắt được nó, nên bảng mẫu nhận thêm
 * `avoidOpenings` và dịch qua mẫu khác khi trùng.
 */
import { openingOf } from "../src/bot/conversation/fingerprint";

describe("renderSpeechTemplate tránh cách mở đầu vừa dùng", () => {
  it("né mẫu có cùng ba token mở đầu với câu gần đây", () => {
    const base = request({ intention: intention({ kind: "ACCUSE", tone: "FIRM" }) });
    for (let seq = 0; seq < 40; seq += 1) {
      const first = renderSpeechTemplate({ ...base, seq });
      const opening = openingOf(first)!;
      const next = renderSpeechTemplate({ ...base, seq, avoidOpenings: [opening] });
      expect(openingOf(next), `seq ${seq}: ${first} -> ${next}`).not.toBe(opening);
    }
  });

  it("một bot không mở ba lượt liên tiếp bằng cùng một cách", () => {
    // Mô phỏng đúng vòng lặp của scheduler: mỗi lượt mang theo cách mở đầu của
    // năm lượt trước. Quét mọi loại có mục tiêu, vì đó là chỗ "tôi nghi X" và
    // "X nói đi" lặp dễ nhất.
    for (const kind of ["ACCUSE", "QUESTION", "AGREE", "DISAGREE", "DEFEND", "CHANGE_MIND"] as BotSpeechKind[]) {
      for (const tone of BOT_SPEECH_TONES) {
        const base = request({ intention: intention({ kind, tone }) });
        const openings: string[] = [];
        for (let seq = 0; seq < 30; seq += 1) {
          const text = renderSpeechTemplate({
            ...base,
            seq,
            avoidOpenings: openings.slice(-5),
            avoidFingerprints: [],
          });
          const opening = openingOf(text)!;
          const last = openings.slice(-2);
          if (last.length === 2 && last[0] === opening && last[1] === opening) {
            throw new Error(`${kind}/${tone}: ba lượt liên tiếp mở bằng "${opening}"`);
          }
          openings.push(opening);
        }
      }
    }
  });

  it("hai bot cùng cáo buộc cùng vòng hiếm khi mở đầu giống nhau", () => {
    let same = 0;
    const trials = 300;
    for (let i = 0; i < trials; i += 1) {
      const base = request({
        intention: intention({ kind: "ACCUSE", tone: "NEUTRAL" }),
        seedTag: `room:${i}`,
        round: 2,
        seq: 3,
      });
      const a = renderSpeechTemplate({ ...base, botId: "a" });
      const b = renderSpeechTemplate({ ...base, botId: "b" });
      if (openingOf(a) === openingOf(b)) same += 1;
    }
    // 13 mẫu nhưng nhiều mẫu mở đầu bằng "{target}" nên trùng ngẫu nhiên vẫn có;
    // ngưỡng 30% cao hơn hẳn mức đo để không đỏ vì đổi một mẫu.
    expect(same / trials).toBeLessThan(0.3);
  });

  it("cả bể trùng mở đầu thì vẫn nói, chỉ không nói lại nguyên câu", () => {
    const base = request({
      intention: intention({ kind: "REACTION", tone: "FIRM" }),
      targetName: null,
      replyToName: null,
    });
    const pool = SPEECH_TEMPLATES.REACTION.FIRM!;
    const everyOpening = pool.map((template) => openingOf(fillSpeechTemplate(template, base))!);
    const text = renderSpeechTemplate({ ...base, avoidOpenings: everyOpening });
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it("avoidOpenings không đổi kết quả khi rỗng: tương thích với chỗ gọi cũ", () => {
    for (let seq = 0; seq < 30; seq += 1) {
      expect(renderSpeechTemplate(request({ seq, avoidOpenings: [] }))).toBe(
        renderSpeechTemplate(request({ seq })),
      );
    }
  });

  it("vai đã xóa (PRIEST/MEDIUM) rơi về 'dân làng', không nổ", () => {
    // Ván cũ/log cũ có thể mang lời khai vai đã bị xóa cứng: đây là đúng chỗ
    // Task 4 từng nổ (`ROLE_META[claimedRole]` trên undefined).
    for (const deleted of ["PRIEST", "MEDIUM"]) {
      const base = request({
        intention: intention({
          kind: "CLAIM_ROLE",
          claimedRole: deleted as unknown as BotSpeechIntention["claimedRole"],
        }),
      });
      const text = fillSpeechTemplate("Tôi là {role}.", base);
      expect(text).toBe("Tôi là dân làng.");
    }
  });
});
