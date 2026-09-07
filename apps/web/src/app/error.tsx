"use client";

import Link from "next/link";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Chốt chặn lỗi render cho toàn bộ route.
 *
 * Thiếu file này, một exception lúc render - một vai lạ tra vào ROLE_META, một
 * trường snapshot bị null - sẽ tháo cả cây React và người chơi nhận màn hình
 * trắng của framework: giữa ván, không còn lối nào quay lại phòng.
 *
 * `reset()` render lại đúng nhánh vừa hỏng. Với trang phòng, render lại nghĩa
 * là useRoomSocket gắn lại và server bắn snapshot mới - tức là VÀO LẠI ĐƯỢC ván
 * đang chơi, chứ không phải chỉ xoá thông báo lỗi đi.
 */
export default function RoomError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Bản build production chỉ đưa ra `digest`, thân lỗi bị nuốt. Ghi ra console
  // để lỗi còn dấu vết ở phía máy người chơi khi họ gửi lại cho ta.
  useEffect(() => {
    console.error("Lỗi render:", error);
    // Không có DSN thì captureException là no-op - xem instrumentation-client.ts.
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-display text-2xl font-bold text-white">Ván bị gián đoạn</h1>
      <p className="text-sm text-mist/85">
        Giao diện gặp lỗi ngoài dự tính. Ván trên máy chủ vẫn đang chạy — thử vào lại,
        bạn sẽ trở về đúng pha hiện tại.
      </p>
      {error.digest && (
        <p className="font-mono text-[11px] text-mist/40">Mã lỗi: {error.digest}</p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" className="btn-primary" onClick={reset}>
          Thử lại
        </button>
        <Link href="/" className="btn-secondary">
          Về trang chủ
        </Link>
      </div>
    </main>
  );
}
