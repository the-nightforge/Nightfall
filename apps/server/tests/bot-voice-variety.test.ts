import { describe, expect, it } from "vitest";
import { BOT_SPEECH_KINDS, analyzeChat, looksCasual } from "@masoi/game-engine";
import type { BotSpeechKind } from "@masoi/game-engine";
import { speechDefaults } from "./helpers/speech-request";
import { VOICE_HINTS, buildDaySpeechPrompt, voiceHintFor } from "../src/bots/prompt";
import type { SpeechRequest } from "../src/bots/types";

/**
 * Giọng của BOT đến từ câu lệnh, không từ bảng mẫu.
 *
 * Ván thật cho thấy hai con BOT liên tiếp nói gần như một câu: "Mình đang nghi
 * X nhất, ông nói rõ căn cứ đi, đừng né." Không phải vì chúng nghe nhau - mà vì
 * cả hai nhận CÙNG một câu lệnh cố định, và mô hình diễn đạt lại chính câu lệnh
 * đó, giữ nguyên cả văn phong chỉnh chu của nó.
 *
 * Ba khẳng định ở đây khoá cả ba mặt của lỗi ấy: mỗi ý định phải có NHIỀU cách
 * nói, cách nói phải viết bằng ĐÚNG giọng muốn nhận lại, và câu gợi ý phải đọc
 * được bằng CHÍNH parser của hệ thống - nếu không thì BOT lại sinh ra thứ tiếng
 * mà đồng loại nó không hiểu, đúng vòng lặp đã đo được trong phòng thật.
 */

const PLAYERS = [
  { id: "bot", name: "Bot", alive: true },
  { id: "c", name: "Chi", alive: true },
];

function request(over: Partial<SpeechRequest> = {}): SpeechRequest {
  return {
    roomCode: "ABCDE",
    speaker: { id: "bot", name: "Bot" },
    ...speechDefaults(),
    intention: {
      kind: "ACCUSE",
      targetId: "c",
      tone: "NEUTRAL",
      confidence: 0.8,
      evidence: [],
    },
    evidence: [{ sourceId: "vote:1", summary: "đổi phiếu sát giờ chót" }],
    targetName: "Chi",
    ...over,
  };
}

/** Thay chỗ trống bằng đúng những gì prompt thật sẽ thay vào. */
function fill(hint: string): string {
  return hint.replace(/\{who\}/g, "Chi").replace(/\{author\}/g, "Chi").replace(/\{role\}/g, "Tiên Tri");
}

function read(text: string) {
  return analyzeChat([{ id: "m1", actorId: "bot", text, at: 1 }], PLAYERS)
    .filter((memory) => memory.type !== "DIRECT_ADDRESS" && memory.type !== "DIRECT_QUESTION")
    .map((memory) => ({ type: memory.type, targetId: memory.targetId, role: memory.data.role }));
}

describe("mỗi ý định có nhiều cách nói", () => {
  it("phủ đủ mọi loại phát ngôn, mỗi loại ít nhất ba cách", () => {
    for (const kind of BOT_SPEECH_KINDS) {
      expect({ kind, count: VOICE_HINTS[kind].length }).toEqual({
        kind,
        count: expect.any(Number),
      });
      expect(VOICE_HINTS[kind].length, kind).toBeGreaterThanOrEqual(3);
    }
  });

  it("không cách nói nào trùng nhau trong cùng một ý định", () => {
    for (const kind of BOT_SPEECH_KINDS) {
      expect(new Set(VOICE_HINTS[kind]).size, kind).toBe(VOICE_HINTS[kind].length);
    }
  });

  it("chỗ trống chỉ dùng ba khoá mà prompt biết thay", () => {
    for (const kind of BOT_SPEECH_KINDS) {
      for (const hint of VOICE_HINTS[kind]) {
        for (const slot of hint.match(/\{[a-z]+\}/g) ?? []) {
          expect({ kind, hint, slot }).toEqual({
            kind,
            hint,
            slot: expect.stringMatching(/^\{(who|author|role)\}$/),
          });
        }
      }
    }
  });
});

