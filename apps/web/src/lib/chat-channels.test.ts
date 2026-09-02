import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Phase, RoomSnapshot } from "@masoi/shared";
import {
  chatComposerState,
  chatHeading,
  presentChannels,
  readableChannels,
} from "./chat-channels";

function snapshot(patch: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    phase: "DAY_DISCUSSION" as Phase,
    round: 1,
    players: [],
    you: { id: "me", name: "Tôi", alive: true },
    trial: null,
    hunterShot: null,
    activeEvent: null,
    ...patch,
  } as unknown as RoomSnapshot;
}

const defenseOf = (accusedId: string) =>
  snapshot({
    phase: "DEFENSE",
    trial: { accusedId, accusedName: "Hải Yến" } as RoomSnapshot["trial"],
  });

describe("readableChannels", () => {
  it("người còn sống ban ngày chỉ đọc kênh làng", () => {
    assert.deepEqual(readableChannels(snapshot()), ["day"]);
  });

  it("người chết đọc cả ba kênh trong trận", () => {
    assert.deepEqual(readableChannels(snapshot({ you: { id: "me", alive: false } as never })), [
      "day",
      "wolves",
      "dead",
    ]);
  });

  it("Sói đọc hang Sói ban đêm, dân thì không đọc gì", () => {
    const wolf = snapshot({ phase: "NIGHT", you: { id: "me", alive: true, role: "WEREWOLF" } as never });
    const villager = snapshot({ phase: "NIGHT", you: { id: "me", alive: true, role: "VILLAGER" } as never });

    assert.deepEqual(readableChannels(wolf), ["wolves"]);
    assert.deepEqual(readableChannels(villager), []);
  });

  it("Đêm Tĩnh Lặng đóng cả kênh đọc của Sói", () => {
    const wolf = snapshot({
      phase: "NIGHT",
      you: { id: "me", alive: true, role: "WEREWOLF" } as never,
      activeEvent: { id: "SILENT_NIGHT" } as never,
    });

    assert.deepEqual(readableChannels(wolf), []);
  });

  it("hết ván thì mở toàn bộ log", () => {
    assert.deepEqual(readableChannels(snapshot({ phase: "GAME_OVER" })), [
      "lobby",
      "day",
      "wolves",
      "dead",
    ]);
  });
});

describe("chatHeading", () => {
  it("một kênh thì tiêu đề mang đúng tên kênh đó", () => {
    assert.equal(chatHeading(snapshot()).title, "Kênh làng");
  });

  /*
   * Đây là lỗi trong ảnh chụp màn hình: đầu khung ghi "Kênh người chết" trong
   * khi danh sách bên dưới trộn cả kênh làng lẫn hang Sói.
   */
  it("người chết KHÔNG được thấy tiêu đề mang tên một kênh duy nhất", () => {
    const heading = chatHeading(snapshot({ you: { id: "me", alive: false } as never }));

    assert.notEqual(heading.title, "Kênh người chết");
    assert.equal(heading.title, "Toàn cảnh");
    assert.equal(heading.subtitle, "Làng · Sói · Người chết");
  });
});

describe("presentChannels", () => {
  it("chỉ mở tab cho kênh vừa được phép đọc vừa có tin nhắn thật", () => {
    const dead = snapshot({ you: { id: "me", alive: false } as never });
    const channels = presentChannels(dead, [
      { channel: "day" },
      { channel: "dead" },
      { channel: "lobby" },
    ]);

    // lobby bị loại vì người chết không được đọc, wolves bị loại vì chưa có dòng nào.
    assert.deepEqual(channels, ["day", "dead"]);
  });

  it("giữ thứ tự cố định bất kể tin nhắn tới theo thứ tự nào", () => {
    const over = snapshot({ phase: "GAME_OVER" });
    const channels = presentChannels(over, [
      { channel: "dead" },
      { channel: "lobby" },
      { channel: "wolves" },
      { channel: "day" },
    ]);

    assert.deepEqual(channels, ["lobby", "day", "wolves", "dead"]);
  });
});

