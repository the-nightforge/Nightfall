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
  /** Người dùng đang GIỮ nút nói. Chỉ có ý nghĩa ở chế độ push-to-talk. */
  holding: boolean;
  /**
   * Ý ĐỊNH bật mic của chế độ chạm bật/tắt.
   *
   * Tách hẳn khỏi `holding`, và đó là toàn bộ điểm của trường này. Hai câu hỏi
   * khác nhau bị bản trước gộp làm một:
   *
   *   - "người dùng MUỐN mic bật không" - ý định, chỉ chính họ đổi được;
   *   - "mic CÓ ĐANG phát không" - phụ thuộc kết nối và quyền hiện tại.
   *
   * Gộp lại thì mọi đường thu quyền đều xoá luôn ý định: đêm xuống server thu
   * quyền, sáng hôm sau người chơi phải chạm lại dù chưa hề tắt; chuyển tab
   * hay rớt mạng một nhịp cũng vậy.
   *
   * Giữ ý định KHÔNG nới lỏng bảo mật: `micShouldBeOpen` vẫn đòi LiveKit xác
   * nhận `canPublish`, nên đây chỉ là điều kiện CẦN.
   *
   * Cố ý không dùng cho push-to-talk: ở đó "ý định" chính là ngón tay đang
   * giữ, và người dùng đã nhả tay từ lâu thì không có gì để khôi phục.
   */
  micIntent: boolean;
  /**
   * Người dùng đã CHỦ ĐỘNG vào kênh thoại ít nhất một lần.
   *
   * Điều kiện tiên quyết của mọi lần tự nối lại: người chưa từng bấm tham gia
   * thì không bao giờ bị kéo vào voice sau lưng.
   */
  joinedByUser: boolean;
  /** Đã từng nối được. Dùng để phân biệt "đang kết nối" với "đang kết nối LẠI". */
  everConnected: boolean;
  /** LiveKit đang tự nối lại giữa phiên. Track vẫn còn, chưa phải mất kết nối. */
  reconnecting: boolean;
  /** Mic đã thực sự mở ở tầng SDK. */
  micOpen: boolean;
  /**
   * Lần mở/đóng mic gần nhất hỏng, và chưa được người dùng xử lý.
   *
   * Tồn tại để CHẶN VÒNG LẶP, không phải để hiển thị cho đẹp. `micIntent` được
   * thiết kế để sống sót qua mọi thứ - đêm, rớt mạng, đổi tab - và chính tính
   * chất ấy làm nó thành nhiên liệu hoàn hảo cho một vòng retry: `setMic` hỏng,
   * `micOpen` vẫn false, ý định vẫn true, nên vòng đối chiếu kế tiếp lại gọi
   * `setMic`. Trên máy thật đó là `getUserMedia` bị gọi không ngừng.
   *
   * Chỉ người dùng xoá được nó, bằng một thao tác mới. Chuyển pha thì không:
   * đêm xuống rồi sáng ra không phải là một lần thử lại.
   */
  micError: string | null;
  /** Trình duyệt chặn phát tiếng, cần một cử chỉ nữa (iOS). */
  needsAudioGesture: boolean;
  /**
   * Ai đang nói, theo identity của LiveKit - mà identity CHÍNH LÀ playerId, nên
   * đối chiếu thẳng với danh sách người chơi, không cần bảng ánh xạ.
   */
  speakers: string[];
  /** Bị đá vì cùng danh tính mở ở nơi khác. */
  duplicate: boolean;
  error: string | null;
}

