import { LAST_LETTER_MAX_LENGTH } from "@masoi/shared";
import type { CaseFile, CaseLastLetter, OpenedLastLetter, RoomSnapshot } from "@masoi/shared";

/**
 * Phần LOGIC của add-on "Phong thư sau cùng" ở phía web.
 *
 * Tách khỏi component vì một lý do rất cụ thể: bộ test của web chạy bằng
 * `node:test` trên `src/lib/*.test.ts`, không có DOM và không render React. Cái
 * gì phải khẳng định được thì phải sống ở đây.
 *
 * Nguyên tắc xuyên suốt file: KHÔNG có hàm nào ở đây tự suy ra quyền. Nó chỉ
 * ĐỌC những cờ mà server đã tính riêng cho người nhận snapshot - `canEdit` là
 * của server, `opened` là của server, và bản nháp của người khác thì đơn giản
 * là không tồn tại trong dữ liệu mà web nhận được.
 */

export { LAST_LETTER_MAX_LENGTH };

// ---- Phòng chờ ----

export interface LastLetterToggleState {
  /** Add-on đang bật hay tắt. Ai cũng thấy. */
  on: boolean;
  /** Người xem có được gạt công tắc không. Chỉ chủ phòng, và chỉ khi chưa vào trận. */
  canToggle: boolean;
}

/**
 * Trạng thái công tắc trong phòng chờ.
 *
 * Khách vẫn THẤY công tắc - biết luật của bàn mình sắp chơi là quyền của họ -
 * nhưng không gạt được. Đây là lý do hàm trả về hai cờ tách bạch thay vì một cờ
 * "hiện hay không": ẩn hẳn nó với khách sẽ khiến add-on thành một bất ngờ giữa
 * ván.
 */
export function lastLetterToggle(
  snapshot: RoomSnapshot | null,
  viewerId: string | null,
): LastLetterToggleState {
  if (!snapshot) return { on: false, canToggle: false };
  return {
    on: snapshot.config.lastLetter === true,
    canToggle: snapshot.phase === "LOBBY" && snapshot.hostId !== null && snapshot.hostId === viewerId,
  };
}

// ---- Ô soạn thư ----

export interface ComposerState {
  /** Có vẽ ô soạn thư không. */
  visible: boolean;
  /** Bản nháp server đang giữ; `null` là chưa có thư nào. */
  saved: string | null;
  /** Vòng bản nháp được niêm phong; `null` khi chưa có. */
  sealedRound: number | null;
}

/**
 * Ô soạn thư có được hiện không, và server đang giữ gì.
 *
 * Ba điều kiện đều đọc từ snapshot chứ không suy ra: add-on bật (`lastLetter`
 * khác null), và `mine.canEdit` - cờ server đã tính từ pha THẬT và trạng thái
 * sống THẬT. Web không tự kiểm `phase === "DAY_DISCUSSION"` lần nữa: hai bản
 * sao của cùng một luật sẽ trôi lệch, và bản ở web thì không có quyền quyết.
 */
export function composerState(snapshot: RoomSnapshot | null): ComposerState {
  const view = snapshot?.lastLetter ?? null;
  if (!view || !view.enabled) return { visible: false, saved: null, sealedRound: null };
  return {
    visible: view.mine.canEdit,
    saved: view.mine.text,
    sealedRound: view.mine.updatedRound,
  };
}

export interface CounterState {
  /** Số ký tự đã dùng, đếm trên nội dung ĐÃ trim - đúng thứ server sẽ lưu. */
  used: number;
  max: number;
  /** "12/100", để hiển thị thẳng. */
  label: string;
  /** Vượt trần: nút phải tắt, và ô nhập phải nói rõ. */
  over: boolean;
}

/**
 * Bộ đếm x/100.
 *
 * Đếm trên bản ĐÃ trim vì đó là con số server dùng để chấp nhận hay từ chối.
 * Đếm trên chuỗi thô thì một người gõ xong rồi bấm dấu cách sẽ thấy 101/100 và
 * nút tắt, trong khi lá thư đó hoàn toàn hợp lệ.
 */
export function counterState(draft: string): CounterState {
  const used = draft.trim().length;
  return {
    used,
    max: LAST_LETTER_MAX_LENGTH,
    label: `${used}/${LAST_LETTER_MAX_LENGTH}`,
    over: used > LAST_LETTER_MAX_LENGTH,
  };
}

export type ComposerAction =
  | { kind: "idle" }
  | { kind: "save"; text: string }
  | { kind: "clear" };

export interface ComposerIntentInput {
  draft: string;
  /** Bản server đang giữ, từ `composerState().saved`. */
  saved: string | null;
  /** Đang chờ snapshot xác nhận lần gửi trước. */
  pending: boolean;
}

