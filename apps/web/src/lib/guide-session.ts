import { GUIDE_COMPLETED_KEY, GUIDE_PREP_KEY_PREFIX, GUIDE_ROOM_KEY_PREFIX } from "./guide-steps";

/**
 * Trạng thái "ván này có hướng dẫn" - ai bật, bật ở đâu, tắt lúc nào.
 *
 * Ba trạng thái theo MÃ PHÒNG, và chúng khác nhau về nghĩa chứ không chỉ về
 * chữ:
 *
 * - `active`: đang hướng dẫn. Thẻ hiện, bàn được chuẩn bị.
 * - `hidden`: người dùng đã bấm "Ẩn". Thẻ KHÔNG hiện, nhưng bàn VẪN được
 *   chuẩn bị - ẩn hướng dẫn chỉ là ẩn lời nhắc, không phải huỷ ván đã xin.
 * - `finished`: đã đi hết ván hướng dẫn trong phòng này. Thẻ chỉ còn hiện
 *   lời tổng kết ở GAME_OVER; ván sau trong cùng phòng, hay tải lại trang,
 *   không tự bật lại. Muốn xem lại thì bấm "Chơi thử có hướng dẫn" ở trang
 *   chủ - đó là một phòng mới.
 *
 * Cờ hiển thị và cờ CHUẨN BỊ là hai cờ: `prepared` (theo mã phòng) ghi rằng
 * bộ bài + bot đã được server xác nhận một lần. Nó tồn tại để tải lại trang
 * sau khi host đã tự chỉnh bộ bài hay đuổi một bot không làm ván bị "sửa"
 * lại theo ý máy.
 *
 * Hai kho, hai vòng đời, và đó là chủ ý:
 *
 * - `sessionStorage` giữ mọi cờ theo mã phòng. Sống qua một lần tải lại trang
 *   (mất mạng, F5) nhưng chết cùng tab, nên một người chơi ván hướng dẫn rồi
 *   ngày mai mở một phòng khác không bị hướng dẫn bám theo. Vào phòng của bạn
 *   qua link thì không có gì hiện ra cả.
 * - `localStorage` giữ cờ ĐÃ HOÀN THÀNH một ván hướng dẫn, để trang chủ hạ
 *   giọng lời mời (không xoá nút - người muốn xem lại vẫn bấm được).
 *
 * Mọi thao tác kho đều bọc try/catch: chế độ riêng tư, chặn cookie hay một
 * Safari đầy bộ nhớ đều ném ở đây, và không cái nào được phép làm hỏng ván.
 * Kho bị chặn thì hướng dẫn chỉ sống trong bộ nhớ của trang - vẫn chuẩn bị
 * bàn được, chỉ không nhớ qua lần tải lại.
 */
export interface GuideStorage {
  session: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  local: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}

export type GuideRoomState = "none" | "active" | "hidden" | "finished";

function browserStorage(): GuideStorage {
  if (typeof window === "undefined") return { session: null, local: null };
  let session: GuideStorage["session"] = null;
  let local: GuideStorage["local"] = null;
  try {
    session = window.sessionStorage;
  } catch {
    session = null;
  }
  try {
    local = window.localStorage;
  } catch {
    local = null;
  }
  return { session, local };
}

function roomKey(code: string): string {
  return `${GUIDE_ROOM_KEY_PREFIX}${code.toUpperCase()}`;
}

function prepKey(code: string): string {
  return `${GUIDE_PREP_KEY_PREFIX}${code.toUpperCase()}`;
}

function writeRoomState(code: string, state: GuideRoomState, storage: GuideStorage): void {
  try {
    if (state === "none") storage.session?.removeItem(roomKey(code));
    else storage.session?.setItem(roomKey(code), state);
  } catch {
    /* kho bị chặn: ván vẫn chạy, chỉ không nhớ qua lần tải lại */
  }
}

export function guideRoomState(code: string, storage: GuideStorage = browserStorage()): GuideRoomState {
  try {
    const raw = storage.session?.getItem(roomKey(code));
    // "1" là giá trị của bản trước khi có ba trạng thái; đọc như `active`.
    if (raw === "1" || raw === "active") return "active";
    if (raw === "hidden" || raw === "finished") return raw;
    return "none";
  } catch {
    return "none";
  }
}

/** Bật hướng dẫn cho phòng này (từ `?guide=1`). Luôn là một lời xin mới. */
export function markGuidedRoom(code: string, storage: GuideStorage = browserStorage()): void {
  writeRoomState(code, "active", storage);
  try {
    storage.session?.removeItem(prepKey(code));
  } catch {
    /* như trên */
  }
}

/** Người dùng bấm "Ẩn": chỉ ẩn thẻ. Bàn vẫn được chuẩn bị. */
export function hideGuide(code: string, storage: GuideStorage = browserStorage()): void {
  if (guideRoomState(code, storage) === "active") writeRoomState(code, "hidden", storage);
}

/** Đi hết ván: khoá phòng này lại và nhớ toàn cục là đã hoàn thành. */
export function finishGuide(code: string, storage: GuideStorage = browserStorage()): void {
  writeRoomState(code, "finished", storage);
  markGuideCompleted(storage);
}

/** Bàn (bộ bài + bot) đã được server xác nhận một lần cho phòng này. */
export function markGuidePrepared(code: string, storage: GuideStorage = browserStorage()): void {
  try {
    storage.session?.setItem(prepKey(code), "1");
  } catch {
    /* như trên */
  }
}

export function isGuidePrepared(code: string, storage: GuideStorage = browserStorage()): boolean {
  try {
    return storage.session?.getItem(prepKey(code)) === "1";
  } catch {
    return false;
  }
}

export function markGuideCompleted(storage: GuideStorage = browserStorage()): void {
  try {
    storage.local?.setItem(GUIDE_COMPLETED_KEY, "1");
  } catch {
    /* xem chú thích ở đầu file */
  }
}

export function hasCompletedGuide(storage: GuideStorage = browserStorage()): boolean {
  try {
    return storage.local?.getItem(GUIDE_COMPLETED_KEY) === "1";
  } catch {
    return false;
  }
}
