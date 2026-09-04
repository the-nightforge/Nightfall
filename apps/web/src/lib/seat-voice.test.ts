import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Phase } from "@masoi/shared";
import { seatFrame, seatShowsSpeaking, speakingSeatIds } from "./seat-voice";

/**
 * Hai luật được khoá ở đây, và cả hai đều là luật mà một lần sửa giao diện rất
 * dễ phá mà không ai thấy:
 *
 *   1. trạng thái nói KHÔNG được chen vào bảng màu viền;
 *   2. ô không được phép nói thì không bao giờ sáng, dù LiveKit có báo gì.
 */

const SELECTED = "border-blood-500 bg-blood-600/25 ring-2 ring-blood-500";
const DEAD = "border-night-600/60 bg-night-950/70";
const ME = "border-indigo-400/60 bg-indigo-500/[0.07] shadow-[0_0_22px_-8px_rgba(129,140,248,0.9)]";
const PLAIN = "border-night-600/70 bg-night-800/40";

describe("seatFrame", () => {
  it("giữ nguyên thứ tự ưu tiên: đang chọn > đã chết > là mình > bình thường", () => {
    assert.equal(seatFrame({ selected: true, dead: true, isMe: true }), SELECTED);
    assert.equal(seatFrame({ selected: false, dead: true, isMe: true }), DEAD);
    assert.equal(seatFrame({ selected: false, dead: false, isMe: true }), ME);
    assert.equal(seatFrame({ selected: false, dead: false, isMe: false }), PLAIN);
  });

  /*
   * Ba ca dưới đây là toàn bộ lý do file này tồn tại.
   *
   * `seatFrame` không nhận `isSpeaking`, nên cách duy nhất để chứng minh "voice
   * không đè màu viền" là chứng minh viền của một ô đang nói KHÔNG khác gì viền
   * của chính ô đó lúc im lặng - tức là hàm không có đường nào để biết.
   */
  it("ô đang chọn mà có người nói thì viền vẫn là đỏ blood", () => {
    const silent = seatFrame({ selected: true, dead: false, isMe: false });
    assert.equal(silent, SELECTED);
    // Trạng thái nói được vẽ ở lớp khác (`.seat-voice-halo`), nên nó không có
    // tham số nào ở đây để mà đổi màu.
    assert.equal(seatShowsSpeaking({ isSpeaking: true, dead: false, disabled: false }), true);
    assert.equal(seatFrame({ selected: true, dead: false, isMe: false }), SELECTED);
  });

  it("ô của mình mà đang nói thì vẫn là quầng chàm mềm, không thành viền cứng", () => {
    assert.equal(seatFrame({ selected: false, dead: false, isMe: true }), ME);
    assert.equal(seatShowsSpeaking({ isSpeaking: true, dead: false, disabled: false }), true);
    assert.equal(seatFrame({ selected: false, dead: false, isMe: true }), ME);
  });

  it("ô đã chết thì viền xám, và không bao giờ sáng dù voice có báo", () => {
    assert.equal(seatFrame({ selected: false, dead: true, isMe: false }), DEAD);
    assert.equal(seatShowsSpeaking({ isSpeaking: true, dead: true, disabled: false }), false);
  });
});

describe("seatShowsSpeaking", () => {
  it("ô đang tắt không bao giờ sáng", () => {
    assert.equal(seatShowsSpeaking({ isSpeaking: true, dead: false, disabled: true }), false);
  });

  it("không ai nói thì không sáng", () => {
    assert.equal(seatShowsSpeaking({ isSpeaking: false, dead: false, disabled: false }), false);
  });
});

const PLAYERS = [
  { id: "accused", alive: true },
  { id: "villager", alive: true },
  { id: "ghost", alive: false },
];

function ids(set: ReadonlySet<string>): string[] {
  return [...set].sort();
}

describe("speakingSeatIds", () => {
  it("không ai nói thì trả về cùng MỘT tập rỗng, không dựng Set mới", () => {
    const a = speakingSeatIds({ speakers: new Set(), players: PLAYERS, phase: "DEFENSE" });
    const b = speakingSeatIds({ speakers: new Set(), players: PLAYERS, phase: "VOTING" });
    assert.equal(a.size, 0);
    assert.equal(a, b);
  });

  /*
   * Pha DEFENSE.
   *
   * `voiceCanPublish` ở `packages/shared/src/voice.ts` MỞ biện hộ cho mọi người
   * còn sống - biện hộ từng là lượt nói độc quyền của bị cáo, và file luật ghi
   * rõ việc mở ra là đánh đổi có chủ ý. Test này khoá đúng cái luật ĐÓ: nếu ai
   * đó siết `voiceCanPublish` lại thành "chỉ bị cáo", test này đổ và bắt người
   * sửa nhìn vào cả hai đầu cùng lúc, thay vì để giao diện tự bịa một luật thứ
   * hai lệch khỏi server.
   */
  it("DEFENSE: mọi người CÒN SỐNG đang nói đều sáng, đúng luật voiceCanPublish", () => {
    const speaking = speakingSeatIds({
      speakers: new Set(["accused", "villager", "ghost"]),
      players: PLAYERS,
      phase: "DEFENSE",
    });
    assert.deepEqual(ids(speaking), ["accused", "villager"]);
  });

  it("DEFENSE: người CHẾT có bị LiveKit báo là đang nói cũng không sáng", () => {
    const speaking = speakingSeatIds({
      speakers: new Set(["ghost"]),
      players: PLAYERS,
      phase: "DEFENSE",
    });
    assert.deepEqual(ids(speaking), []);
  });

  it("NIGHT: không ai được nói, nên không ô nào sáng", () => {
    const speaking = speakingSeatIds({
      speakers: new Set(["accused", "villager"]),
      players: PLAYERS,
      phase: "NIGHT",
    });
    assert.deepEqual(ids(speaking), []);
  });

  it("GAME_OVER: người chết cũng được sáng, vì lúc đó ai cũng được nói", () => {
    const speaking = speakingSeatIds({
      speakers: new Set(["ghost"]),
      players: PLAYERS,
      phase: "GAME_OVER",
    });
    assert.deepEqual(ids(speaking), ["ghost"]);
  });

  it("bỏ qua identity không thuộc phòng - người vừa rời vẫn còn trong room LiveKit", () => {
    const speaking = speakingSeatIds({
      speakers: new Set(["ai-do-khac"]),
      players: PLAYERS,
      phase: "DAY_DISCUSSION" satisfies Phase,
    });
    assert.deepEqual(ids(speaking), []);
  });
});
