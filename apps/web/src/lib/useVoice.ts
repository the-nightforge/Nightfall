"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { CLIENT_EVENTS, SERVER_EVENTS, type VoiceTokenPayload, type VoiceView } from "@masoi/shared";
import type { Socket } from "socket.io-client";
import { audioEngine } from "./audio-engine";
import { createVoiceRoom, type VoiceRoomHandle } from "./voice-room";
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
  micOpen: boolean;
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

  if (!roomRef.current) {
    roomRef.current = createVoiceRoom({
      onConnected: () => dispatch({ type: "connected" }),
      onDisconnected: (duplicate) =>
        dispatch(duplicate ? { type: "duplicate_session" } : { type: "disconnected" }),
      onPermission: (canPublish) => dispatch({ type: "livekit_permission", canPublish }),
      onAudioPlayback: (canPlay) =>
        dispatch(canPlay ? { type: "audio_playback_ok" } : { type: "audio_playback_blocked" }),
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

  // Đồng bộ mic thật với thứ máy trạng thái nói là NÊN mở.
  useEffect(() => {
    const want = micShouldBeOpen(state);
    if (want === state.micOpen) return;
    let cancelled = false;
    void roomRef.current?.setMic(want).then(() => {
      // Người dùng có thể đã nhả nút trong lúc promise chạy; dispatch xong thì
      // vòng effect kế tiếp sẽ tự đóng lại.
      if (!cancelled) dispatch({ type: want ? "mic_opened" : "mic_closed" });
    });
    return () => {
      cancelled = true;
    };
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
    micOpen: state.micOpen,
  };
}
