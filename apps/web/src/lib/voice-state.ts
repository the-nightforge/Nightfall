import type { VoiceView } from "@masoi/shared";

/**
 * Máy trạng thái thuần cho voice chat phía client.
 *
 * Tách hẳn khỏi SDK LiveKit và khỏi React: web ở repo này không có test
 * component, nên logic nào không tách ra được là logic không kiểm chứng được.
 * Hook chỉ việc bơm sự kiện vào đây rồi làm theo `micShouldBeOpen`.
 */

export type VoiceConnection = "idle" | "connecting" | "connected" | "failed";

export interface VoiceState {
  connection: VoiceConnection;
  /**
   * Quyền nói do CHÍNH LiveKit báo về.
   *
   * Không bao giờ được suy ra từ snapshot: token join không mang quyền nói, nên
   * tin snapshot để mở mic là mở vào lúc LiveKit còn đang từ chối.
   */
  livekitCanPublish: boolean;
  /**
   * Quyền nói theo snapshot của server. Ba trạng thái, không phải hai:
   * `null` là chưa có snapshot nào.
   *
   * Chỉ dùng MỘT CHIỀU: `false` thì đóng mic ngay (lớp nhanh). `true` không đủ
   * để mở, và `null` không được phép chặn - mặc định `false` sẽ khoá mic của
   * người chơi cho tới khi snapshot đầu tiên về.
   */
  snapshotCanPublish: boolean | null;
  /** Người dùng đang giữ nút nói. */
  holding: boolean;
  /** Mic đã thực sự mở ở tầng SDK. */
  micOpen: boolean;
  /** Trình duyệt chặn phát tiếng, cần một cử chỉ nữa (iOS). */
  needsAudioGesture: boolean;
  /** Bị đá vì cùng danh tính mở ở nơi khác. */
  duplicate: boolean;
  error: string | null;
}

export const initialVoiceState: VoiceState = {
  connection: "idle",
  livekitCanPublish: false,
  snapshotCanPublish: null,
  holding: false,
  micOpen: false,
  needsAudioGesture: false,
  duplicate: false,
  error: null,
};

export type VoiceAction =
  | { type: "connect_requested" }
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "duplicate_session" }
  | { type: "failed"; error: string }
  | { type: "livekit_permission"; canPublish: boolean }
  | { type: "snapshot_can_publish"; canPublish: boolean }
  | { type: "hold_start" }
  | { type: "hold_end"; reason?: "pointerup" | "pointercancel" | "blur" | "hidden" }
  | { type: "mic_opened" }
  | { type: "mic_closed" }
  | { type: "audio_playback_blocked" }
  | { type: "audio_playback_ok" };

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case "connect_requested":
      return { ...state, connection: "connecting", error: null, duplicate: false };
    case "connected":
      return { ...state, connection: "connected", error: null };
    case "disconnected":
      // Nhả nút luôn: giữ `holding` qua một lần mất kết nối sẽ khiến mic tự mở
      // lại ngay khi nối được, dù người dùng đã buông tay từ lâu.
      return { ...state, connection: "idle", holding: false, livekitCanPublish: false };
    case "duplicate_session":
      return { ...state, connection: "idle", holding: false, duplicate: true };
    case "failed":
      return { ...state, connection: "failed", holding: false, error: action.error };
    case "livekit_permission":
      return { ...state, livekitCanPublish: action.canPublish };
    case "snapshot_can_publish":
      return { ...state, snapshotCanPublish: action.canPublish };
    case "hold_start":
      return { ...state, holding: true };
    case "hold_end":
      return { ...state, holding: false };
    case "mic_opened":
      return { ...state, micOpen: true };
    case "mic_closed":
      return { ...state, micOpen: false };
    case "audio_playback_blocked":
      return { ...state, needsAudioGesture: true };
    case "audio_playback_ok":
      return { ...state, needsAudioGesture: false };
    default:
      return state;
  }
}

/**
 * Mic CÓ NÊN đang mở hay không, tính lại sau mỗi hành động.
 *
 * Hook so giá trị này với `state.micOpen` rồi mới gọi SDK. Nhờ tách "nên mở"
 * khỏi "đang mở", ca kinh điển nhất được xử lý đúng: người dùng nhả nút trước
 * khi promise mở mic kịp về, `mic_opened` vẫn tới, nhưng `micShouldBeOpen` đã
 * là false nên hook đóng lại ngay thay vì để mic kẹt mở.
 */
export function micShouldBeOpen(state: VoiceState): boolean {
  return (
    state.holding &&
    state.connection === "connected" &&
    state.livekitCanPublish &&
    state.snapshotCanPublish !== false
  );
}

export type VoiceUiMode = "join" | "talk" | "listen" | "unblock-audio" | "duplicate" | "error";

export interface VoiceUi {
  visible: boolean;
  mode: VoiceUiMode;
}

/** Suy ra thứ cần vẽ từ trạng thái client cộng snapshot của server. */
export function voiceUi(state: VoiceState, view: VoiceView | undefined): VoiceUi {
  // Server cũ chưa gửi trường này - không vỡ, chỉ là chưa có voice.
  if (!view?.enabled) return { visible: false, mode: "join" };

  if (state.duplicate) return { visible: true, mode: "duplicate" };
  // Bị chặn phát tiếng thì mọi thứ khác vô nghĩa: người chơi đang không nghe
  // thấy gì cả, nên lời mời bấm phải được ưu tiên.
  if (state.needsAudioGesture) return { visible: true, mode: "unblock-audio" };
  if (state.connection === "failed") return { visible: true, mode: "error" };
  if (state.connection !== "connected") return { visible: true, mode: "join" };

  return { visible: true, mode: view.canPublish ? "talk" : "listen" };
}
