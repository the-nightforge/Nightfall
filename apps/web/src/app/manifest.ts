import type { MetadataRoute } from "next";

/**
 * Web App Manifest, sinh bằng quy ước file của App Router.
 *
 * Đặt ở `app/manifest.ts` chứ không phải một file JSON tĩnh trong /public:
 * Next dựng nó thành route `/manifest.webmanifest` và tự gắn `<link rel=
 * "manifest">` vào mọi trang, nên không có chỗ nào để đường dẫn lệch đi.
 *
 * Hàm này không đọc gì ở request time nên Next cache nó như một route tĩnh -
 * đúng thứ ta muốn cho một file mà trình duyệt tải lại mỗi lần cài.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    /*
     * `id` cố định và tách khỏi `start_url`.
     *
     * Không khai báo thì trình duyệt lấy `start_url` làm danh tính ứng dụng, và
     * ngày nào đó đổi trang mở đầu là ngày đó Chrome coi đây là một ứng dụng
     * KHÁC: người đã cài sẽ thấy hai biểu tượng cạnh nhau.
     */
    id: "/",
    name: "Ma Sói Online",
    short_name: "Ma Sói",
    description:
      "Game Ma Sói online nhiều người chơi - lập phòng, mời bạn bè bằng mã phòng và chơi ngay trên trình duyệt.",
    lang: "vi",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    /*
     * `display_override` để Chromium thử `standalone` trước rồi mới rơi về
     * `minimal-ui`. Trình duyệt nào không hiểu khoá này thì bỏ qua và đọc
     * `display` bên trên - nên đây thuần tuý là một nấc dự phòng, không phải
     * một cấu hình song song.
     */
    display_override: ["standalone", "minimal-ui"],
    /*
     * `portrait` chứ không `portrait-primary`: khoá primary là cấm luôn chiều
     * dọc lộn ngược, thứ mà người nằm cầm máy vẫn dùng. Bàn chơi có bố cục
     * riêng cho điện thoại nằm ngang (`phone-landscape` trong tailwind.config)
     * nhưng đó là bố cục chống chật, không phải hướng ta muốn mời người ta vào.
     */
    orientation: "portrait",
    background_color: "#070b14",
    theme_color: "#070b14",
    categories: ["games", "entertainment", "social"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      /*
       * Bản maskable là một FILE RIÊNG, không phải cùng file gắn hai purpose.
       *
       * Android cắt icon theo hình của launcher và chỉ giữ lại vòng tròn giữa
       * khung; dấu sói trong bản `any` rộng 62% cạnh nên hai tai sẽ bị xén.
       * Bản maskable thu dấu về 50% cạnh để nằm trọn trong vùng an toàn.
       */
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
