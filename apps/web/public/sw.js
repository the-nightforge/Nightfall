/*
 * Service worker của Ma Sói Online.
 *
 * Nó làm ĐÚNG MỘT VIỆC: khi một lần điều hướng thất bại vì mất mạng, trả về
 * trang offline thay cho màn hình lỗi trắng của trình duyệt. Không có gì khác.
 *
 * Bản đầu còn cache thêm `/_next/static/`, `/icons/`, `/characters/` và
 * `/images/` theo lối cache-first. Bỏ hết, vì ba lý do:
 *
 *   1. `/_next/static/` đã được Next gắn sẵn
 *      `Cache-Control: public, max-age=31536000, immutable` và không ghi đè
 *      được (xem `docs/01-app/02-guides/cdn-caching.md`). Cache của HTTP đã làm
 *      trọn việc đó rồi; một lớp cache nữa trong service worker chỉ là bản sao
 *      thứ hai của cùng một dữ liệu, chậm hơn ở lần đầu và không nhanh hơn ở
 *      lần sau.
 *   2. `/icons/`, `/characters/`, `/images/` thì NGƯỢC LẠI: tên file không mang
 *      hash. Cache-first cho nhóm này nghĩa là người chơi giữ bản cũ vĩnh viễn,
 *      cho tới khi ai đó nhớ ra phải đổi số version bằng tay.
 *   3. Không có cách nào để một file tĩnh trong /public tự biết mình thuộc bản
 *      deploy nào, nên cũng không có cách nào dọn tài nguyên của bản deploy cũ.
 *      Một cache chỉ lớn lên mà không bao giờ nhỏ lại là một cái rò rỉ.
 *
 * Đây là game nhiều người chơi thời gian thực: dữ liệu mới luôn đáng giá hơn
 * khả năng chạy offline. Cắt phần cache tài nguyên đi thì cả nhóm vấn đề trên
 * biến mất mà không mất thứ gì người chơi thấy được.
 *
 * Luật cứng, đọc kỹ trước khi sửa:
 *
 *   - Chỉ đụng vào GET, cùng origin, và CHỈ điều hướng.
 *   - Không đụng /api, /socket.io, /audio, /cinematics và mọi payload RSC.
 *   - Điều hướng luôn đi mạng trước, và không bao giờ cache kết quả.
 *   - Không gọi skipWaiting().
 *
 * File này nằm trong /public để có scope "/" - service worker chỉ kiểm soát
 * được các đường dẫn nằm dưới thư mục chứa chính nó.
 */

/*
 * Một cái tên cố định, KHÔNG mang số version.
 *
 * Bản đầu dùng `masoi-shell-v1` và dựa vào việc lập trình viên nhớ tăng số đó
 * sau mỗi lần đổi nội dung - một cơ chế chỉ hỏng đúng vào lúc không ai để ý.
 * Ở đây không cần version nữa, và lý do rất hẹp, nên nếu phá vỡ nó thì phải
 * đổi luôn cái tên này:
 *
 *   Cache chứa ĐÚNG MỘT mục, `/offline.html`, và ý nghĩa của mục đó không bao
 *   giờ đổi giữa các phiên bản worker.
 *
 * Nhờ đó, worker đang cài và worker đang chạy có ghi đè lên nhau cũng không
 * sao: cả hai ghi cùng một thứ với cùng một ý nghĩa, và bên đọc chỉ cần "trang
 * offline nào đó". Mỗi lần cài, `install` tải lại trang offline nên nội dung
 * cũng không bao giờ cũ.
 *
 * Nếu sau này cần cache thêm thứ gì có ý nghĩa khác, quy tắc trên gãy: khi ấy
 * phải dùng một tên cache khác, đặt tự động theo bản build.
 */
const CACHE = "masoi-offline";

/** Tiền tố nhận diện cache của chính app này - dùng để dọn, không đụng của ai khác. */
const OWNED = /^masoi-/;

const OFFLINE_URL = "/offline.html";

/**
 * Những đường dẫn service worker tuyệt đối không được trả lời thay.
 *
 * Ghi không kèm dấu "/" ở cuối và so khớp cả đường dẫn CHÍNH XÁC lẫn nhánh con:
 * `/api` (không có gì phía sau) là một request thật, và một danh sách chỉ chặn
 * `"/api/"` sẽ để lọt nó.
 */
const BYPASS = ["/api", "/socket.io", "/audio", "/cinematics"];

