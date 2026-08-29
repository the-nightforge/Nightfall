"use client";

import { useEffect, useRef, useState } from "react";
import { MOODS, type Mood } from "@/lib/mood";
import type { GameEventView } from "@masoi/shared";
import { EventEnvironment } from "./EventEnvironment";

/**
 * Nền của cả màn hình, đổi theo không khí của pha.
 *
 * Dựng sẵn MỘT lớp cho mỗi không khí rồi chỉ bật/tắt opacity, chứ không đổi
 * background của một lớp duy nhất: background-image không phải thuộc tính
 * animate được, đổi thẳng thì nền nhảy phắt sang màu mới. Opacity thì chạy trên
 * compositor nên không tốn một khung hình nào của luồng chính.
 *
 * Chồng lên đó là một màn quét chạy ngang mỗi lần đổi không khí. Hai lớp làm
 * hai việc khác nhau: lớp nền nói sân khấu ĐANG ở đâu, màn quét nói nó VỪA đổi.
 * Chỉ cross-fade 1.1 giây thì đúng nhưng êm quá, mắt đang dán vào thẻ bài không
 * bắt được thời điểm.
 */
export function Backdrop({ mood, event }: { mood: Mood; event?: GameEventView | null }) {
  const previous = useRef(mood);
  const sweepSeq = useRef(0);
  const [sweep, setSweep] = useState<{ id: number; mood: Mood } | null>(null);

  useEffect(() => {
    if (previous.current === mood) return;
    previous.current = mood;
    // Chặn từ đầu chứ không dựng rồi giấu bằng CSS: giấu thì animationend không
    // bao giờ chạy và phần tử nằm lại trong cây vĩnh viễn.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setSweep({ id: (sweepSeq.current += 1), mood });
  }, [mood]);

  return (
    <div className="backdrop" aria-hidden="true">
      {MOODS.map((candidate) => (
        <div
          key={candidate}
          className={`backdrop-layer backdrop-${candidate}`}
          data-active={candidate === mood}
        />
      ))}
      {sweep && (
        <div
          key={sweep.id}
          className={`backdrop-sweep backdrop-sweep-${sweep.mood}`}
          onAnimationEnd={() => setSweep((current) => (current?.id === sweep.id ? null : current))}
        />
      )}
      <div className="backdrop-vignette" />
      <EventEnvironment event={event} />
    </div>
  );
}
