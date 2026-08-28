"use client";

import { MOODS, type Mood } from "@/lib/mood";

/**
 * Nền của cả màn hình, đổi theo không khí của pha.
 *
 * Dựng sẵn MỘT lớp cho mỗi không khí rồi chỉ bật/tắt opacity, chứ không đổi
 * background của một lớp duy nhất: background-image không phải thuộc tính
 * animate được, đổi thẳng thì nền nhảy phắt sang màu mới. Opacity thì chạy trên
 * compositor nên không tốn một khung hình nào của luồng chính.
 */
export function Backdrop({ mood }: { mood: Mood }) {
  return (
    <div className="backdrop" aria-hidden="true">
      {MOODS.map((candidate) => (
        <div
          key={candidate}
          className={`backdrop-layer backdrop-${candidate}`}
          data-active={candidate === mood}
        />
      ))}
      <div className="backdrop-vignette" />
    </div>
  );
}
