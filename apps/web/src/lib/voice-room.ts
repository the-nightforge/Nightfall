"use client";

import { Room, RoomEvent, type RemoteTrack } from "livekit-client";
import { classifyDisconnect, type VoiceDisconnectKind } from "./voice-disconnect";

/**
 * Lớp bọc mỏng quanh client LiveKit.
 *
 * Nơi duy nhất phía web chạm vào PHẦN CHẠY của SDK - `Room`, `RoomEvent`, các
 * lời gọi. Toàn bộ quyết định nằm ở `voice-state.ts` (thuần, test được bằng
 * node:test); file này chỉ dịch sự kiện của SDK thành lời gọi lại, và dịch lệnh
 * thành lời gọi SDK.
 *
 * Việc dịch `DisconnectReason` nằm ở `voice-disconnect.ts` chứ không ở đây, dù
 * nó cũng là một lớp dịch: tầng hook cần test được với chính enum THẬT của SDK,
 * mà file này thì luôn bị thay bằng bản giả trong test hook. Bản trước gộp nó
 * vào đây dưới dạng một boolean, và đó đúng là chỗ lỗi lọt qua.
 */

export interface VoiceRoomHandlers {
  onConnected(): void;
  /**
   * @param kind ngắt CÓ CHỦ ĐÍCH hay chỉ là sự cố - xem `voice-disconnect.ts`
   *
   * Không còn là boolean "có phải duplicate không". Câu hỏi ấy quá hẹp: nó gộp
   * "bị đuổi khỏi phòng" và "host tắt voice" vào chung rổ với "rớt mạng", nên
   * client tự xin token vào lại đúng cái phòng vừa tống mình ra.
   */
  onDisconnected(kind: VoiceDisconnectKind): void;
  /** Quyền nói do CHÍNH LiveKit báo - nguồn duy nhất được phép mở mic. */
  onPermission(canPublish: boolean): void;
  onAudioPlayback(canPlay: boolean): void;
  /**
   * LiveKit vừa tự nối lại sau khi mất kết nối.
   *
   * Nếu là reconnect ĐẦY ĐỦ thì participant vào lại bằng chính token cũ, mà
   * token không bao giờ mang quyền nói. Server không biết chuyện đó xảy ra, nên
   * phải tự giới thiệu lại - không thì kẹt câm.
   */
  onReconnected(): void;
  /**
   * LiveKit vừa MẤT đường truyền và đang tự vá.
   *
   * Khác `onDisconnected`: track chưa bị gỡ, phiên chưa chết. Chỉ để giao diện
   * nói thật - im lặng ở đây nghĩa là dock vẫn khoe "Đã kết nối" trong lúc
   * không ai nghe được gì.
   */
  onReconnecting(): void;
  /** Danh sách identity đang nói; LiveKit tự lọc theo ngưỡng âm lượng. */
  onSpeakers(identities: string[]): void;
  onFailed(message: string): void;
}

