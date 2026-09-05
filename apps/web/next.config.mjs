/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        /*
         * Service worker không được nằm lại trong cache HTTP.
         *
         * Trình duyệt tự giới hạn tuổi của `sw.js` ở 24 giờ, nhưng 24 giờ vẫn
         * là 24 giờ một luật cache cũ tiếp tục có hiệu lực sau khi đã sửa nó.
         * `no-cache` bắt kiểm tra lại với server ở mỗi lần đăng ký, nên một
         * bản vá cho `public/sw.js` có hiệu lực ngay ở lần mở app kế tiếp.
         */
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
