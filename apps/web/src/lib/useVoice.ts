"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CLIENT_EVENTS, SERVER_EVENTS, type VoiceTokenPayload, type VoiceView } from "@masoi/shared";
import type { Socket } from "socket.io-client";
import { audioEngine } from "./audio-engine";
import { createVoiceRoom, type VoiceRoomHandle } from "./voice-room";
import { createMicSync, type MicSync } from "./voice-mic-sync";
import {
  DEFAULT_VOICE_SETTINGS,
  loadVoiceSettings,
  saveVoiceSettings,
  type MicMode,
} from "./voice-settings";
import {
  initialVoiceState,
  micShouldBeOpen,
  voiceReducer,
  voiceUi,
  type VoiceUi,
} from "./voice-state";

export interface UseVoice {
  ui: VoiceUi;
  /** Bấm để vào kênh thoại, hoặc để mở khoá phát tiếng khi bị chặn. */
  activate(): void;
  holdStart(): void;
  holdEnd(): void;
  /** Chế độ chạm bật/tắt: lật trạng thái nói. */
  toggleHold(): void;
  micMode: MicMode;
  setMicMode(mode: MicMode): void;
  micOpen: boolean;
  /** Set chứ không phải mảng: mỗi ghế tra cứu một lần, danh sách đổi liên tục. */
  speakers: ReadonlySet<string>;
}

/**
 * Nối máy trạng thái thuần với SDK và socket.
 *
 * Hook cố ý mỏng: mọi quyết định "mic có nên mở không" nằm ở `micShouldBeOpen`,
 * nên nó kiểm chứng được mà không cần trình duyệt.
 */
