"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CLIENT_EVENTS, SERVER_EVENTS, type VoiceTokenPayload, type VoiceView } from "@masoi/shared";
import type { Socket } from "socket.io-client";
import { audioEngine } from "./audio-engine";
import { createVoiceRoom, type VoiceRoomHandle } from "./voice-room";
import { isTerminalDisconnect } from "./voice-disconnect";
import {
  CONNECT_TIMEOUT_MS,
  createReconnectGate,
  type ReconnectGate,
  type ReconnectInput,
} from "./voice-reconnect";
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
  /** Chủ động rời kênh thoại. Xoá luôn quyền tự nối lại. */
  leave(): void;
  holdStart(): void;
  holdEnd(): void;
  /** Chế độ chạm bật/tắt: lật Ý ĐỊNH bật mic, không phải lật mic thật. */
  toggleMic(): void;
  micMode: MicMode;
  setMicMode(mode: MicMode): void;
  micOpen: boolean;
  /** Người dùng MUỐN mic bật (chế độ chạm bật/tắt). Khác `micOpen` lúc bị thu quyền. */
  micIntent: boolean;
  /**
   * Lần mở/đóng mic gần nhất hỏng và chưa được xử lý.
   *
   * Có giá trị nghĩa là mic đang KHÔNG được tự thử lại - bấm nút mic là thao
   * tác thử lại, và cũng là thao tác xoá nó.
   */
  micError: string | null;
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

  const gateRef = useRef<ReconnectGate | null>(null);
  if (!gateRef.current) gateRef.current = createReconnectGate();

  /**
   * Đường vào cổng nối lại, đọc muộn.
   *
   * Khối dựng room bên dưới chạy ở lần render ĐẦU, trước khi `attempt` kịp tồn
   * tại, và handler nó nhận thì sống suốt đời hook. Đọc qua ref là cách duy
   * nhất để callback của SDK gọi được bản mới nhất mà không phải dựng lại room.
   */
  const attemptRef = useRef<(override?: Partial<ReconnectInput>) => void>(() => undefined);

  const micSyncRef = useRef<MicSync | null>(null);
  if (!micSyncRef.current) {
    micSyncRef.current = createMicSync({
      setMic: async (on) => {
        await roomRef.current?.setMic(on);
      },
      onResult: (open) => dispatch({ type: open ? "mic_opened" : "mic_closed" }),
      /**
       * Lỗi mic KHÔNG được biến thành một vòng lặp.
       *
       * Bản trước chỉ `mic_closed` + `hold_end`, nên ở chế độ chạm bật/tắt ý
       * định vẫn còn: vòng đối chiếu kế tiếp lại gọi `setMic`, lại hỏng, lại
       * dispatch. Trên máy thật là `getUserMedia` bị gọi không ngừng - hộp xin
       * quyền nhấp nháy và console ngập lỗi. `mic_failed` hạ ý định xuống,
       * biến chính nút mic thành nút thử lại.
       */
      onError: (error, wanted) => {
        console.error("[voice] không mở/đóng được mic:", error);
        dispatch({
          type: "mic_failed",
          error: wanted
            ? "Không bật được mic. Kiểm tra quyền truy cập rồi chạm để thử lại."
            : "Không tắt được mic.",
          wanted,
        });
        if (wanted) return;

        /*
         * Không TẮT được mic mà vẫn còn quyền phát là ca duy nhất ở đây có thể
         * làm hỏng một ván: người chơi tưởng đã tắt, mic vẫn đi tiếp. Rời hẳn
         * phòng là đường DUY NHẤT chắc chắn không còn phát gì - không ai phát
         * được từ một phòng mình không ở trong đó. Cổng nối lại sẽ đưa họ vào
         * lại bằng một phiên mới, mic tắt sẵn.
         *
         * `disconnect()` của lớp bọc gỡ listener trước khi ngắt, nên `onDisconnected`
         * sẽ KHÔNG bắn - phải tự dispatch.
         */
        const now = stateRef.current;
        if (!now.livekitCanPublish || now.snapshotCanPublish === false) return;
        void roomRef.current?.disconnect();
        dispatch({ type: "disconnected" });
        attemptRef.current({ connection: "idle" });
      },
    });
  }

  if (!roomRef.current) {
    roomRef.current = createVoiceRoom({
      onConnected: () => dispatch({ type: "connected" }),
      /**
       * Mất kết nối hẳn là một tín hiệu nối lại, tự nó.
       *
       * Thứ tự đời thực trên điện thoại KHÔNG phải "rớt rồi mới mở lại app" mà
       * ngược lại: người dùng mở app trước, bốn tín hiệu thức dậy bắn ra khi
       * phiên cũ trên giấy tờ vẫn `connected` nên bị cổng từ chối - đúng và cần
       * thiết - rồi LiveKit mới cố khôi phục, thất bại, và bắn `Disconnected`.
       * Tới đó thì không còn tín hiệu nào nữa, và voice nằm im ở `idle` chờ một
       * cú bấm mà giao diện thậm chí không nói là cần bấm.
       *
       * Truyền thẳng `connection: "idle"` cho cổng thay vì để nó đọc lại
       * `stateRef`: dispatch ở dòng trên chưa kịp có hiệu lực, nên snapshot lúc
       * này vẫn còn ghi `connected` và cổng sẽ từ chối chính mình.
       */
      onDisconnected: (kind) => {
        if (kind === "duplicate") {
          dispatch({ type: "duplicate_session" });
          return;
        }
        /*
         * Ngắt CÓ CHỦ ĐÍCH: server đã gỡ người này khỏi kênh thoại - bị đuổi,
         * rời phòng, host tắt voice, phòng biến mất. Tự vào lại ở đây là đi
         * ngược lại một quyết định vừa được đưa ra, và vì cổng nối lại bám vào
         * mọi tín hiệu thức dậy nên nó sẽ lặp lại ở mỗi lần đổi tab.
         *
         * Không gọi `attemptRef` - và cũng không cần chặn gì thêm: action này
         * xoá `joinedByUser`, tức điều kiện đầu tiên của cổng.
         */
        if (isTerminalDisconnect(kind)) {
          dispatch({ type: "removed_from_voice" });
          return;
        }
        dispatch({ type: "disconnected" });
        attemptRef.current({ connection: "idle" });
      },
      onPermission: (canPublish) => dispatch({ type: "livekit_permission", canPublish }),
      onAudioPlayback: (canPlay) =>
        dispatch(canPlay ? { type: "audio_playback_ok" } : { type: "audio_playback_blocked" }),
      onSpeakers: (identities) => dispatch({ type: "speakers_changed", identities }),
      onReconnecting: () => dispatch({ type: "reconnecting" }),
      /**
       * SDK tự vá xong đường truyền. Hai việc, đúng hai việc.
       *
       * Hạ cờ `reconnecting` là việc bị thiếu: bản trước chỉ gửi `voice:ready`,
       * nên không có gì đưa cờ đó về false và dock đứng mãi ở "Đang kết nối
       * lại" trong khi tiếng đã thông trở lại.
       *
       * Vẫn phải gửi `voice:ready` vì reconnect đầy đủ đưa participant vào lại
       * bằng chính token cũ, mà token không bao giờ mang quyền nói - server
       * phải cấp lại theo pha hiện tại. Nhưng KHÔNG xin token mới và không dựng
       * Room mới: đây là cùng một phiên LiveKit, chưa hề rời đi.
       */
      onReconnected: () => {
        dispatch({ type: "reconnected" });
        socketRef.current?.emit(CLIENT_EVENTS.VOICE_READY, {});
      },
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
   * Xin một token mới rồi vào lại phòng.
   *
   * Đọc socket qua ref: hàm này được gắn vào listener của trình duyệt, mà
   * listener thì sống lâu hơn một lần render.
   */
  const requestToken = useCallback(() => {
    socketRef.current?.emit(CLIENT_EVENTS.VOICE_TOKEN, {});
    dispatch({ type: "connect_requested" });
  }, []);

  /**
   * Tự nối lại khi app sống dậy.
   *
   * Đây là nửa còn thiếu của tính năng, và là lý do người chơi trên điện thoại
   * phải bấm "Bật mic" lại sau mỗi lần ra khỏi app. Hệ điều hành di động không
   * hứa giữ WebRTC khi app nằm nền - nó ngắt hẳn phiên, LiveKit bắn
   * `Disconnected`, và bản trước dừng ở đó: `connection` về `idle` rồi nằm im
   * chờ một cú bấm. Không có gì trong app biết rằng người dùng vừa quay lại.
   *
   * Bốn tín hiệu vì không tín hiệu nào một mình đủ:
   *
   *   - `visibilitychange` - đổi tab trên desktop, và phần lớn ca mở lại app;
   *   - `pageshow` - iOS khôi phục trang từ bfcache, lúc đó `visibilitychange`
   *     có thể không bắn;
   *   - `online` - đổi Wi-Fi sang 4G mà app chưa bao giờ ẩn đi;
   *   - socket nối lại - đường mạng đã thông trở lại theo quan sát của chính app.
   *
   * Bốn tín hiệu ấy hay bắn cùng lúc cho MỘT lần thức dậy, nên tất cả đi qua
   * `createReconnectGate` (thuần, có test riêng) thay vì tự ai nấy gọi.
   */
  const attempt = useCallback(
    (override?: Partial<ReconnectInput>) => {
      const now = stateRef.current;
      const ok = gateRef.current?.request(
        {
          connection: now.connection,
          joinedByUser: now.joinedByUser,
          duplicate: now.duplicate,
          // Đọc môi trường TẠI ĐÂY chứ không nhớ từ trước: cùng một hàm này
          // được gọi từ năm chỗ, mà chỉ bốn trong số đó đi kèm một sự kiện
          // trình duyệt để suy ra "app đang hiện và có mạng".
          visible: !document.hidden,
          online: navigator.onLine !== false,
          canRequest: socketRef.current !== null,
          ...override,
        },
        Date.now(),
      );
      if (ok) requestToken();
    },
    [requestToken],
  );
  // Gán mỗi lần render: callback của SDK đọc muộn qua ref nên luôn thấy bản mới.
  attemptRef.current = attempt;

  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) attempt();
    };

    // Bọc lại thành hàm không tham số: `attempt` nhận một override, mà listener
    // của trình duyệt thì truyền Event vào tham số đầu tiên.
    const onWake = () => attempt();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onWake);
    window.addEventListener("online", onWake);
    socket?.on("connect", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onWake);
      window.removeEventListener("online", onWake);
      socket?.off("connect", onWake);
    };
  }, [socket, attempt]);

  // Lượt xin token đã ngã ngũ - nối được, hỏng, hay lại rớt - thì mở cổng cho
  // lần sau. Không có dòng này thì một lần nối hỏng khoá cổng vĩnh viễn.
  useEffect(() => {
    if (state.connection !== "connecting") gateRef.current?.settle();
  }, [state.connection]);

  /**
   * Không để "đang kết nối" kéo dài vô tận.
   *
   * Server từ chối `voice:token` qua sự kiện lỗi CHUNG của socket, nên hook
   * không nhận ra lời từ chối nào là của mình. Thiếu mốc này thì một lần bị từ
   * chối - vừa bị đuổi khỏi phòng, hoặc chạm rate limit - để dock đứng mãi ở
   * "Đang kết nối lại": không lỗi, không nút nào để bấm, và cổng nối lại cũng
   * khoá theo vì `connection` không bao giờ rời khỏi `connecting`.
   */
  useEffect(() => {
    if (state.connection !== "connecting") return;
    const timer = setTimeout(() => {
      dispatch({ type: "failed", error: "Không vào được kênh thoại, hãy thử lại" });
    }, CONNECT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.connection]);

  /**
   * Host tắt voice, hoặc người chơi không còn ở trong phòng.
   *
   * Phải xoá cả ý định mic lẫn quyền tự nối lại: nếu không, tín hiệu thức dậy
   * kế tiếp sẽ đi xin token cho một kênh thoại đã bị đóng.
   */
  const voiceEnabled = view?.enabled === true;
  useEffect(() => {
    if (voiceEnabled) return;
    // Chưa từng vào voice thì không có gì để dọn - kể cả lần render đầu, lúc
    // snapshot còn chưa về.
    if (!stateRef.current.joinedByUser) return;
    void roomRef.current?.disconnect();
    dispatch({ type: "voice_disabled" });
  }, [voiceEnabled]);

  /**
   * Đồng bộ mic thật với thứ máy trạng thái nói là NÊN mở.
   *
   * Toàn bộ phần khó nằm trong `createMicSync` - thuần, không React, và có test
   * khoá hai bất biến mà tầng này từng vi phạm trên production. Effect ở đây chỉ
   * còn là một lời gọi.
   */
  useEffect(() => {
    // Lỗi mic chưa được người dùng xử lý thì DỪNG hẳn vòng đối chiếu. Thiếu
    // chốt này, một `setMic` hỏng sẽ tự gọi lại chính nó mãi mãi - kể cả hướng
    // đóng, nơi `micShouldBeOpen` đã là false mà `micOpen` thì vẫn true.
    if (state.micError) return;
    micSyncRef.current?.reconcile(micShouldBeOpen(state), state.micOpen);
  }, [state]);

  /**
   * Mọi đường nhả nút ngoài pointerup: rời tab, mất focus. Thiếu chúng thì mic
   * kẹt mở và người chơi phát sóng mà không biết.
   *
   * CHỈ chạm tới `holding`, tức chỉ chạm tới push-to-talk. Bản trước dùng chung
   * một cờ cho cả hai chế độ, nên chuyển tab một giây là tắt mic của người đang
   * ở chế độ chạm bật/tắt - đúng hành vi "out voice khi đổi tab" mà không ai
   * yêu cầu. Ở chế độ ấy người dùng đã nói rõ họ muốn mic bật, và họ chưa rút
   * lại lời đó.
   */
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
    if (state.connection === "idle" || state.connection === "failed") requestToken();
  }, [requestToken, state.connection]);

  /**
   * Chủ động rời kênh thoại.
   *
   * `leave_requested` xoá `joinedByUser`, nên không tín hiệu thức dậy nào kéo
   * họ vào lại. Đây là khác biệt duy nhất, và là khác biệt quan trọng nhất,
   * giữa "tôi ngắt" và "mạng rớt".
   */
  const leave = useCallback(() => {
    void roomRef.current?.disconnect();
    dispatch({ type: "leave_requested" });
  }, []);

  return {
    ui: useMemo(() => voiceUi(state, view), [state, view]),
    activate,
    leave,
    holdStart: useCallback(() => dispatch({ type: "hold_start" }), []),
    holdEnd: useCallback(() => dispatch({ type: "hold_end", reason: "pointerup" }), []),
    toggleMic: useCallback(() => dispatch({ type: "mic_intent_toggle" }), []),
    micMode,
    setMicMode: useCallback((mode: MicMode) => {
      setMicModeState(mode);
      saveVoiceSettings({ micMode: mode });
      // Đổi chế độ giữa lúc đang nói thì đóng mic lại: người dùng vừa đổi cách
      // thao tác, giữ nguyên trạng thái nói sẽ khiến họ không biết mình còn
      // đang phát hay không. Xoá cả ý định, nếu không nó sẽ tự mở lại ngay ở
      // vòng đối chiếu kế tiếp.
      dispatch({ type: "hold_end" });
      dispatch({ type: "mic_intent_clear" });
    }, []),
    micOpen: state.micOpen,
    micIntent: state.micIntent,
    micError: state.micError,
    speakers: useMemo(() => new Set(state.speakers), [state.speakers]),
  };
}
