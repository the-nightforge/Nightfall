"use client";

import { useEffect, useRef, useState } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { serverNow } from "./clock";
import { nextPhaseMarkers, type PhaseMarker } from "./chat-timeline";

/**
 * Mốc đổi pha để khung chat vẽ vạch ngăn.
 *
 * Toàn bộ phần quyết định nằm trong `nextPhaseMarkers` - một hàm thuần có test
 * đi kèm. Ở đây chỉ còn đúng ba việc mà một hàm thuần không làm được: giữ danh
 * sách qua các lần render, đọc giờ SERVER (không phải `Date.now()` của máy
 * người chơi, vốn lệch được hàng chục giây so với `ChatMessage.at`), và chạy
 * lại mỗi khi có snapshot mới.
 *
 * `nextPhaseMarkers` trả về chính mảng cũ khi không có gì để thêm, nên
 * `setState` bỏ qua và không có lần render nào bị sinh thêm - dù server đẩy
 * snapshot vài lần một giây trong pha bỏ phiếu.
 */
export function usePhaseMarkers(snapshot: RoomSnapshot | null): PhaseMarker[] {
  const [markers, setMarkers] = useState<PhaseMarker[]>([]);
  const latest = useRef(snapshot);
  latest.current = snapshot;

  /*
   * Phụ thuộc vào KHOÁ pha, không vào chính đối tượng snapshot.
   *
   * Hai lý do. Một: server đẩy snapshot mới vài lần một giây ở pha bỏ phiếu,
   * và mỗi lần là một đối tượng khác - chạy effect cho từng cái chỉ để nó
   * quyết định không làm gì là lãng phí. Hai, quan trọng hơn: nếu chỗ gọi
   * dựng lại snapshot ở mỗi lần render thì phụ thuộc vào đối tượng sẽ thành
   * vòng lặp render vô hạn. Khoá này chỉ đổi khi pha thật sự đổi.
   */
  const key = snapshot
    ? `${snapshot.phase}:${snapshot.round}:${snapshot.phaseEndsAt ?? "-"}`
    : "";

  useEffect(() => {
    setMarkers((previous) => nextPhaseMarkers(previous, latest.current, serverNow()));
  }, [key]);

  return markers;
}