describe("chatComposerState trong pha biện hộ", () => {
  it("bị cáo gõ được vào kênh làng", () => {
    const state = chatComposerState(defenseOf("me"));

    assert.equal(state.canSend, true);
    assert.equal(state.channel, "day");
    assert.equal(state.placeholder, "Nhập lời biện hộ...");
    assert.equal(state.reason, "");
  });

  it("người sống khác bị khoá và đọc được lý do kèm tên người đang nói", () => {
    const state = chatComposerState(defenseOf("hai-yen"));

    assert.equal(state.canSend, false);
    assert.equal(state.channel, null);
    assert.equal(state.placeholder, "Đang lắng nghe Hải Yến...");
    assert.equal(state.reason, "Chỉ Hải Yến được nói trong lúc biện hộ.");
  });

  it("người chết vẫn nhắn được kênh người chết trong lúc biện hộ", () => {
    // Cùng thứ tự nhánh với resolveChat trên server: nhánh người chết đứng
    // TRƯỚC cổng biện hộ, nếu không họ bị khoá oan.
    const state = chatComposerState(
      snapshot({
        phase: "DEFENSE",
        you: { id: "me", alive: false } as never,
        trial: { accusedId: "hai-yen", accusedName: "Hải Yến" } as RoomSnapshot["trial"],
      }),
    );

    assert.equal(state.canSend, true);
    assert.equal(state.channel, "dead");
    assert.equal(state.placeholder, "Nhắn kênh người chết...");
  });
});

describe("chatComposerState ở các pha khác", () => {
  it("mở lại cho cả làng ở vòng bỏ phiếu xác nhận", () => {
    assert.deepEqual(chatComposerState(snapshot({ phase: "FINAL_VOTE" })), {
      canSend: true,
      channel: "day",
      placeholder: "Chat làng...",
      reason: "",
    });
  });

  it("dân làng bị khoá ban đêm", () => {
    const state = chatComposerState(
      snapshot({ phase: "NIGHT", you: { id: "me", alive: true, role: "VILLAGER" } as never }),
    );

    assert.equal(state.canSend, false);
    assert.match(state.reason, /chỉ phe Sói/);
  });

  it("Sói Con vào được hang Sói y như Sói thường", () => {
    // Đọc theo PHE trong ROLE_META, không so thẳng với "WEREWOLF".
    const state = chatComposerState(
      snapshot({ phase: "NIGHT", you: { id: "me", alive: true, role: "WOLF_CUB" } as never }),
    );

    assert.equal(state.canSend, true);
    assert.equal(state.channel, "wolves");
  });

  it("Đêm Tĩnh Lặng khoá cả Sói", () => {
    const state = chatComposerState(
      snapshot({
        phase: "NIGHT",
        you: { id: "me", alive: true, role: "WEREWOLF" } as never,
        activeEvent: { id: "SILENT_NIGHT" } as never,
      }),
    );

    assert.equal(state.canSend, false);
    assert.match(state.reason, /Đêm Tĩnh Lặng/);
  });

  it("Thợ Săn chưa bắn thì chưa vào được kênh người chết", () => {
    const state = chatComposerState(
      snapshot({
        phase: "HUNTER_SHOT",
        you: { id: "me", alive: false } as never,
        hunterShot: { hunterId: "me", canAct: true, resolved: false } as never,
      }),
    );

    assert.equal(state.canSend, false);
    assert.match(state.reason, /Bắn xong/);
  });

  it("người chết khác vẫn nhắn được trong lúc Thợ Săn phản kích", () => {
    const state = chatComposerState(
      snapshot({
        phase: "HUNTER_SHOT",
        you: { id: "me", alive: false } as never,
        hunterShot: { hunterId: "", canAct: false, resolved: false } as never,
      }),
    );

    assert.equal(state.canSend, true);
    assert.equal(state.channel, "dead");
  });

  it("pha không mở kênh nào thì khoá thay vì mời gõ vào kênh làng", () => {
    // CHECK_WIN rơi vào nhánh cuối của server; bản cũ vẫn in "Chat làng...".
    const state = chatComposerState(snapshot({ phase: "CHECK_WIN" }));

    assert.equal(state.canSend, false);
    assert.equal(state.placeholder, "Bạn không thể nói lúc này");
  });

  it("chưa có snapshot thì không mời gõ", () => {
    assert.equal(chatComposerState(null).canSend, false);
  });

  it("người ngoài phòng không gõ được, và cũng không mở tab kênh nào", () => {
    const outsider = snapshot({ you: null });

    assert.equal(chatComposerState(outsider).canSend, false);
    assert.deepEqual(readableChannels(outsider), []);
  });
});
