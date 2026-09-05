"use client";

import { useEffect, useRef, useState } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import {
  initialGuidePrepState,
  stepGuidePrep,
  type GuidePrepStage,
  type GuidePrepState,
} from "./guide-prep";
import { isGuidePrepared, markGuidePrepared } from "./guide-session";

interface Input {
  code: string;
  /** Hướng dẫn đã được xin cho phòng này (đang hiện HAY đã ẩn - cả hai). */
  requested: boolean;
  snapshot: RoomSnapshot | null;
  isHost: boolean;
  connected: boolean;
  emit: (event: string, payload?: unknown) => void;
}

/**
 * Vỏ React của `stepGuidePrep`: giữ trạng thái trong một ref, chạy máy mỗi
 * khi có snapshot mới / đổi kết nối, và hẹn giờ gọi lại khi máy bảo chờ.
 *
 * Ref chứ không state: React StrictMode mount-unmount-mount cùng một instance,
 * ref sống qua đó, nên lần chạy thứ hai thấy "đang chờ xác nhận" và không gửi
 * lại. Chỉ `stage` được đưa ra ngoài bằng state - đó là thứ duy nhất giao
 * diện cần để nói đúng chuyện đang xảy ra.
 *
 * `emit` đi qua ref: `useRoomSocket` tạo hàm mới mỗi lần render, đưa nó vào
 * deps là chạy lại effect ở MỌI render mà không có lý do.
 */
export function useGuidePrep(input: Input): GuidePrepStage | null {
  const { code, requested, snapshot, isHost, connected } = input;
  const emitRef = useRef(input.emit);
  emitRef.current = input.emit;
  const stateRef = useRef<GuidePrepState | null>(null);
  const [stage, setStage] = useState<GuidePrepStage | null>(null);

  useEffect(() => {
    if (!requested || !code) return;
    if (stateRef.current === null) stateRef.current = initialGuidePrepState(isGuidePrepared(code));

    let timer: number | undefined;
    const run = () => {
      const step = stepGuidePrep(stateRef.current!, {
        snapshot,
        isHost,
        connected,
        now: Date.now(),
      });
      stateRef.current = step.state;
      if (step.emit) emitRef.current(step.emit.event, step.emit.payload);
      if (step.state.stage === "done") markGuidePrepared(code);
      setStage((previous) => (previous === step.state.stage ? previous : step.state.stage));
      if (step.wakeAt !== null) {
        timer = window.setTimeout(run, Math.max(0, step.wakeAt - Date.now()));
      }
    };
    run();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [requested, code, snapshot, isHost, connected]);

  return requested ? stage : null;
}