function isBypassed(pathname) {
  return BYPASS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      /*
       * `cache: "reload"` bỏ qua HTTP cache khi lấy trang offline.
       *
       * `/offline.html` không mang hash trong tên, nên không có nó thì bản cũ
       * đang nằm trong HTTP cache sẽ được đóng đinh vào cache của worker và ở
       * lại đó cho tới lần cài kế tiếp.
       */
      const response = await fetch(OFFLINE_URL, { cache: "reload" });
      if (!response.ok) {
        throw new Error(`Không lấy được ${OFFLINE_URL}: HTTP ${response.status}`);
      }
      const cache = await caches.open(CACHE);
      /*
       * `await` chứ không bắn rồi quên.
       *
       * Không chờ thì worker có thể bị dừng ngay sau khi `install` trả về, và
       * lần ghi cache còn dở dang chết theo - service worker cài "thành công"
       * nhưng cache rỗng. Lỗi hết quota cũng chỉ nổi lên được nếu có chờ.
       *
       * Để lỗi ném ra ngoài là có chủ ý: `waitUntil` nhận nó, trình duyệt đánh
       * dấu lần cài này hỏng và sẽ thử lại ở lần vào sau. Đó không phải một
       * rejection lạc trôi, và cũng không ảnh hưởng gì tới trang đang mở - chỉ
       * là lần này chưa có trang offline.
       */
      await cache.put(OFFLINE_URL, response);
    })(),
  );

  /*
   * KHÔNG gọi skipWaiting().
   *
   * Bản mới nằm chờ tới khi mọi tab của game đóng hết. Đây là khác biệt giữa
   * "cập nhật" và "cắt ngang một ván đang chơi": tráo service worker giữa chừng
   * là tráo luật dưới chân một trang đang chạy, và mọi cách ép nó có hiệu lực
   * ngay đều dẫn tới một lần tải lại trang.
   */
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      /*
       * Chỉ dọn cache mang tiền tố của chính app này.
       *
       * Cùng một origin có thể còn cache của thứ khác - một thư viện, một trang
       * khác cùng tên miền - và xoá sạch mọi thứ là phá đồ của người khác. Vòng
       * lọc này cũng chính là đường dọn `masoi-shell-v1` và `masoi-assets-v1`
       * của bản thiết kế cũ.
       */
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => OWNED.test(key) && key !== CACHE).map((key) => caches.delete(key)),
      );

      /*
       * clients.claim() an toàn ở đây CHÍNH VÌ không có skipWaiting.
       *
       * Không có skipWaiting thì `activate` chỉ chạy ở hai thời điểm: lần cài
       * đầu tiên, hoặc sau khi mọi tab cũ đã đóng. Cả hai đều không có ván nào
       * đang chạy để mà cắt ngang. Đổi lại, lần vào đầu tiên đã có ngay trang
       * offline thay vì phải đợi tới lần mở sau.
       */
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Chỉ GET. POST /api/players, mọi thứ LiveKit gửi đi... đều đi thẳng.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  /*
   * Khác origin là đi thẳng: server game, LiveKit và Google Fonts đều nằm ở
   * origin khác, và không có cái nào trong đó là thứ ta được phép trả lời thay.
   */
  if (url.origin !== self.location.origin) return;

  if (isBypassed(url.pathname)) return;

  /*
   * Payload RSC của Next đi kèm `?_rsc=` hoặc header `RSC: 1`.
   *
   * Đây là dữ liệu trang, không phải tài nguyên tĩnh - và với /room/[code] thì
   * nó là trạng thái phòng.
   */
  if (url.searchParams.has("_rsc") || request.headers.get("RSC") === "1") return;

  /*
   * CHỈ điều hướng. Mọi thứ khác - script, ảnh, font - đi thẳng ra mạng và ra
   * cache HTTP của trình duyệt, đúng như khi không có service worker nào.
   */
  if (request.mode !== "navigate") return;

  event.respondWith(navigateOrOffline(request));
});

/**
 * Đi mạng trước; hỏng thì mới lấy trang offline ra.
 *
 * Phản hồi của mạng được trả về NGUYÊN VẸN và không đi qua cache một bước nào:
 * HTML của `/room/[code]` là cửa vào một ván đang diễn ra, giữ lại một bản là
 * mời người chơi quay vào một cái phòng đã tan.
 */
async function navigateOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE);
    const offline = await cache.match(OFFLINE_URL);
    return (
      offline ??
      /*
       * Đường lui cuối: lần cài trước hỏng nên chưa có trang offline. Vẫn phải
       * ra một phản hồi tử tế chứ không phải một promise bị từ chối.
       */
      new Response("Mất kết nối mạng. Kiểm tra Wi-Fi hoặc dữ liệu di động rồi thử lại.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}
