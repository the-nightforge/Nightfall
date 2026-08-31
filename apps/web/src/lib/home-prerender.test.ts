import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/*
 * Chốt hồi quy cho lỗi "màn hình trắng nhịp đầu" ở trang chủ.
 *
 * Lỗi cũ: `HomeInner` gọi `useSearchParams()`, và cả cây bị bọc trong một
 * `<Suspense>` không fallback. Tài liệu Next đi kèm repo
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
 * use-search-params.md) nói rõ: gọi hook đó trong một route được prerender sẽ
 * đẩy TOÀN BỘ cây client tính tới boundary gần nhất sang render ở client. Vì
 * boundary gần nhất bọc cả trang, HTML tĩnh của `/` chỉ còn đúng một thẻ
 * `BAILOUT_TO_CLIENT_SIDE_RENDERING` - người dùng nhìn màn hình trắng cho tới
 * khi bundle tải xong.
 *
 * Đây là test đọc mã nguồn chứ không phải render, và đó là lựa chọn có chủ ý:
 * bộ test của app chạy bằng `tsx --test src/lib/*.test.ts` - không DOM, không
 * React, không dựng nổi một bản build Next. Thứ duy nhất kiểm được ở tầng này
 * là ba điều kiện đã sinh ra lỗi. Vi phạm bất kỳ cái nào là màn hình trắng
 * quay lại, nên chúng đáng được canh.
 */

/**
 * Bỏ chú thích trước khi soi.
 *
 * Không phải chuyện thẩm mỹ: những dòng chú thích đáng viết nhất ở hai file này
 * chính là dòng GIẢI THÍCH vì sao không được gọi `useSearchParams` và vì sao
 * `<Suspense>` phải có fallback - chúng nhắc lại nguyên văn thứ mà test đi tìm.
 * Soi cả văn xuôi thì test bắt đúng lời cảnh báo của chính nó và trừng phạt
 * người viết chú thích tử tế.
 *
 * Chú thích khối đi trước, và nó nuốt luôn dạng `{/* ... *​/}` của JSX. Chú
 * thích dòng thì đòi ký tự trước `//` không phải dấu hai chấm, để `http://`
 * trong chuỗi thật không bị cắt mất phần đuôi.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Đọc file theo đường dẫn tương đối với chính file test, không phải với cwd. */
function readSource(relativePath: string): string {
  return stripComments(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

describe("trang chủ phải prerender được", () => {
  const page = readSource("../app/page.tsx");

  it("không gọi useSearchParams trong file trang", () => {
    assert.ok(
      !page.includes("useSearchParams"),
      "page.tsx gọi useSearchParams: cả trang sẽ rơi khỏi HTML tĩnh. Hook này " +
        "phải nằm ở JoinCodeFromQuery - một lá không vẽ gì cả.",
    );
  });

  it("giữ tiêu đề trong mã trang, không phải dựng bằng JS lúc chạy", () => {
    assert.ok(
      page.includes("MA SÓI ONLINE"),
      "Tiêu đề phải nằm thẳng trong JSX để nó có mặt trong HTML tải đầu.",
    );
  });

  it("giữ form vào phòng trong mã trang", () => {
    for (const marker of ['id="nickname"', 'id="join-code"', "Tạo phòng mới"]) {
      assert.ok(page.includes(marker), `Thiếu ${marker} trong page.tsx`);
    }
  });

  it("mọi Suspense trong trang đều có fallback", () => {
    for (const tag of page.match(/<Suspense[^>]*>/g) ?? []) {
      assert.match(
        tag,
        /fallback=/,
        `${tag} không có fallback. Một boundary không fallback thì phần HTML ` +
          "tĩnh của nó là rỗng - đúng cái lỗi này.",
      );
    }
  });
});

describe("JoinCodeFromQuery phải là lá không vẽ gì", () => {
  const leaf = readSource("../components/JoinCodeFromQuery.tsx");

  /*
   * Ràng buộc thật của thiết kế: vì nó render null, `fallback={null}` là bản
   * sao CHÍNH XÁC của nó. Không có hai bản giao diện để lệch nhau, và không có
   * gì để nhấp nháy khi boundary được thay chỗ lúc hydrate.
   */
  it("render null", () => {
    assert.match(
      leaf,
      /return null/,
      "Lá này chỉ được đọc query rồi báo ra ngoài. Vẽ bất cứ thứ gì là dựng " +
        "một bản giao diện thứ hai phải khớp với fallback.",
    );
  });

  it("là nơi duy nhất đọc query string của trang chủ", () => {
    assert.ok(leaf.includes("useSearchParams"), "Lá này phải là nơi giữ hook.");
  });
});