/**
 * Bấm "Niêm phong" thì thật sự phải gửi cái gì.
 *
 * `idle` bao trọn mọi lý do KHÔNG gửi, và ba lý do đó không được gộp: đang chờ
 * xác nhận (chặn gửi lặp), nội dung y hệt bản server đang giữ (một lượt ghi
 * Redis cho đúng con số không), và vượt trần.
 *
 * Ô trống là `clear`, không phải `idle`: xoá hết chữ rồi bấm là một Ý ĐỊNH xoá
 * thư, và server nhận `null` cho đúng việc đó. Nhưng nếu vốn chưa có thư nào
 * thì nó thành `idle` - không có gì để xoá.
 */
export function composerIntent(input: ComposerIntentInput): ComposerAction {
  if (input.pending) return { kind: "idle" };

  const trimmed = input.draft.trim();
  if (trimmed.length === 0) {
    return input.saved === null ? { kind: "idle" } : { kind: "clear" };
  }
  if (trimmed.length > LAST_LETTER_MAX_LENGTH) return { kind: "idle" };
  if (trimmed === input.saved) return { kind: "idle" };
  return { kind: "save", text: trimmed };
}

/**
 * Lần gửi đang chờ đã được server xác nhận chưa.
 *
 * Bằng chứng DUY NHẤT là snapshot kế tiếp mang đúng nội dung vừa gửi - không có
 * ack, và không được giả lập lưu thành công. Cùng cách `DayView` chờ xác nhận
 * cho một lá phiếu.
 */
export function isConfirmed(pending: ComposerAction, saved: string | null): boolean {
  if (pending.kind === "idle") return true;
  if (pending.kind === "clear") return saved === null;
  return saved === pending.text;
}

// ---- Hàng đợi mở thư ----

/**
 * Những gì một phiên mở trang cần nhớ về hàng đợi thư.
 *
 * Là DỮ LIỆU THUẦN chứ không phải state trong component, để test bằng
 * `node:test` khẳng định được trọn vòng đời mà không cần DOM. Component chỉ giữ
 * nó trong `useState` và gọi hai hàm dưới đây.
 *
 * Sống đúng bằng phiên mở trang: KHÔNG lên server, không vào localStorage.
 * Server đã có `openedAuthorIds` để bảo đảm mỗi thư chỉ MỞ một lần; cái ở đây
 * chỉ trả lời một câu hẹp hơn nhiều là "người đang ngồi trước màn hình này đã
 * thấy nó chưa", và câu đó không đáng để đồng bộ qua thiết bị.
 */
export interface RevealState {
  /**
   * Thư đã có sẵn ở snapshot ĐẦU TIÊN của phiên này - tức thư "cũ".
   *
   * `null` nghĩa là CHƯA nhận snapshot nào, khác hẳn `[]` (đã nhận, và lúc đó
   * chưa có thư nào). Gộp hai trạng thái này làm một chính là chỗ lỗi sinh ra:
   * `[]` mặc định biến mọi thư trong snapshot đầu tiên thành thư mới.
   */
  baselineIds: string[] | null;
  /** Thư người xem đã tự đóng trong phiên này. */
  dismissedIds: string[];
}

export const EMPTY_REVEAL_STATE: RevealState = { baselineIds: null, dismissedIds: [] };

/**
 * Nhận một snapshot và cập nhật mốc.
 *
 * VÌ SAO CẦN MỐC. Một người tải lại trang giữa trận nhận ngay một snapshot mang
 * đủ mọi lá thư đã mở từ đầu ván - `opened` là danh sách tích luỹ, không phải
 * danh sách "vừa mới mở". Không có mốc thì cả xâu thư đó được trình chiếu lại
 * lần nữa, và lời hứa "mỗi thư chỉ mở một lần" chỉ còn đúng với người không bao
 * giờ bấm F5.
 *
 * Mốc được đặt từ snapshot THẬT đầu tiên, không phải từ lúc render với `null`:
 * trước khi socket trả về thì chưa có gì để làm mốc, và đặt mốc rỗng ở đó sẽ
 * khiến đúng snapshot đầu tiên bị coi là toàn thư mới.
 *
 * Về LOBBY là dọn sạch cả hai: id thư ổn định theo `playerId`, nên cùng một
 * người chết ở hai ván liên tiếp cho ra cùng một id - giữ lại danh sách đã đóng
 * sẽ nuốt mất lá thư của ván MỚI.
 */
export function observeSnapshot(state: RevealState, snapshot: RoomSnapshot | null): RevealState {
  if (!snapshot) return state;
  if (snapshot.phase === "LOBBY") return EMPTY_REVEAL_STATE;
  if (state.baselineIds !== null) return state;
  return {
    baselineIds: (snapshot.lastLetter?.opened ?? []).map((letter) => letter.id),
    dismissedIds: [],
  };
}

/** Người xem đã đóng một lá thư. */
export function dismissReveal(state: RevealState, letterId: string): RevealState {
  if (state.dismissedIds.includes(letterId)) return state;
  return { ...state, dismissedIds: [...state.dismissedIds, letterId] };
}