export const initialVoiceState: VoiceState = {
  connection: "idle",
  livekitCanPublish: false,
  snapshotCanPublish: null,
  holding: false,
  micIntent: false,
  micError: null,
  joinedByUser: false,
  everConnected: false,
  reconnecting: false,
  micOpen: false,
  needsAudioGesture: false,
  speakers: [],
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
  | { type: "mic_intent_toggle" }
  | { type: "mic_intent_clear" }
  | { type: "leave_requested" }
  | { type: "voice_disabled" }
  | { type: "removed_from_voice" }
  | { type: "reconnecting" }
  | { type: "reconnected" }
  | { type: "mic_opened" }
  | { type: "mic_closed" }
  | { type: "mic_failed"; error: string; wanted: boolean }
  | { type: "audio_playback_blocked" }
  | { type: "audio_playback_ok" }
  | { type: "speakers_changed"; identities: string[] };

/**
 * Dừng hẳn voice: xoá cả ý định mic lẫn quyền tự nối lại.
 *
 * Dùng chung cho mọi lối ra mà việc tự nối lại sẽ là SAI: người dùng chủ động
 * ngắt, bị đá vì trùng danh tính, host tắt voice. Khác hẳn `disconnected` -
 * mất mạng thì cả hai thứ đó phải được giữ, vì đó chính là thứ khôi phục lại
 * kênh thoại khi app sống dậy.
 */
function stopVoice(state: VoiceState): VoiceState {
  return {
    ...state,
    connection: "idle",
    holding: false,
    micIntent: false,
    micError: null,
    joinedByUser: false,
    livekitCanPublish: false,
    reconnecting: false,
    // Ra khỏi phòng thì không còn gì phát đi được. Mọi lối vào hàm này đều đã
    // rời room, nên đây là sự thật chứ không phải một lời trấn an.
    micOpen: false,
    speakers: [],
  };
}

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case "connect_requested":
      return {
        ...state,
        connection: "connecting",
        error: null,
        duplicate: false,
        reconnecting: false,
        joinedByUser: true,
        // Phiên mới là một lần thử mới: lỗi mic của phiên cũ không còn nghĩa lý.
        micError: null,
      };
    case "connected":
      return {
        ...state,
        connection: "connected",
        error: null,
        everConnected: true,
        reconnecting: false,
      };
    case "disconnected":
      // Nhả nút luôn: giữ `holding` qua một lần mất kết nối sẽ khiến mic tự mở
      // lại ngay khi nối được, dù người dùng đã buông tay từ lâu.
      return {
        ...state,
        connection: "idle",
        holding: false,
        livekitCanPublish: false,
        reconnecting: false,
        // Ra khỏi phòng thì không còn gì phát đi được nữa - đây là sự thật, không
        // phải một lời trấn an.
        micOpen: false,
        // `micIntent` và `joinedByUser` CỐ Ý sống sót: mất mạng hay hệ điều hành
        // treo WebRTC lúc app ra nền không phải là người dùng đổi ý.
        // Không xoá danh sách này thì vòng sáng "đang nói" đứng yên vĩnh viễn
        // quanh ghế người cuối cùng nói trước lúc mất kết nối.
        speakers: [],
      };
    case "duplicate_session":
      // Chính người này vừa mở tab khác. Tự nối lại ở đây là dựng một vòng lặp:
      // hai tab thay nhau đá nhau, mỗi vòng một token mới.
      return { ...stopVoice(state), duplicate: true };
    case "leave_requested":
    case "voice_disabled":
    /**
     * Server đã gỡ người này khỏi kênh thoại: bị đuổi, rời phòng, host tắt
     * voice, phòng biến mất.
     *
     * Cùng hiệu ứng với hai nhánh trên, nhưng là một action RIÊNG chứ không
     * mượn `voice_disabled`. Hai lý do khác nhau thì phải đọc ra được ở
     * transcript của reducer, và `voice_disabled` mang nghĩa "phòng này không
     * còn tính năng voice" - sai với ca bị đuổi, nơi voice vẫn đang bật cho mọi
     * người khác.
     *
     * `duplicate: false` là phần quan trọng: người bị đuổi KHÔNG được nhìn thấy
     * "Đang dùng ở tab khác" rồi đi đóng nhầm một tab vô can.
     */
    case "removed_from_voice":
      return { ...stopVoice(state), duplicate: false };
    case "reconnecting":
      // Track vẫn còn, SDK đang tự nối lại. Không đụng `connection` để khỏi kéo
      // theo một vòng đóng/mở mic cho một sự cố thường chỉ kéo dài vài giây.
      return { ...state, reconnecting: true };
    /**
     * SDK tự vá xong đường truyền, VẪN trong cùng một phiên.
     *
     * Phải là một action riêng chứ không mượn `connect_requested`: đó là lối
     * vào của một lần xin token mới, và nó xoá `micError` cùng đặt lại
     * `connection: "connecting"` - cả hai đều sai ở đây, nơi chẳng có token nào
     * được xin và mic thì chưa hề rời khỏi chỗ của nó.
     *
     * Hạ đúng một cờ, và chỉ một. Không đụng `micIntent`, `micOpen`, `holding`,
     * `joinedByUser` hay hai nguồn quyền publish: LiveKit vừa nối lại chính cái
     * phiên cũ, nên mọi thứ ấy vẫn đang đúng. Thiếu nhánh này thì `reconnecting`
     * không có đường nào về false, và dock đứng mãi ở "Đang kết nối lại" trong
     * khi voice đã chạy lại từ lâu.
     *
     * `error` thì xoá được: nó là lỗi KẾT NỐI, mà kết nối vừa tự chứng minh là
     * lành. `micError` cố ý giữ - nó thuộc về thiết bị của người dùng, và chỉ
     * họ mới xoá được bằng một thao tác mới.
     */
    case "reconnected":
      return {
        ...state,
        connection: "connected",
        everConnected: true,
        reconnecting: false,
        error: null,
      };
    case "failed":
      return {
        ...state,
        connection: "failed",
        holding: false,
        reconnecting: false,
        error: action.error,
      };
    /**
     * Mất quyền nói thì hạ cờ GIỮ NÚT, và chỉ cờ đó.
     *
     * Với push-to-talk đây là thứ đúng đắn duy nhất: người chơi đã nhả tay từ
     * lâu, sáng hôm sau mic tự mở là phát sóng ngoài ý muốn.
     *
     * `micIntent` thì ngược lại, phải sống sót. Bản trước xoá luôn nó - đó
     * chính là lý do người bật mic ở chế độ chạm bật/tắt phải chạm lại sau mỗi
     * đêm. An toàn không mất đi: `micShouldBeOpen` vẫn đòi LiveKit cấp quyền
     * thật, nên ý định một mình không mở được gì.
     */
    case "livekit_permission":
      return {
        ...state,
        livekitCanPublish: action.canPublish,
        holding: action.canPublish ? state.holding : false,
      };
    case "snapshot_can_publish":
      return {
        ...state,
        snapshotCanPublish: action.canPublish,
        holding: action.canPublish ? state.holding : false,
      };
    case "hold_start":
      // Bấm nút là một lần thử mới, tự nó xoá lỗi của lần trước.
      return { ...state, holding: true, micError: null };
    case "hold_end":
      return { ...state, holding: false };
    case "mic_intent_toggle":
      // Chạm nút mic là thao tác "thử lại" - không cần một nút riêng cho việc đó.
      return { ...state, micIntent: !state.micIntent, micError: null };
    case "mic_intent_clear":
      return { ...state, micIntent: false, micError: null };
    case "mic_opened":
      return { ...state, micOpen: true, micError: null };
    case "mic_closed":
      return { ...state, micOpen: false, micError: null };
    /**
     * `setMic` ném lỗi. Hai hướng, hai mức nghiêm trọng khác hẳn nhau.
     *
     * MỞ hỏng thì hậu quả là im lặng: khó chịu, không hại ai. Hạ ý định xuống
     * là đủ - vừa cắt vòng retry, vừa biến chính nút mic thành nút thử lại.
     *
     * ĐÓNG hỏng thì mic có thể VẪN ĐANG PHÁT. Tuyệt đối không được ghi
     * `micOpen: false` cho đỡ khó xử - đó là đúng kiểu nói dối mà cả tính năng
     * này sinh ra để tránh. Ngoại lệ duy nhất là khi quyền publish đã bị thu:
     * lúc đó chính LiveKit/server đã gỡ track, im lặng là chắc chắn chứ không
     * phải phỏng đoán.
     */
    case "mic_failed": {
      const stillLive = state.livekitCanPublish && state.snapshotCanPublish !== false;
      return {
        ...state,
        micError: action.error,
        holding: false,
        micIntent: false,
        micOpen: action.wanted ? false : stillLive,
      };
    }
    case "audio_playback_blocked":
      return { ...state, needsAudioGesture: true };
    case "audio_playback_ok":
      return { ...state, needsAudioGesture: false };
    case "speakers_changed":
      return { ...state, speakers: action.identities };
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
    (state.holding || state.micIntent) &&
    state.connection === "connected" &&
    state.livekitCanPublish &&
    state.snapshotCanPublish !== false
  );
}

