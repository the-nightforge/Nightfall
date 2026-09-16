import { describe, expect, it } from "vitest";
import { HEARD_AS, speechIsHeard } from "../src/bot/analysis/speech-heard";
import { BOT_SPEECH_KINDS, type BotPlayerKnowledge } from "../src/bot/types";

const PLAYERS: BotPlayerKnowledge[] = [
  { id: "p1", name: "An", alive: true },
  { id: "p2", name: "Bình", alive: true },
];

/**
 * `speechIsHeard` là ĐỊNH NGHĨA dùng chung của "câu này có đến được với bàn
 * không" - self-play đóng dấu `heard` bằng nó, `metrics.ts` cộng kết quả, và
 * `speech-renderer` chấm câu của nhà cung cấp bằng nó. Ba nơi đọc thì luật
 * phải có test riêng, không chỉ được kiểm gián tiếp qua bảng mẫu.
 */
describe("speechIsHeard", () => {
  it("đọc ra đúng loại thì true", () => {
    expect(speechIsHeard("ACCUSE", "Tôi nghi Bình", "p1", PLAYERS)).toBe(true);
    expect(speechIsHeard("DEFEND", "Tôi tin Bình", "p1", PLAYERS)).toBe(true);
    expect(speechIsHeard("CLAIM_ROLE", "Tôi là Tiên Tri", "p1", PLAYERS)).toBe(true);
    expect(speechIsHeard("QUESTION", "Bình ơi, nói đi", "p1", PLAYERS)).toBe(true);
  });

  it("câu không mang việc gì thì false, dù nó vẫn là một câu hợp lệ", () => {
    // Đây là cả bài toán: người đọc chat thấy BOT nói, còn BOT khác thì không.
    expect(speechIsHeard("ACCUSE", "Bình đi, rõ rồi còn gì", "p1", PLAYERS)).toBe(false);
    expect(speechIsHeard("DEFEND", "Để Bình nói đã", "p1", PLAYERS)).toBe(false);
  });

  it("đọc ra loại NGƯỢC DẤU thì false, kể cả khi loại đúng cũng có mặt", () => {
    // "đẩy " là một động từ phiếu: câu này vừa bênh Bình vừa tố Bình. Một lời
    // bênh kèm một lời tố vào chính người được bênh tệ hơn im lặng, nên phép
    // kiểm "có chứa DEFEND không" là phép kiểm sai.
    const both = "đẩy Bình hoài, Bình ổn mà";
    expect(speechIsHeard("DEFEND", both, "p1", PLAYERS)).toBe(false);
  });

  it("loại không nói thay lõi trả null, không phải false", () => {
    // null giữ chúng ra khỏi MẪU SỐ. Đếm thành false thì tỉ lệ sẽ đổi khi tính
    // cách bot đổi (nói nhiều `AGREE` hơn) chứ không khi tầng diễn đạt hỏng.
    for (const kind of ["AGREE", "DISAGREE", "CHANGE_MIND", "WITHHOLD", "REACTION", "HUMOR"] as const) {
      expect(speechIsHeard(kind, "Tôi nghi Bình", "p1", PLAYERS), kind).toBeNull();
    }
  });

  it("người gửi tự nêu tên mình không tính là nói với ai", () => {
    expect(speechIsHeard("REPLY", "An ơi, tôi đây", "p1", PLAYERS)).toBe(false);
  });

  it("mọi loại nói đều được phân loại - không có ô nào bị bỏ quên", () => {
    // Thêm một speech kind mới mà quên quyết định "nó có nói thay lõi không"
    // phải là một test ĐỎ, không phải một ô lặng lẽ rơi vào nhánh null.
    const decided = new Set<string>([
      ...Object.keys(HEARD_AS),
      "AGREE", "DISAGREE", "CHANGE_MIND", "WITHHOLD", "REACTION", "HUMOR",
    ]);
    for (const kind of BOT_SPEECH_KINDS) {
      expect(decided.has(kind), kind).toBe(true);
    }
  });
});
