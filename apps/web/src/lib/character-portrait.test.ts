import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { portraitMode, portraitSource, BOT_TALK_MS } from "./character-portrait";

const ALIVE = { alive: true, speaking: false, talkingUntilMs: null, nowMs: 1_000 };

describe("portraitMode", () => {
  it("người sống, im lặng thì là mặt bình thường", () => {
    assert.equal(portraitMode(ALIVE), "alive");
  });

  it("đang phát tiếng thì mở miệng", () => {
    assert.equal(portraitMode({ ...ALIVE, speaking: true }), "talking");
  });

  it("người chết thì luôn là mặt chết, kể cả khi caller nói họ đang nói", () => {
    // seatShowsSpeaking đã lọc rồi, nhưng TrialStage gọi useSpeakers() thẳng
    // nên hàng rào thứ hai này là thật chứ không phải phòng thủ thừa.
    assert.equal(portraitMode({ ...ALIVE, alive: false, speaking: true }), "dead");
  });

  it("bot mấp máy khi còn trong cửa sổ sau tin nhắn", () => {
    assert.equal(
      portraitMode({ ...ALIVE, nowMs: 1_000, talkingUntilMs: 1_500 }),
      "talking",
    );
  });

  it("đúng mốc hết cửa sổ là thôi mấp máy", () => {
    // Biên đóng: nowMs === talkingUntilMs nghĩa là cửa sổ đã hết.
    assert.equal(
      portraitMode({ ...ALIVE, nowMs: 1_500, talkingUntilMs: 1_500 }),
      "alive",
    );
  });

  it("quá mốc thì về mặt bình thường", () => {
    assert.equal(
      portraitMode({ ...ALIVE, nowMs: 1_501, talkingUntilMs: 1_500 }),
      "alive",
    );
  });

  it("bot đã chết thì cửa sổ mấp máy cũng không cứu được", () => {
    assert.equal(
      portraitMode({ ...ALIVE, alive: false, nowMs: 1_000, talkingUntilMs: 1_500 }),
      "dead",
    );
  });

  it("cùng nowMs thì luôn ra cùng kết quả", () => {
    const input = { ...ALIVE, talkingUntilMs: 1_200 };
    assert.equal(portraitMode(input), portraitMode(input));
  });

  it("BOT_TALK_MS đủ dài để đọc hết một câu ngắn", () => {
    assert.equal(BOT_TALK_MS, 1_500);
  });
});

const SOURCE = { isCustom: false, hasSheet: true, saveData: false };

describe("portraitSource", () => {
  it("có sheet và mạng bình thường thì dùng sheet", () => {
    assert.equal(portraitSource(SOURCE), "sheet");
  });

  it("chưa vẽ sheet thì rơi về SVG - đây là trạng thái ngày đầu", () => {
    assert.equal(portraitSource({ ...SOURCE, hasSheet: false }), "svg");
  });

  it("Save-Data thì không tải sheet, dù đã có", () => {
    // Lý do là BĂNG THÔNG. Khác hẳn prefers-reduced-motion, vốn vẫn tải sheet
    // và chỉ ghim frame - xem playbackMode trong cinematic-settings.ts.
    assert.equal(portraitSource({ ...SOURCE, saveData: true }), "svg");
  });

  it("ảnh người chơi tự tải lên thắng mọi thứ khác", () => {
    assert.equal(portraitSource({ ...SOURCE, isCustom: true }), "upload");
  });

  it("ảnh tự tải lên vẫn thắng cả khi bật Save-Data", () => {
    // Ảnh đó đã ở object storage và là danh tính người chơi tự chọn; đổi nó
    // thành một cái bóng vì tiết kiệm dữ liệu là lấy mất thứ họ vừa đặt vào.
    assert.equal(
      portraitSource({ isCustom: true, hasSheet: false, saveData: true }),
      "upload",
    );
  });
});
