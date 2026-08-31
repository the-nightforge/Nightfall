"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeJoinCode } from "@/lib/join-code";

interface Props {
  /** Nhận mã đã chuẩn hoá. Chỉ được gọi khi query thực sự mang một mã dùng được. */
  onCode: (code: string) => void;
}

/**
 * Đọc `?code=` rồi báo ra ngoài. Không vẽ một pixel nào.
 *
 * Vì sao phải là một component riêng, và vì sao nó phải rỗng:
 *
 * `useSearchParams` là hook chặn prerender. Tài liệu Next đi kèm repo
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
 * use-search-params.md) nói: gọi nó trong một route được prerender sẽ đẩy TOÀN
 * BỘ cây client tính tới `<Suspense>` gần nhất sang render ở client. Bản trước
 * gọi hook ngay trong `HomeInner` với một boundary bọc cả trang, nên HTML tĩnh
 * của `/` không còn gì ngoài một thẻ BAILOUT_TO_CLIENT_SIDE_RENDERING - đúng
 * một nhịp màn hình trắng trước khi bundle kịp chạy.
 *
 * Đẩy hook xuống đây thì boundary co lại vừa bằng component này, và vì component
 * này render null nên `fallback={null}` là bản sao CHÍNH XÁC của nó. Đó là điểm
 * mấu chốt: không có bản giao diện thứ hai nào để lệch với bản thật, không có
 * skeleton nào phải bảo trì song song, và lúc hydrate không có gì nhấp nháy khi
 * fallback được thay chỗ.
 *
 * Hydration mismatch cũng không có đường xảy ra: cả server lẫn client đều dựng
 * ra rỗng, mã chỉ chảy vào ô nhập trong effect - tức là SAU khi hydrate xong.
 *
 * Dùng hook thay vì đọc thẳng `window.location.search` để mã vẫn tự điền khi
 * người dùng tới trang chủ bằng điều hướng phía client - đúng cái mà trang
 * phòng làm khi thiếu danh tính: `router.replace("/?code=" + code)`.
 */
export function JoinCodeFromQuery({ onCode }: Props) {
  const params = useSearchParams();
  const code = normalizeJoinCode(params.get("code"));

  /*
   * Phụ thuộc vào `code` đã chuẩn hoá chứ không vào object `params`.
   *
   * `params` là một tham chiếu mới sau mỗi lần điều hướng, kể cả khi query
   * không đổi; bám vào nó thì effect chạy lại và ghi đè ô nhập lên trên chữ
   * người dùng vừa gõ. Bám vào chuỗi thì effect chỉ chạy khi mã thật sự đổi.
   */
  useEffect(() => {
    if (code) onCode(code);
  }, [code, onCode]);

  return null;
}
