import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  finishGuide,
  guideRoomState,
  hasCompletedGuide,
  hideGuide,
  isGuidePrepared,
  markGuideCompleted,
  markGuidePrepared,
  markGuidedRoom,
  type GuideStorage,
} from "./guide-session";
import { GUIDE_ROOM_KEY_PREFIX } from "./guide-steps";

function memory(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function throwing(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const boom = () => {
    throw new Error("QuotaExceeded");
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

describe("guide-session", () => {
  it("cờ theo mã phòng: bật phòng này không bật phòng khác, không phân biệt hoa thường", () => {
    const storage: GuideStorage = { session: memory(), local: memory() };
    markGuidedRoom("abcde", storage);
    assert.equal(guideRoomState("ABCDE", storage), "active");
    assert.equal(guideRoomState("ZZZZZ", storage), "none");
  });

  it("ba trạng thái tách bạch: đang hướng dẫn -> ẩn -> đã hoàn thành", () => {
    const storage: GuideStorage = { session: memory(), local: memory() };
    markGuidedRoom("ABCDE", storage);
    hideGuide("ABCDE", storage);
    assert.equal(guideRoomState("ABCDE", storage), "hidden");
    // Ẩn không phải là hoàn thành: trang chủ chưa được hạ giọng.
    assert.equal(hasCompletedGuide(storage), false);
    finishGuide("ABCDE", storage);
    assert.equal(guideRoomState("ABCDE", storage), "finished");
    assert.equal(hasCompletedGuide(storage), true);
  });

  it("'Ẩn' chỉ có nghĩa khi đang hướng dẫn: không hồi sinh một phòng đã xong hay chưa từng bật", () => {
    const storage: GuideStorage = { session: memory(), local: memory() };
    hideGuide("ABCDE", storage);
    assert.equal(guideRoomState("ABCDE", storage), "none");
    markGuidedRoom("ABCDE", storage);
    finishGuide("ABCDE", storage);
    hideGuide("ABCDE", storage);
    assert.equal(guideRoomState("ABCDE", storage), "finished");
  });

  it("bật lại từ trang chủ là một lời xin mới: xoá cả dấu 'đã chuẩn bị' của phòng", () => {
    const storage: GuideStorage = { session: memory(), local: memory() };
    markGuidedRoom("ABCDE", storage);
    markGuidePrepared("ABCDE", storage);
    assert.equal(isGuidePrepared("ABCDE", storage), true);
    markGuidedRoom("ABCDE", storage);
    assert.equal(isGuidePrepared("ABCDE", storage), false);
    assert.equal(isGuidePrepared("OTHER", storage), false);
  });

  it("giá trị '1' của bản cũ đọc như 'active'", () => {
    const storage: GuideStorage = { session: memory(), local: memory() };
    storage.session!.setItem(`${GUIDE_ROOM_KEY_PREFIX}ABCDE`, "1");
    assert.equal(guideRoomState("ABCDE", storage), "active");
  });

  it("cờ hoàn thành nằm ở localStorage, tách khỏi cờ phiên", () => {
    const storage: GuideStorage = { session: memory(), local: memory() };
    assert.equal(hasCompletedGuide(storage), false);
    markGuideCompleted(storage);
    assert.equal(hasCompletedGuide(storage), true);
    assert.equal(guideRoomState("ABCDE", storage), "none");
  });

  it("kho ném hoặc vắng mặt thì không ném ra ngoài và đọc ra 'không'", () => {
    const broken: GuideStorage = { session: throwing(), local: throwing() };
    assert.doesNotThrow(() => markGuidedRoom("ABCDE", broken));
    assert.doesNotThrow(() => hideGuide("ABCDE", broken));
    assert.doesNotThrow(() => finishGuide("ABCDE", broken));
    assert.doesNotThrow(() => markGuidePrepared("ABCDE", broken));
    assert.doesNotThrow(() => markGuideCompleted(broken));
    assert.equal(guideRoomState("ABCDE", broken), "none");
    assert.equal(isGuidePrepared("ABCDE", broken), false);
    assert.equal(hasCompletedGuide(broken), false);
    const none: GuideStorage = { session: null, local: null };
    assert.doesNotThrow(() => markGuidedRoom("ABCDE", none));
    assert.equal(guideRoomState("ABCDE", none), "none");
  });
});