export type VoiceUiMode =
  | "join"
  | "connecting"
  | "talk"
  | "listen"
  | "unblock-audio"
  | "duplicate"
  | "error";

export interface VoiceUi {
  visible: boolean;
  mode: VoiceUiMode;
  /**
   * Đang cố nối LẠI, không phải nối lần đầu.
   *
   * Là một cờ riêng chứ không phải một `mode`, vì nó chồng lên hai tình huống
   * khác hẳn nhau: đang xin token mới sau khi rớt (`mode: "connecting"`), và
   * LiveKit tự vá đường truyền trong lúc người chơi vẫn đang nói
   * (`mode: "talk"`). Nhập chúng thành một mode sẽ khiến dock nuốt mất nút mic
   * đúng lúc người ta đang giữ nó.
   */
  reconnecting: boolean;
}

/** Suy ra thứ cần vẽ từ trạng thái client cộng snapshot của server. */
export function voiceUi(state: VoiceState, view: VoiceView | undefined): VoiceUi {
  // Server cũ chưa gửi trường này - không vỡ, chỉ là chưa có voice.
  if (!view?.enabled) return { visible: false, mode: "join", reconnecting: false };

  if (state.duplicate) return { visible: true, mode: "duplicate", reconnecting: false };
  // Bị chặn phát tiếng thì mọi thứ khác vô nghĩa: người chơi đang không nghe
  // thấy gì cả, nên lời mời bấm phải được ưu tiên.
  if (state.needsAudioGesture) return { visible: true, mode: "unblock-audio", reconnecting: false };
  if (state.connection === "failed") return { visible: true, mode: "error", reconnecting: false };
  if (state.connection === "connecting") {
    // Đã từng nối được thì đây là một lần NỐI LẠI - nói đúng tên nó, để người
    // chơi không đi tìm nút "Bật mic" mà họ đã bấm từ đầu ván.
    return { visible: true, mode: "connecting", reconnecting: state.everConnected };
  }
  if (state.connection !== "connected") return { visible: true, mode: "join", reconnecting: false };

  return {
    visible: true,
    mode: view.canPublish ? "talk" : "listen",
    reconnecting: state.reconnecting,
  };
}