describe("gợi ý viết bằng giọng chat, không phải giọng văn bản", () => {
  const all = BOT_SPEECH_KINDS.flatMap((kind) =>
    VOICE_HINTS[kind].map((hint) => ({ kind, hint })),
  );

  it("không câu nào kết thúc bằng dấu chấm", () => {
    for (const { kind, hint } of all) {
      expect({ kind, hint, endsWithDot: hint.endsWith(".") }).toEqual({
        kind,
        hint,
        endsWithDot: false,
      });
    }
  });

  it("không câu nào mở đầu bằng chữ hoa, trừ khi bắt đầu bằng tên người", () => {
    for (const { kind, hint } of all) {
      const first = hint[0]!;
      expect({ kind, hint, ok: first === "{" || first === first.toLowerCase() }).toEqual({
        kind,
        hint,
        ok: true,
      });
    }
  });

  it("câu nào cũng ngắn - tối đa chín tiếng", () => {
    for (const { kind, hint } of all) {
      // COUNTER_CLAIM được nới, và đó là giới hạn của PARSER chứ không phải
      // một lựa chọn về giọng: `parseCounterClaim` chỉ nhận đúng cặp mẫu
      // "<tên> không thể là <vai>, tôi mới là <vai>", tức mười một tiếng trước
      // khi thêm chữ nào. Nới được mẫu đó thì siết lại được con số này.
      const limit = kind === "COUNTER_CLAIM" ? 13 : 9;
      const words = fill(hint).split(/\s+/).filter(Boolean).length;
      expect({ kind, hint, ok: words <= limit }).toEqual({ kind, hint, ok: true });
    }
  });

  it("đậu chính cây thước mà báo cáo dùng để chấm câu đã phát", () => {
    // `looksCasual` là thước của `casualToneRate` trong báo cáo self-play.
    // Dùng lại đúng nó ở đây là điều kiện để hai đầu không trôi khỏi nhau: thứ
    // ta ĐƯA VÀO cho mô hình và thứ ta ĐO khi nó trả lời phải cùng một chuẩn.
    for (const { kind, hint } of all) {
      expect({ kind, hint, casual: looksCasual(fill(hint)) }).toEqual({
        kind,
        hint,
        casual: true,
      });
    }
  });

  it("không dùng lối viết trang trọng mà mô hình hay chép lại", () => {
    // Đúng những cụm đã thấy trong ván thật. Chúng không sai ngữ pháp - chúng
    // chỉ là giọng viết, và giọng viết là thứ mô hình bắt chước.
    for (const { kind, hint } of all) {
      for (const stiff of ["và muốn nói ra", "điều đó", "hãy ", "cho rằng", "buộc họ"]) {
        expect({ kind, hint, stiff, has: hint.includes(stiff) }).toEqual({
          kind,
          hint,
          stiff,
          has: false,
        });
      }
    }
  });
});

describe("câu gợi ý đọc được bằng chính parser của hệ thống", () => {
  /**
   * Vòng lặp phải khép: câu lệnh dạy mô hình nói kiểu gì thì `chat-analysis`
   * phải đọc được đúng kiểu ấy. Ván thật đứt ở đây - lệnh dạy "đang nghi", còn
   * parser chỉ biết "nghi".
   */
  it("mọi cách nói buộc tội đều ra ACCUSE đúng người", () => {
    for (const hint of VOICE_HINTS.ACCUSE) {
      expect(read(fill(hint)), hint).toContainEqual(
        expect.objectContaining({ type: "ACCUSE", targetId: "c" }),
      );
    }
  });

  it("mọi cách nói bênh vực đều ra DEFEND đúng người", () => {
    for (const hint of VOICE_HINTS.DEFEND) {
      expect(read(fill(hint)), hint).toContainEqual(
        expect.objectContaining({ type: "DEFEND", targetId: "c" }),
      );
    }
  });

  it("đổi ý cũng là một lời buộc tội đọc được", () => {
    for (const hint of VOICE_HINTS.CHANGE_MIND) {
      expect(read(fill(hint)), hint).toContainEqual(
        expect.objectContaining({ type: "ACCUSE", targetId: "c" }),
      );
    }
  });

  it("mọi cách khai vai đều ra ROLE_CLAIM đúng vai", () => {
    for (const hint of VOICE_HINTS.CLAIM_ROLE) {
      expect(read(fill(hint)), hint).toContainEqual(
        expect.objectContaining({ type: "ROLE_CLAIM", role: "SEER" }),
      );
    }
  });

  it("mọi cách phản bác đều ra COUNTER_CLAIM đúng người", () => {
    for (const hint of VOICE_HINTS.COUNTER_CLAIM) {
      expect(read(fill(hint)), hint).toContainEqual(
        expect.objectContaining({ type: "COUNTER_CLAIM", targetId: "c" }),
      );
    }
  });

  /**
   * Khẳng định mạnh nhất của cả file: không một cách nói nào được sinh ra thứ
   * bằng chứng mà ý định của nó KHÔNG chốt.
   *
   * Cùng tinh thần với cổng `claimSurvivesRoundTrip`, mở rộng sang cáo buộc.
   * Một câu gợi ý cho `REPLY` mà đọc ra `ACCUSE` nghĩa là mỗi lần BOT trả lời
   * ai đó, cả bàn ghi nhận một lời tố mà lõi chưa từng quyết - và nó bị ghim
   * vào belief của mọi BOT khác.
   */
  const ALLOWED: Partial<Record<BotSpeechKind, string>> = {
    ACCUSE: "ACCUSE",
    CHANGE_MIND: "ACCUSE",
    DEFEND: "DEFEND",
    CLAIM_ROLE: "ROLE_CLAIM",
    COUNTER_CLAIM: "COUNTER_CLAIM",
  };

  it("không cách nói nào sinh ra bằng chứng ngoài loại của chính nó", () => {
    for (const kind of BOT_SPEECH_KINDS) {
      const allowed = ALLOWED[kind];
      for (const hint of VOICE_HINTS[kind]) {
        const types = [...new Set(read(fill(hint)).map((memory) => memory.type))];
        expect({ kind, hint, types }).toEqual({
          kind,
          hint,
          types: allowed ? [allowed] : [],
        });
      }
    }
  });
});

