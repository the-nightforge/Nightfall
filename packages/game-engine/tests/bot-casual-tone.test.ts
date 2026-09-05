import { describe, expect, it } from "vitest";
import {
  CASUAL_SIGNAL_THRESHOLD,
  casualToneSignals,
  looksCasual,
} from "../src/bot/evaluation/casual-tone";

/**
 * Thước đo giọng. Ca mốc là câu THẬT lấy từ một ván có người chơi - nếu thước
 * này chấm nó là "giọng chat" thì nó vô dụng, vì đó đúng là câu đã khiến người
 * chơi nói bot nghe như máy.
 */
const FROM_REAL_GAME = "Mình đang nghi Phú Lê nhất, ông nói rõ căn cứ đi, đừng né.";

describe("thước đo giọng chat", () => {
  it("chấm trượt đúng câu đã làm hỏng không khí ván thật", () => {
    expect(casualToneSignals(FROM_REAL_GAME)).toEqual({
      startsLower: false,
      noFinalPeriod: false,
      short: false,
      hasCasualToken: false,
    });
    expect(looksCasual(FROM_REAL_GAME)).toBe(false);
  });

  it("chấm đậu những câu người thật gõ", () => {
    for (const text of [
      "t nghi p4",
      "ko chắc lắm",
      "vote Chi đi",
      "ủa khoan, để t nghe thêm đã",
      "hmm thấy hơi lươn =))",
      "thôi khỏi vòng vo, chốt đi cho lẹ",
    ]) {
      expect(looksCasual(text), text).toBe(true);
    }
  });

  it("dấu chấm hỏi và chấm than vẫn là giọng nói", () => {
    expect(casualToneSignals("Chi nghĩ sao?").noFinalPeriod).toBe(true);
    expect(casualToneSignals("Chi im lâu quá!").noFinalPeriod).toBe(true);
  });

  it("mở đầu bằng tên riêng không tự nó làm câu thành trang trọng", () => {
    // Hai dấu hiệu còn lại đủ để đậu: đây là lý do ngưỡng là hai chứ không
    // phải bốn.
    expect(looksCasual("Chi lạ lắm, nghi Chi")).toBe(true);
  });

  it("câu dài, viết hoa, chấm câu đầy đủ thì trượt dù có một chữ teencode", () => {
    const oneSignal =
      "Tôi nghĩ rằng chúng ta nên cân nhắc thật kỹ trước khi đưa ra quyết định treo cổ ai đó r.";
    const signals = casualToneSignals(oneSignal);
    const score = Object.values(signals).filter(Boolean).length;
    expect(score).toBeLessThan(CASUAL_SIGNAL_THRESHOLD);
    expect(looksCasual(oneSignal)).toBe(false);
  });

  it("chữ số và dấu câu ở đầu câu không bị tính là chữ hoa", () => {
    expect(casualToneSignals("100% sói").startsLower).toBe(true);
    expect(casualToneSignals("=)) căng").startsLower).toBe(true);
  });

  it("token teencode phải khớp trọn từ, không phải chuỗi con", () => {
    // "k" nằm trong "kèo", "t" nằm trong "tôi": so chuỗi con thì gần như câu
    // nào cũng có dấu hiệu teencode và cái thước hết đo được gì.
    expect(casualToneSignals("Kèo này khó nói.").hasCasualToken).toBe(false);
    expect(casualToneSignals("Tôi cân nhắc thêm.").hasCasualToken).toBe(false);
    expect(casualToneSignals("t cân nhắc thêm").hasCasualToken).toBe(true);
  });

  it("là hàm thuần, khoảng trắng thừa không đổi kết quả", () => {
    expect(looksCasual("  t nghi p4  ")).toBe(looksCasual("t nghi p4"));
  });
});