export function useVoice(socket: Socket | null, view: VoiceView | undefined): UseVoice {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);
  const roomRef = useRef<VoiceRoomHandle | null>(null);
  // Đọc trạng thái mới nhất từ trong callback của socket mà không phải gắn lại
  // listener mỗi lần state đổi.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Room được dựng một lần ở lần render đầu, lúc đó socket còn null - nên phải
  // đọc qua ref chứ không bắt được vào closure.
  const socketRef = useRef<Socket | null>(socket);
  socketRef.current = socket;
  // Khởi tạo bằng mặc định chứ không đọc localStorage ngay: server render không
  // có localStorage, đọc ở đây sẽ lệch giữa server và client. Cùng nếp
  // SoundControl.
  const [micMode, setMicModeState] = useState<MicMode>(DEFAULT_VOICE_SETTINGS.micMode);
  useEffect(() => {
    setMicModeState(loadVoiceSettings().micMode);
  }, []);

  const micSyncRef = useRef<MicSync | null>(null);
  if (!micSyncRef.current) {
    micSyncRef.current = createMicSync({
      setMic: async (on) => {
        await roomRef.current?.setMic(on);
      },
      onResult: (open) => dispatch({ type: open ? "mic_opened" : "mic_closed" }),
      onError: (error) => {
        console.error("[voice] không mở/đóng được mic:", error);
        dispatch({ type: "mic_closed" });
        dispatch({ type: "hold_end" });
      },
    });
  }

  if (!roomRef.current) {
    roomRef.current = createVoiceRoom({
      onConnected: () => dispatch({ type: "connected" }),
      onDisconnected: (duplicate) =>
        dispatch(duplicate ? { type: "duplicate_session" } : { type: "disconnected" }),
      onPermission: (canPublish) => dispatch({ type: "livekit_permission", canPublish }),
      onAudioPlayback: (canPlay) =>
        dispatch(canPlay ? { type: "audio_playback_ok" } : { type: "audio_playback_blocked" }),
      onSpeakers: (identities) => dispatch({ type: "speakers_changed", identities }),
      onReconnected: () => socketRef.current?.emit(CLIENT_EVENTS.VOICE_READY, {}),
      onFailed: (error) => dispatch({ type: "failed", error }),
    });
  }

  // Snapshot chỉ được dùng MỘT CHIỀU (đóng mic). Việc mở luôn đợi LiveKit.
  useEffect(() => {
    if (view) dispatch({ type: "snapshot_can_publish", canPublish: view.canPublish });
  }, [view?.canPublish, view]);

  // Nhận token rồi vào phòng, và báo lại để server cấp quyền theo pha hiện tại.
  useEffect(() => {
    if (!socket) return;
    const onToken = async (payload: VoiceTokenPayload) => {
      await roomRef.current?.connect(payload.url, payload.token);
      socket.emit(CLIENT_EVENTS.VOICE_READY, {});
    };
    socket.on(SERVER_EVENTS.VOICE_TOKEN, onToken);
    return () => {
      socket.off(SERVER_EVENTS.VOICE_TOKEN, onToken);
    };
  }, [socket]);

  /**
   * Socket nối lại thì tự giới thiệu lại với server.
   *
   * Server giữ tập "ai đã vào voice" trong RAM. Nó khởi động lại là mất sạch,
   * trong khi room LiveKit vẫn sống và người chơi vẫn đang ngồi trong đó - server
   * mới không biết họ tồn tại nên không bao giờ cấp lại quyền, và họ KẸT ở quyền
   * của trước lúc restart. Hướng kẹt là kẹt câm nên không thành lỗ hổng, nhưng
   * người chơi thì mất tiếng vĩnh viễn mà giao diện vẫn mời họ bấm giữ để nói.
   *
   * Quan sát được trong lần chạy thật ngày 2026-08-30, không phải suy đoán.
   */
  useEffect(() => {
    if (!socket) return;
    const onConnect = () => {
      if (stateRef.current.connection === "connected") {
        socket.emit(CLIENT_EVENTS.VOICE_READY, {});
      }
    };
    socket.on("connect", onConnect);
    return () => {
      socket.off("connect", onConnect);
    };
  }, [socket]);

  /**
   * Đồng bộ mic thật với thứ máy trạng thái nói là NÊN mở.
   *
   * Toàn bộ phần khó nằm trong `createMicSync` - thuần, không React, và có test
   * khoá hai bất biến mà tầng này từng vi phạm trên production. Effect ở đây chỉ
   * còn là một lời gọi.
   */
  useEffect(() => {
    micSyncRef.current?.reconcile(micShouldBeOpen(state), state.micOpen);
  }, [state]);

  // Mọi đường nhả nút ngoài pointerup: rời tab, mất focus. Thiếu chúng thì mic
  // kẹt mở và người chơi phát sóng mà không biết.
  useEffect(() => {
    if (!state.holding) return;
    const release = () => dispatch({ type: "hold_end", reason: "blur" });
    const onVisibility = () => {
      if (document.hidden) dispatch({ type: "hold_end", reason: "hidden" });
    };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [state.holding]);

  useEffect(() => {
    const handle = roomRef.current;
    return () => {
      void handle?.disconnect();
    };
  }, []);

  const activate = useCallback(() => {
    // Cùng một cử chỉ mở khoá cả hai đường âm thanh. Game đã có cơ chế mở khoá
    // riêng cho nhạc nền; dựng đường thứ hai song song sẽ khiến iOS chỉ mở một
    // nửa và rất khó lần ra.
    audioEngine.unlock();
    void roomRef.current?.startAudio();
    if (state.connection === "idle" || state.connection === "failed") {
      socket?.emit(CLIENT_EVENTS.VOICE_TOKEN, {});
      dispatch({ type: "connect_requested" });
    }
  }, [socket, state.connection]);

  return {
    ui: useMemo(() => voiceUi(state, view), [state, view]),
    activate,
    holdStart: useCallback(() => dispatch({ type: "hold_start" }), []),
    holdEnd: useCallback(() => dispatch({ type: "hold_end", reason: "pointerup" }), []),
    toggleHold: useCallback(() => dispatch({ type: "hold_toggle" }), []),
    micMode,
    setMicMode: useCallback((mode: MicMode) => {
      setMicModeState(mode);
      saveVoiceSettings({ micMode: mode });
      // Đổi chế độ giữa lúc đang nói thì đóng mic lại: người dùng vừa đổi cách
      // thao tác, giữ nguyên trạng thái nói sẽ khiến họ không biết mình còn
      // đang phát hay không.
      dispatch({ type: "hold_end" });
    }, []),
    micOpen: state.micOpen,
    speakers: useMemo(() => new Set(state.speakers), [state.speakers]),
  };
}