/**
 * Hàng đợi chỉ chạy TRONG ván, và chỉ gồm thư MỚI so với mốc.
 *
 * Ở GAME_OVER màn kết thúc đã có mục "Những phong thư đã mở" liệt kê trọn vẹn,
 * nên một thẻ hàng đợi ở đó là bản thứ hai của cùng nội dung - và nó lại đứng
 * chen giữa thẻ hero với bảng vai trò, đúng chỗ người chơi đang tìm câu trả lời
 * "ai là ai". Ở sảnh chờ thì đơn giản là chưa có ván nào.
 *
 * Chưa có mốc (`baselineIds === null`) cũng trả rỗng: đó là khung hình trước
 * khi effect kịp chạy, và im lặng một nhịp thì cùng lắm là chậm, còn đoán bừa
 * thì trình chiếu lại cả xâu thư cũ.
 */
function queueOf(state: RevealState, snapshot: RoomSnapshot | null): OpenedLastLetter[] {
  if (!snapshot || snapshot.phase === "GAME_OVER" || snapshot.phase === "LOBBY") return [];
  if (state.baselineIds === null) return [];

  const seen = new Set([...state.baselineIds, ...state.dismissedIds]);
  return (snapshot.lastLetter?.opened ?? []).filter((letter) => !seen.has(letter.id));
}

/**
 * Lá thư kế tiếp cần hiện, hoặc `null` là không còn gì.
 *
 * HÀNG ĐỢI chứ không phải một chồng modal: mở ba lá thư cùng lúc là ba tấm phủ
 * đè lên nhau và người chơi mất luôn thông báo nguyên nhân tử vong nằm dưới.
 * Thứ tự lấy nguyên từ `opened` của server - tức thứ tự tử vong của engine - nên
 * web không tự suy ai chết trước.
 */
export function nextReveal(
  state: RevealState,
  snapshot: RoomSnapshot | null,
): OpenedLastLetter | null {
  return queueOf(state, snapshot)[0] ?? null;
}

/** Còn bao nhiêu lá đang xếp hàng phía sau lá đang hiện. */
export function pendingRevealCount(state: RevealState, snapshot: RoomSnapshot | null): number {
  return Math.max(0, queueOf(state, snapshot).length - 1);
}

export interface RevealCard {
  id: string;
  title: string;
  text: string;
  sealedLabel: string;
}

/**
 * Nội dung một thẻ mở thư.
 *
 * Không nhận `PlayerView`, không tra vai, không nhận `snapshot`: nó chỉ dựng
 * được từ đúng những trường mà `OpenedLastLetter` có - và trường vai thì không
 * tồn tại ở đó. Cái vắng mặt trong chữ ký hàm là thứ chắc chắn không lọt ra
 * màn hình.
 */
export function revealCard(letter: OpenedLastLetter): RevealCard {
  return {
    id: letter.id,
    title: `Phong thư sau cùng của ${letter.authorName}`,
    text: letter.text,
    sealedLabel: `Được niêm phong ở vòng ${letter.sealedRound}`,
  };
}

/**
 * Chuyển động cho thẻ mở thư, đã tôn trọng `prefers-reduced-motion`.
 *
 * Giảm chuyển động là TẮT HẲN chứ không phải làm chậm lại: thẻ vẫn hiện đủ nội
 * dung ngay từ khung hình đầu, chỉ là không trượt và không mờ dần. Cùng thang
 * đo mà `playbackMode` dùng cho chuyển cảnh.
 */
export function revealMotion(prefersReducedMotion: boolean) {
  if (prefersReducedMotion) {
    return {
      initial: { opacity: 1, y: 0 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 1, y: 0 },
      transition: { duration: 0 },
    };
  }
  return {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
    transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const },
  };
}

// ---- Sau trận ----

/**
 * Các lá thư đã mở, đọc từ một hồ sơ vụ án.
 *
 * Trả mảng RỖNG cho hồ sơ ghi trước khi có tính năng này, và cũng rỗng cho hồ
 * sơ có `lastLetters` méo mó: đây là JSON đọc lên từ DB, do một phiên bản server
 * nào đó ghi ra, nên tin nó đúng hình dạng hiện tại là tự chuốc lỗi lúc chạy.
 * Cùng thái độ mà `readStoredCaseFile` đang dùng với chính `CaseFile`.
 */
export function caseFileLetters(file: CaseFile | null): CaseLastLetter[] {
  const raw = (file as { lastLetters?: unknown } | null)?.lastLetters;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (letter): letter is CaseLastLetter =>
      !!letter &&
      typeof letter === "object" &&
      typeof (letter as CaseLastLetter).authorName === "string" &&
      typeof (letter as CaseLastLetter).text === "string" &&
      typeof (letter as CaseLastLetter).sealedRound === "number",
  );
}
