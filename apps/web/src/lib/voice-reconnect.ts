import type { VoiceConnection } from "./voice-state";

/**
 * Cổng chặn cho việc TỰ nối lại kênh thoại.
 *
 * Thuần, không React, không trình duyệt - vì phần khó của việc nối lại không
 * nằm ở chỗ nghe sự kiện nào, mà ở chỗ KHÔNG nối lại quá nhiều lần.
 *
 * Quay lại một tab đã ngủ thường bắn `visibilitychange`, `pageshow` và `online`
 * trong vài mili giây, rồi socket nối lại ngay sau đó. Bốn tín hiệu cho cùng
 * một sự kiện đời thực. Mỗi tín hiệu tự xin một token nghĩa là server ký bốn
 * token và LiveKit nhận bốn lần join cùng một danh tính - mà trùng danh tính
 * thì chính LiveKit đá phiên cũ, nên bốn lần join là ba lần tự đá mình.
 */

export interface ReconnectInput {
  connection: VoiceConnection;
  /** Người dùng đã chủ động vào voice ít nhất một lần. */
  joinedByUser: boolean;
  /** Đang bị đá vì mở tab khác. */
  duplicate: boolean;
  /**
   * Ba điều kiện của MÔI TRƯỜNG, tách khỏi ba điều kiện của trạng thái voice ở trên.
   *
   * Chúng nằm ở đây chứ không nằm rải tại từng listener vì có tới NĂM đường gọi
   * tới cổng: bốn tín hiệu thức dậy, cộng với chính lúc LiveKit báo mất kết nối
   * hẳn. Đường thứ năm không đi kèm một sự kiện trình duyệt nào để suy ra "app
   * đang hiện và có mạng" - nếu điều kiện ấy không nằm ở đây thì nó sẽ không
   * được kiểm ở đâu cả.
   */
  visible: boolean;
  online: boolean;
  /** Có socket để gửi yêu cầu xin token. */
  canRequest: boolean;
}

/**
 * Thời gian nghỉ giữa hai lần xin token.
 *
 * Chỉ có tác dụng ở đường LỖI: nối được thì `connection` đã tự chặn, còn nối
 * hỏng thì không có gì chặn ngoài con số này. Ba giây đủ ngắn để người vừa
 * chuyển mạng không phải chờ, và đủ dài để một mạng chập chờn không biến thành
 * một vòng phát token.
 */
export const RECONNECT_COOLDOWN_MS = 3_000;

/**
 * Chờ tối đa bao lâu cho một lượt xin token trước khi coi là hỏng.
 *
 * Server từ chối `voice:token` bằng sự kiện lỗi CHUNG của socket - cùng đường
 * với "phòng đã đầy" hay "thao tác quá nhanh" - nên hook không có cách nào biết
 * lỗi vừa rồi có phải của mình không. Thiếu mốc này thì một lần bị từ chối
 * (vừa bị đuổi khỏi phòng, chạm rate limit) để dock đứng mãi ở "Đang kết nối":
 * không lỗi, không nút nào để bấm, và cổng nối lại thì khoá luôn vì
 * `connection` không bao giờ rời khỏi `connecting`.
 *
 * Cũng phủ luôn ca token về nhưng `room.connect()` treo - LiveKit không hứa một
 * mốc thời gian nào cho việc đó.
 */
export const CONNECT_TIMEOUT_MS = 12_000;

export interface ReconnectGate {
  /** @returns có nên xin token mới ngay bây giờ không */
  request(input: ReconnectInput, now: number): boolean;
  /** Lượt xin token vừa rồi đã ngã ngũ (nối được, hỏng, hoặc lại rớt). */
  settle(): void;
}

export function createReconnectGate(cooldownMs: number = RECONNECT_COOLDOWN_MS): ReconnectGate {
  let pending = false;
  let lastAt: number | null = null;

  return {
    request(input, now) {
      // Chưa từng bấm tham gia thì không bao giờ bị kéo vào voice sau lưng.
      if (!input.joinedByUser) return false;
      // Duplicate phải do người dùng chọn tab, không phải do bộ đếm thời gian.
      if (input.duplicate) return false;
      if (input.connection === "connected" || input.connection === "connecting") return false;
      // Nối lại lúc app còn nằm nền hoặc còn mất mạng gần như chắc chắn hỏng,
      // và mỗi lần hỏng là một token bị đốt. Chờ tín hiệu kế tiếp - `online` và
      // `visibilitychange` chính là chúng.
      if (!input.visible || !input.online || !input.canRequest) return false;
      // Một lượt đang bay: `connection` chưa kịp đổi vì React gộp cập nhật, nên
      // cờ này mới là thứ chặn được ba tín hiệu còn lại của cùng một lần thức dậy.
      if (pending) return false;
      if (lastAt !== null && now - lastAt < cooldownMs) return false;

      pending = true;
      lastAt = now;
      return true;
    },

    settle() {
      pending = false;
    },
  };
}