export interface VoiceRoomHandle {
  connect(url: string, token: string): Promise<void>;
  setMic(on: boolean): Promise<void>;
  /** Phải gọi TRONG handler của cử chỉ người dùng, nếu không iOS chặn. */
  startAudio(): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * Phần tử media mà track được gắn vào. Kiểu tối thiểu, không phải HTMLMediaElement,
 * để test dựng được bản giả mà không cần DOM.
 */
export interface VoiceAudioElement {
  autoplay: boolean;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

/** Nơi chứa các phần tử <audio> của người khác. */
export interface VoiceAudioSink {
  add(element: VoiceAudioElement): void;
  clear(): void;
}

/** Phần API của track mà việc gắn/gỡ cần tới. */
export interface VoiceAudioTrack {
  kind: string;
  attach(): VoiceAudioElement;
  detach(): VoiceAudioElement[];
}

/**
 * Gắn track âm thanh của người khác vào một phần tử để nó phát ra tiếng.
 *
 * LiveKit KHÔNG tự làm việc này: nó nhận track về rồi thôi. Thiếu bước gắn thì
 * mọi thứ khác đều đúng - quyền, track, chỉ báo đang nói - mà không ai nghe được
 * ai. Đó đúng là lỗi đã lên tới production ngày 2026-08-30.
 *
 * Tách ra khỏi phần đăng ký sự kiện, và nhận `sink` qua tham số, để kiểm chứng
 * được bằng node:test - tầng này trước đó không có test nào.
 *
 * @returns có gắn hay không (track không phải audio thì bỏ qua)
 */
export function attachRemoteAudio(track: VoiceAudioTrack, sink: VoiceAudioSink): boolean {
  if (track.kind !== "audio") return false;
  const element = track.attach();
  element.autoplay = true;
  // Đặt bằng attribute vì `playsInline` chỉ có trong kiểu của thẻ video. Với
  // audio thì nó thừa, nhưng Safari đỡ khó tính hơn khi có nó.
  element.setAttribute("playsinline", "");
  sink.add(element);
  return true;
}

/** @returns số phần tử đã gỡ bỏ */
export function detachRemoteAudio(track: VoiceAudioTrack): number {
  if (track.kind !== "audio") return 0;
  const elements = track.detach();
  for (const element of elements) element.remove();
  return elements.length;
}

/** Nơi chứa mặc định: một thẻ div ẩn cắm vào cuối body. */
function domSink(): VoiceAudioSink {
  const id = "voice-audio-sink";
  const container = (): HTMLElement => {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      el.style.display = "none";
      document.body.appendChild(el);
    }
    return el;
  };
  return {
    add: (element) => container().appendChild(element as unknown as Node),
    clear: () => container().replaceChildren(),
  };
}

export function createVoiceRoom(
  handlers: VoiceRoomHandlers,
  sink: VoiceAudioSink = domSink(),
): VoiceRoomHandle {
  let room: Room | null = null;

  function reportPermission(): void {
    handlers.onPermission(room?.localParticipant?.permissions?.canPublish === true);
  }

  return {
    async connect(url, token) {
      await this.disconnect();
      const next = new Room({ audioCaptureDefaults: { echoCancellation: true } });
      room = next;

      // Chỉ bắn trên LocalParticipant - đúng thứ mình cần.
      next.on(RoomEvent.ParticipantPermissionsChanged, reportPermission);
      next.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        handlers.onAudioPlayback(next.canPlaybackAudio);
      });
      next.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        handlers.onSpeakers(speakers.map((p) => p.identity));
      });
      next.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        attachRemoteAudio(track, sink);
      });
      next.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        detachRemoteAudio(track);
      });
      next.on(RoomEvent.Reconnecting, () => {
        handlers.onReconnecting();
      });
      next.on(RoomEvent.Reconnected, () => {
        handlers.onReconnected();
        // Đọc lại quyền thật: phiên mới có thể đã tụt về quyền của token.
        reportPermission();
      });
      next.on(RoomEvent.Disconnected, (reason) => {
        // Lý do đi trọn vẹn tới hook. Ba nhóm đầu là quyết định của server -
        // vào lại là đi ngược lại quyết định đó; nhóm cuối mới là sự cố.
        handlers.onDisconnected(classifyDisconnect(reason));
      });

      try {
        await next.connect(url, token);
        handlers.onConnected();
        // Đọc quyền THỰC TẾ ngay sau khi vào: sự kiện đổi quyền chỉ bắn khi có
        // thay đổi, nên chỉ ngồi đợi nó là bỏ lỡ trạng thái ban đầu.
        reportPermission();
        handlers.onAudioPlayback(next.canPlaybackAudio);
      } catch (err) {
        room = null;
        handlers.onFailed(err instanceof Error ? err.message : "Không vào được kênh thoại");
      }
    },

    async setMic(on) {
      if (!room) return;
      await room.localParticipant.setMicrophoneEnabled(on);
    },

    async startAudio() {
      await room?.startAudio();
    },

    async disconnect() {
      const current = room;
      room = null;
      if (!current) return;
      current.removeAllListeners();
      await current.disconnect();
      // Dọn phần tử audio còn sót, nếu không mỗi lần vào lại sẽ chồng thêm một lớp.
      sink.clear();
    },
  };
}
