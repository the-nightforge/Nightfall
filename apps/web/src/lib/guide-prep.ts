import { MIN_PLAYERS_TO_START, PRESET_DECKS, type RoomConfig, type RoomSnapshot } from "@masoi/shared";
import { isPresetDeck } from "./lobby-summary";

/**
 * Chuẩn bị bàn cho ván hướng dẫn - phần LUẬT, tách khỏi React và khỏi socket.
 *
 * Ván hướng dẫn hứa với người mới hai điều: bàn 8 người (mình + 7 bot) và bộ
 * bài chuẩn của bàn 8 (`PRESET_DECKS[8]`, có Thợ Săn và Thám Tử - bộ bài mặc
 * định của phòng thường KHÔNG có hai vai này). Cả hai đều là việc của chủ
 * phòng và đều đi qua đúng hai sự kiện mà nút trong phòng chờ gửi:
 * `room:update-config` và `room:add-bot`. Không có đường tắt nào khác.
 *
 * Máy trạng thái này thuần: nhận trạng thái cũ + snapshot vừa thấy + đồng hồ,
 * trả về trạng thái mới, TỐI ĐA MỘT sự kiện cần gửi, và thời điểm cần gọi lại
 * nếu chưa có snapshot mới. Nó không giữ socket, không giữ timer, không đọc
 * kho - nên test được bằng một vòng lặp và một server thật.
 *
 * Ba luật giữ cho nó không phá phòng:
 *
 * 1. CHỈ TIN SNAPSHOT. Gửi xong là "đang chờ", không phải "đã xong". Chỉ khi
 *    snapshot mang cấu hình đúng preset (hoặc sĩ số đã tăng) thì bước đó mới
 *    được coi là xong. Gửi mà không có snapshot xác nhận thì sau
 *    `GUIDE_PREP_RETRY_MS` gửi lại, tối đa `GUIDE_PREP_MAX_ATTEMPTS` lần, rồi
 *    dừng ở `failed` - và `failed` là một trạng thái CÓ LỜI cho người dùng
 *    (thẻ hướng dẫn chỉ họ hai nút để tự làm), không phải một vòng lặp im.
 *    Riêng `add-bot` không idempotent nên KHÔNG gửi lại theo đồng hồ - chỉ khi
 *    có snapshot mới hơn lần gửi mà sĩ số chưa tăng (xem nhánh bot).
 * 2. MỖI LƯỢT MỘT SỰ KIỆN, và cùng một đầu vào cho cùng một đầu ra không gửi.
 *    React StrictMode chạy effect hai lần, reconnect phát lại snapshot cũ,
 *    re-render đọc lại cùng snapshot - tất cả đều rơi vào "đang chờ, chưa tới
 *    giờ gửi lại" nên không nhân đôi bot.
 * 3. LÀM MỘT LẦN. Tới `done` là hết: host đổi bộ bài, đuổi một bot để mời bạn
 *    - không bao giờ bị ghi đè lại. `done` được cất theo mã phòng (xem
 *    `guide-session.ts`) nên tải lại trang cũng không làm lại.
 *
 * Thứ tự cấu hình TRƯỚC, bot SAU là bắt buộc chứ không tuỳ tiện: server chấm
 * cân bằng khi phòng có từ 6 người, và đổi bộ bài trên một bàn đã đủ 8 phải đi
 * qua phép chấm đó; đổi khi bàn còn 1 người thì không.
 */
export const GUIDE_TABLE_SIZE = MIN_PLAYERS_TO_START;
export const GUIDE_DECK: RoomConfig = PRESET_DECKS[GUIDE_TABLE_SIZE]!;

/** Sau chừng này ms không có snapshot xác nhận thì gửi lại. */
export const GUIDE_PREP_RETRY_MS = 3_000;
/** Gửi tới lần này mà vẫn không xác nhận được thì dừng và nói cho người dùng. */
export const GUIDE_PREP_MAX_ATTEMPTS = 3;
/**
 * Riêng `add-bot`: không có snapshot MỚI nào sau khi gửi mà đã qua chừng này
 * ms thì coi là treo và dừng ở `failed`. Xem chú thích ở nhánh bot.
 */
export const GUIDE_PREP_STALL_MS = 3 * GUIDE_PREP_RETRY_MS;

export type GuidePrepStage = "config" | "bots" | "done" | "failed";

export interface GuidePrepPending {
  kind: "config" | "bot";
  /** Với `bot`: sĩ số mà snapshot phải đạt để coi là xác nhận. */
  expectCount: number;
  sentAt: number;
  /** `serverNow` của snapshot đã thấy lúc gửi - để biết snapshot nào là MỚI hơn lần gửi. */
  seenServerNow: number;
  /** Lần gửi thứ mấy cho cùng một bước; 1 là lần đầu. */
  attempt: number;
}

export interface GuidePrepState {
  stage: GuidePrepStage;
  pending: GuidePrepPending | null;
}

export interface GuidePrepInput {
  snapshot: RoomSnapshot | null;
  isHost: boolean;
  connected: boolean;
  now: number;
}

