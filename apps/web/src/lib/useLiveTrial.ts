"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import {
  EMPTY_LIVE_TRIAL_SESSION,
  advanceLiveTrial,
  consumeLiveTrialBeats,
  pendingBeats,
  type LiveTrialSession,
  type TrialStageBeat,
  type TrialStageView,
} from "./live-trial";

/**
 * Không bao giờ cấp phát một mảng rỗng mới.
 *
 * `beats` đi thẳng vào deps của effect chạy hiệu ứng trong `TrialStageCanvas`.
 * Một `[]` mới ở mỗi snapshot là một danh tính mới, nên effect ấy sẽ chạy lại ở
 * MỌI snapshot - kể cả những snapshot không có gì đổi.
 */
const NO_BEATS: TrialStageBeat[] = [];

export interface LiveTrial {
  /** Trạng thái sân khấu, hoặc null khi lúc này không có phiên toà nào. */
  view: TrialStageView | null;
  /** Nhịp diễn CHƯA có ai nhận. Rỗng là không có gì để diễn. */
  beats: TrialStageBeat[];
  /**
   * Số thứ tự của lô `beats`. Sân khấu báo lại số này khi đã nhận.
   *
   * Cần một con số chứ không phải một cờ boolean: sân khấu có thể báo muộn một
   * nhịp, và lúc đó lô mới đã tới - `consumeLiveTrialBeats` so đúng số nên
   * không nuốt nhầm lô mới.
   */
  beatsId: number;
  /** Sân khấu gọi khi đã cầm lô đó, để nó không bao giờ được phát lần hai. */
  consumeBeats: (id: number) => void;
}

/**
 * Nối luồng snapshot vào sân khấu "Phiên toà sống".
 *
 * Đặt ở CẤP TRANG chứ không trong component sân khấu, và đó là điều kiện để cả
 * tính năng đúng - không phải một lựa chọn về kiểu dáng:
 *
 *   1. Trí nhớ phải sống qua những pha KHÔNG có phiên toà. Sân khấu chỉ được
 *      dựng khi đã có bị cáo, nên nếu trí nhớ nằm trong nó thì snapshot đầu tiên
 *      nó thấy luôn trùng với lúc phiên toà mở ra - và không có cách nào phân
 *      biệt "vừa mở ra trước mắt tôi" với "đã mở từ trước khi tôi tới".
 *   2. Nó cũng phải sống qua những lúc sân khấu bị THÁO: xoay ngang điện thoại
 *      (màn hình thấp thì rơi về bản 2D), mất WebGL, hay cảnh 3D vỡ giữa chừng.
 *      Lô nhịp diễn đã phát mà nằm lại trong state thì mỗi lần dựng lại là một
 *      lần phát lại.
 *
 * Toàn bộ quyết định vòng đời nằm ở `advanceLiveTrial`/`consumeLiveTrialBeats` -
 * hai hàm thuần có test riêng ở `live-trial-session.test.ts`. Ở đây chỉ còn ba
 * việc: gọi chúng, cất kết quả vào state, và đưa `consumeBeats` xuống dưới.
 */
export function useLiveTrial(snapshot: RoomSnapshot | null, connected: boolean): LiveTrial {
  const session = useRef<LiveTrialSession>(EMPTY_LIVE_TRIAL_SESSION);
  const [published, setPublished] = useState<{
    view: TrialStageView | null;
    beats: TrialStageBeat[];
    beatsId: number;
  }>({ view: null, beats: NO_BEATS, beatsId: 0 });

  useEffect(() => {
    const next = advanceLiveTrial(session.current, { snapshot, connected });
    session.current = next;
    const beats = pendingBeats(next);
    setPublished((previous) => {
      // Phần lớn ván không có phiên toà nào. Trả lại đúng object cũ ở những
      // snapshot ấy để cả cây không render thêm một lượt vì một thứ không đổi.
      if (previous.view === next.view && previous.beats.length === 0 && beats.length === 0) {
        return previous;
      }
      return { view: next.view, beats: beats.length === 0 ? NO_BEATS : beats, beatsId: next.beatsId };
    });
  }, [snapshot, connected]);

  const consumeBeats = useCallback((id: number) => {
    const next = consumeLiveTrialBeats(session.current, id);
    if (next === session.current) return;
    session.current = next;
    /*
     * Xoá luôn khỏi state đã công bố.
     *
     * Không đủ nếu chỉ ghi vào `session`: giữa hai snapshot không có lần chạy
     * effect nào, nên `published.beats` sẽ đứng nguyên ở lô cũ - và mỗi lần sân
     * khấu bị dựng lại trong khoảng đó là một lần nó nhận lại đúng lô ấy.
     */
    setPublished((previous) => (previous.beats.length === 0 ? previous : { ...previous, beats: NO_BEATS }));
  }, []);

  return {
    view: published.view,
    beats: published.beats,
    beatsId: published.beatsId,
    consumeBeats,
  };
}