describe("chọn cách nói tất định, khác nhau giữa các bot và các lượt", () => {
  it("cùng bot, cùng vòng, cùng lượt thì luôn ra cùng một câu", () => {
    const first = voiceHintFor(request({ seq: 3, round: 2 }));
    expect(voiceHintFor(request({ seq: 3, round: 2 }))).toBe(first);
    expect(voiceHintFor(request({ seq: 3, round: 2 }))).toBe(first);
  });

  it("không rút số ngẫu nhiên nào - chỉ băm, nên replay không lệch", () => {
    // `voiceHintFor` là hàm thuần của request; không có tham số rng nào để
    // truyền, và đó chính là khẳng định.
    expect(voiceHintFor.length).toBe(1);
  });

  it("hai bot khác nhau ở cùng lượt không nhận cùng một câu", () => {
    const hints = new Set(
      ["p1", "p2", "p3", "p4", "p5", "p6"].map((id) =>
        voiceHintFor(request({ speaker: { id, name: id } })),
      ),
    );
    expect(hints.size).toBeGreaterThan(1);
  });

  it("một bot nói nhiều lượt thì câu gợi ý đổi theo", () => {
    const hints = new Set([0, 1, 2, 3, 4, 5].map((seq) => voiceHintFor(request({ seq }))));
    expect(hints.size).toBeGreaterThan(1);
  });

  it("mọi câu trả về đều nằm trong bảng của đúng ý định đó", () => {
    const filled = new Set(VOICE_HINTS.ACCUSE.map(fill));
    for (let seq = 0; seq < 20; seq += 1) {
      expect(filled).toContain(voiceHintFor(request({ seq })));
    }
  });
});

describe("prompt mang câu gợi ý mà không mất ràng buộc nào", () => {
  it("gợi ý xuất hiện trong prompt, đã thay tên thật", () => {
    const spec = buildDaySpeechPrompt(request({ seq: 2 }));
    expect(spec.user).toContain(voiceHintFor(request({ seq: 2 })));
  });

  it("vẫn cấm đổi mục tiêu, bịa sự kiện và lộ vai", () => {
    const spec = buildDaySpeechPrompt(request());
    expect(spec.user).toContain("Không được đổi mục tiêu");
    expect(spec.user).toContain("Không được bịa ra sự kiện");
    expect(spec.user).toContain("Không được tiết lộ vai");
  });

  it("vẫn nói rõ đang nhắm ai", () => {
    expect(buildDaySpeechPrompt(request()).user).toContain("Chi");
  });

  it("ý định không có mục tiêu vẫn dựng được prompt", () => {
    const spec = buildDaySpeechPrompt(
      request({
        intention: { kind: "WITHHOLD", tone: "NEUTRAL", confidence: 0.4, evidence: [] },
        targetName: null,
        evidence: [],
      }),
    );
    expect(spec.user.length).toBeGreaterThan(0);
    expect(spec.user).not.toContain("{who}");
  });

  it("không sót chỗ trống nào chưa thay ở mọi loại phát ngôn", () => {
    for (const kind of BOT_SPEECH_KINDS) {
      const spec = buildDaySpeechPrompt(
        request({
          intention: {
            kind,
            targetId: "c",
            tone: "NEUTRAL",
            confidence: 0.5,
            evidence: [],
            ...(kind === "CLAIM_ROLE" || kind === "COUNTER_CLAIM"
              ? { claimedRole: "SEER" as const }
              : {}),
          },
          replyTo: { messageId: "m1", actorName: "Chi", text: "ừ" },
        }),
      );
      expect({ kind, leftover: /\{(who|author|role)\}/.test(spec.user) }).toEqual({
        kind,
        leftover: false,
      });
    }
  });
});
