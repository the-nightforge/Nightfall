"use client";

import { DisconnectReason, Room, RoomEvent } from "livekit-client";

/**
 * Lớp bọc mỏng quanh client LiveKit.
 *
 * Là nơi DUY NHẤT phía web import SDK. Toàn bộ quyết định nằm ở `voice-state.ts`
 * (thuần, test được bằng node:test); file này chỉ dịch sự kiện của SDK thành
 * lời gọi lại, và dịch lệnh thành lời gọi SDK.
 */

export interface VoiceRoomHandlers {
  onConnected(): void;
  onDisconnected(duplicate: boolean): void;
  /** Quyền nói do CHÍNH LiveKit báo - nguồn duy nhất được phép mở mic. */
  onPermission(canPublish: boolean): void;
  onAudioPlayback(canPlay: boolean): void;
  onFailed(message: string): void;
}

export interface VoiceRoomHandle {
  connect(url: string, token: string): Promise<void>;
  setMic(on: boolean): Promise<void>;
  /** Phải gọi TRONG handler của cử chỉ người dùng, nếu không iOS chặn. */
  startAudio(): Promise<void>;
  disconnect(): Promise<void>;
}

export function createVoiceRoom(handlers: VoiceRoomHandlers): VoiceRoomHandle {
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
      next.on(RoomEvent.Disconnected, (reason) => {
        // Trùng danh tính nghĩa là chính người này vừa mở ở tab khác. Phải phân
        // biệt để UI khỏi báo "mất mạng" - người chơi sẽ đi sửa nhầm thứ.
        handlers.onDisconnected(reason === DisconnectReason.DUPLICATE_IDENTITY);
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
    },
  };
}