export type GuidePrepEmit =
  | { event: "room:update-config"; payload: { config: RoomConfig } }
  | { event: "room:add-bot"; payload: Record<string, never> };

export interface GuidePrepStep {
  state: GuidePrepState;
  /** Tối đa một sự kiện mỗi lượt. */
  emit: GuidePrepEmit | null;
  /** Gọi lại vào lúc này nếu tới đó vẫn chưa có snapshot mới; `null` là không cần. */
  wakeAt: number | null;
}

export function initialGuidePrepState(alreadyPrepared: boolean): GuidePrepState {
  return { stage: alreadyPrepared ? "done" : "config", pending: null };
}

/** Bộ bài của phòng đã là bộ bài ván hướng dẫn chưa. Chỉ so phần BÀI. */
export function hasGuideDeck(config: RoomConfig): boolean {
  return isPresetDeck(config, GUIDE_TABLE_SIZE);
}

const idle = (state: GuidePrepState): GuidePrepStep => ({ state, emit: null, wakeAt: null });

export function stepGuidePrep(state: GuidePrepState, input: GuidePrepInput): GuidePrepStep {
  if (state.stage === "done" || state.stage === "failed") return idle(state);
  const { snapshot, now } = input;
  if (!snapshot) return idle(state);
  // Ván đã bắt đầu thì việc chuẩn bị đã xong theo nghĩa duy nhất còn quan
  // trọng: không còn gì để gửi, và không được gửi gì khi phòng đã rời sảnh.
  if (snapshot.phase !== "LOBBY") return idle({ stage: "done", pending: null });
  if (!input.isHost || !input.connected) return idle(state);

  const configOk = hasGuideDeck(snapshot.config);
  const count = snapshot.players.length;

  let pending = state.pending;
  if (pending) {
    const confirmed =
      pending.kind === "config" ? configOk : count >= pending.expectCount;
    if (confirmed) {
      pending = null;
    } else if (pending.kind === "config") {
      // `update-config` idempotent: server nhận lại đúng cấu hình đang có thì
      // không đổi gì (sameRoomConfig), nên gửi lại theo hẹn giờ là an toàn.
      if (now - pending.sentAt < GUIDE_PREP_RETRY_MS) {
        // Đang chờ snapshot; chưa tới giờ gửi lại. Cùng đầu vào, không gửi gì.
        return { state: { ...state, pending }, emit: null, wakeAt: pending.sentAt + GUIDE_PREP_RETRY_MS };
      }
      if (pending.attempt >= GUIDE_PREP_MAX_ATTEMPTS) return idle({ stage: "failed", pending: null });
      // Quá giờ mà chưa xác nhận: gửi lại (rơi xuống dưới với `attempt` cộng một).
    } else {
      /*
       * `add-bot` KHÔNG idempotent: hai gói là hai bot, và bàn 9 người với bộ
       * bài 8 là một ván không bắt đầu được. Vì thế không bao giờ gửi lại chỉ
       * vì đồng hồ: chỉ gửi lại khi server đã phát một snapshot MỚI HƠN lần
       * gửi (serverNow lớn hơn) mà sĩ số vẫn chưa tăng - tức gói gần như chắc
       * đã mất chứ không phải đang chậm. Không có snapshot mới nào sau
       * `GUIDE_PREP_STALL_MS` thì dừng ở `failed`: người dùng bấm "+ Thêm bot"
       * bằng tay còn hơn máy đoán mò rồi thừa một bot.
       */
      const newer = snapshot.serverNow > pending.seenServerNow;
      if (!newer) {
        if (now - pending.sentAt >= GUIDE_PREP_STALL_MS) return idle({ stage: "failed", pending: null });
        return { state: { ...state, pending }, emit: null, wakeAt: pending.sentAt + GUIDE_PREP_STALL_MS };
      }
      if (now - pending.sentAt < GUIDE_PREP_RETRY_MS) {
        return { state: { ...state, pending }, emit: null, wakeAt: pending.sentAt + GUIDE_PREP_RETRY_MS };
      }
      if (pending.attempt >= GUIDE_PREP_MAX_ATTEMPTS) return idle({ stage: "failed", pending: null });
    }
  }

  const attempt = pending ? pending.attempt + 1 : 1;

  if (!configOk) {
    const next: GuidePrepPending = {
      kind: "config",
      expectCount: count,
      sentAt: now,
      seenServerNow: snapshot.serverNow,
      attempt,
    };
    return {
      state: { stage: "config", pending: next },
      emit: { event: "room:update-config", payload: { config: GUIDE_DECK } },
      wakeAt: now + GUIDE_PREP_RETRY_MS,
    };
  }

  if (count < GUIDE_TABLE_SIZE) {
    // Chờ snapshot mang sĩ số mới rồi mới xin tiếp: không đếm hộ server.
    const next: GuidePrepPending = {
      kind: "bot",
      expectCount: count + 1,
      sentAt: now,
      seenServerNow: snapshot.serverNow,
      attempt,
    };
    return {
      state: { stage: "bots", pending: next },
      emit: { event: "room:add-bot", payload: {} },
      wakeAt: now + GUIDE_PREP_STALL_MS,
    };
  }

  return idle({ stage: "done", pending: null });
}
