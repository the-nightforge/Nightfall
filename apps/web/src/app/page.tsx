"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_TO_START } from "@masoi/shared";
import { EntryAttemptManager } from "@/lib/entry-attempt";
import { runEntryAttempt, type CreatePlayerOutcome, type EntryPorts } from "@/lib/home-entry";
import { getIdentity, saveIdentity, clearIdentity } from "@/lib/identity";
import type { RoomEntryRequest } from "@/lib/room-entry";
import { disconnectSocket } from "@/lib/socket";
import type { Identity } from "@/lib/identity";
import { Backdrop } from "@/components/Backdrop";
import { BrandMark, VillageScene } from "@/components/HomeHero";
import { JoinCodeFromQuery } from "@/components/JoinCodeFromQuery";
import { MatchHistoryPanel } from "@/components/MatchHistoryPanel";
import { AssetCredits } from "@/components/AssetCredits";

/** Hành động đang chạy, hoặc null khi rảnh. */
type Pending = "create" | "join" | null;

/**
 * POST /api/players, có thể huỷ giữa chừng.
 *
 * `signal` là bắt buộc chứ không phải tuỳ chọn: người dùng bấm "Xoá phiên" hay
 * rời trang giữa lúc request đang bay thì nó phải chết theo, chứ không được về
 * muộn rồi ghi một phiên mới vào máy họ.
 */
async function createPlayer(nickname: string, signal: AbortSignal): Promise<CreatePlayerOutcome> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000"}/api/players`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname }),
      signal,
    },
  );
  const data = await res.json();
  if (!res.ok) return { ok: false, message: data.error ?? "Có lỗi xảy ra" };
  return { ok: true, identity: data as Identity };
}

export default function Home() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  /*
   * Khởi tạo rỗng, đúng bằng thứ server dựng ra.
   *
   * Mã phòng từ `?code=` không được đọc trong lúc render nữa. Bản trước gọi
   * `useSearchParams()` ngay ở đây, và hook đó đẩy cả cây client tính tới
   * `<Suspense>` gần nhất ra khỏi HTML tĩnh - mà boundary gần nhất lại bọc cả
   * trang. `JoinCodeFromQuery` bên dưới rót mã vào sau khi hydrate xong; xem
   * file đó về lý do đầy đủ.
   */
  const [joinCode, setJoinCode] = useState("");
  /*
   * Một biến `pending` thay cho `busy` boolean cũ.
   *
   * Hai nút dùng chung một cờ bận thì nút KIA cũng phải hiện "Đang mở phòng..."
   * - người bấm "Vào phòng" lại thấy nút tạo phòng đang quay. Giữ tên hành động
   * thì mỗi nút tự biết có phải mình đang chạy không, mà vẫn chỉ một nguồn sự
   * thật để khoá cả hai.
   */
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * Có phiên đã lưu hay không phải là STATE, không được đọc thẳng localStorage
   * trong lúc render: server render không có localStorage nên luôn ra null, còn
   * client hydrate thì đã thấy phiên - hai cây DOM lệch nhau và React dựng lại
   * cả nhánh. Khởi tạo bằng false đúng bằng thứ server dựng, rồi effect bên
   * dưới mới bật lên sau khi hydrate xong.
   */
  const [hasIdentity, setHasIdentity] = useState(false);
  const busy = pending !== null;

  /*
   * Cùng một cờ bận, giữ ở hai chỗ, vì hai chỗ đó trả lời hai câu khác nhau.
   *
   * `pending` (state) là thứ để VẼ: nút nào đang quay, nút nào đang khoá.
   * `pendingRef` là thứ để CHẶN, và nó phải đúng ngay trong cùng một tick.
   * State của React chỉ đổi ở lần render sau, nên hai lần Enter liên tiếp
   * trong ô mã phòng - ô này không bị disabled - đều đọc ra `busy === false`
   * và mở hai lượt kết nối chồng nhau.
   */
  const pendingRef = useRef<Pending>(null);

  /*
   * Quản lý vòng đời của lượt vào phòng đang chạy.
   *
   * Lười khởi tạo qua ref chứ không `useState`: đây là một object mệnh lệnh,
   * không phải state để vẽ, và nó phải sống đúng bằng đời của component.
   */
  const managerRef = useRef<EntryAttemptManager | null>(null);
  if (managerRef.current === null) managerRef.current = new EntryAttemptManager();
  const attempts = managerRef.current;

  /*
   * Component còn sống hay không. Chỉ dùng để quyết định có được setState.
   *
   * Phải nằm ở đây chứ không nằm trong `EntryAttemptManager`: manager sống
   * trong `useRef` nên nó sống sót qua chu kỳ mount -> cleanup -> mount mà
   * `reactStrictMode` chạy ở dev, còn cờ này thì effect bên dưới bật lại ở đầu
   * MỖI lần mount. Đã thử để cờ trong manager và hỏng đúng kiểu đó: sau lần
   * cleanup đầu của StrictMode, mọi lượt đều chết ngay lúc sinh ra và nút kẹt
   * ở "Đang mở phòng..." mà không một dòng lỗi nào.
   */
  const mountedRef = useRef(true);

  const startPending = useCallback((kind: Exclude<Pending, null>) => {
    pendingRef.current = kind;
    setPending(kind);
  }, []);

  const stopPending = useCallback(() => {
    pendingRef.current = null;
    setPending(null);
  }, []);

  /*
   * Một đường huỷ duy nhất, dùng chung cho đăng xuất và unmount.
   *
   * Gọi bao nhiêu lần cũng được, và không bao giờ đụng vào một lượt mới hơn -
   * `EntryAttemptManager` so số thứ tự lượt trước mỗi thao tác.
   *
   * Chỉ chạm vào state khi component còn sống. Ở nhánh unmount, cờ `mountedRef`
   * đã tắt trước khi gọi vào đây nên `setPending` tự bỏ qua.
   */
  const cancelActiveEntry = useCallback(() => {
    attempts.cancelActive();
    pendingRef.current = null;
    if (mountedRef.current) setPending(null);
  }, [attempts]);

  useEffect(() => {
    const existing = getIdentity();
    if (existing) {
      setNickname(existing.nickname);
      setHasIdentity(true);
    }
  }, []);

  /*
   * Rời trang giữa chừng thì lượt đang chạy phải chết hẳn.
   *
   * Bản trước chỉ gọi `entryCleanup.current` - hàm gỡ listener socket. Nhưng
   * nếu người dùng rời trang trong lúc còn đang `await` POST /api/players thì
   * hàm đó CHƯA TỒN TẠI, và request vẫn về đích rồi lưu danh tính, dựng socket,
   * gắn listener và gọi `router.push` cho một thao tác đã bị bỏ.
   *
   * Tắt cờ `mountedRef` TRƯỚC khi dọn, nên đường dọn dùng chung bên dưới biết
   * là không được chạm vào state nữa.
   */
  useEffect(() => {
    // Bật lại ở đầu mỗi lần mount: StrictMode ở dev chạy effect này hai lần,
    // và lần mount thứ hai phải khởi đầu với cờ đang bật.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelActiveEntry();
    };
  }, [cancelActiveEntry]);

  /*
   * Một đường duy nhất cho cả "tạo phòng" lẫn "vào phòng".
   *
   * Phần thân của luồng nằm ở `runEntryAttempt` trong src/lib, không phải ở
   * đây: bộ test chạy bằng `tsx --test src/lib/*.test.ts` nên chỉ những gì
   * nằm trong src/lib mới có test hồi quy. Component chỉ còn là chỗ nối dây -
   * fetch, localStorage, socket và router - và mọi chốt kiểm tra "lượt còn
   * hợp lệ không" đều do `runEntryAttempt` giữ.
   */
  async function beginEntry(request: RoomEntryRequest) {
    if (pendingRef.current !== null) return;
    setError(null);
    startPending(request.kind);

    const attempt = attempts.begin();
    const ports: EntryPorts = {
      readStoredIdentity: getIdentity,
      storeIdentity: saveIdentity,
      createPlayer,
      openSocket: async (identity) => {
        disconnectSocket();
        const { getSocket } = await import("@/lib/socket");
        return getSocket(identity);
      },
      onIdentityStored: () => setHasIdentity(true),
      onFailed: (message) => {
        setError(message);
        stopPending();
      },
      // Cố ý KHÔNG hạ cờ bận: đang điều hướng, để nút quay tiếp cho tới khi
      // trang phòng thay chỗ. Hạ xuống là nút sáng lại một nhịp và mời người
      // dùng bấm thêm lần nữa.
      onEntered: (code) => router.push(`/room/${code}`),
    };

    await runEntryAttempt(attempt, request, nickname, ports);
  }

  function handleCreate() {
    void beginEntry({ kind: "create" });
  }

  function handleJoin() {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 5) {
      setError("Mã phòng gồm đúng 5 ký tự");
      return;
    }
    void beginEntry({ kind: "join", code });
  }

  function handleLogout() {
    /*
     * Thứ tự ở đây là bản vá, không phải sở thích.
     *
     * Trước: hàm này gọi thẳng `disconnectSocket()`. Socket chết thì
     * `connect_error` không bao giờ được bắn ra, mà đó lại là thứ duy nhất hạ
     * cờ bận xuống - nút kẹt ở "Đang mở phòng..." vĩnh viễn. Phải huỷ lượt
     * TRƯỚC: abort request đang bay, gỡ listener, vô hiệu hoá callback cũ, hạ
     * cờ bận. Ngắt socket là việc cuối.
     */
    cancelActiveEntry();
    disconnectSocket();
    clearIdentity();
    setNickname("");
    // Bắt buộc phải có: nút này từng ẩn đi nhờ setNickname("") làm render lại,
    // nhưng khi ô biệt danh vốn đã rỗng thì React bỏ qua lần set đó và nút vẫn
    // hiện dù phiên đã xoá.
    setHasIdentity(false);
    // Lỗi của lượt vừa bị huỷ không còn nghĩa gì sau khi đã đăng xuất.
    setError(null);
  }

  /*
   * Điều kiện bật của hai nút, viết ra thành chữ.
   *
   * Một nút mờ đi mà không nói vì sao thì người dùng bấm vào nó vài lần rồi bỏ
   * đi. Chỉ nói ra điều kiện CÒN THIẾU chứ không liệt kê cả hai, và im hẳn khi
   * nút đã bấm được.
   */
  const nameReady = nickname.trim().length >= 2;
  const codeReady = joinCode.trim().length === 5;
  const createHint = nameReady ? null : "Nhập biệt danh từ 2 ký tự để tạo phòng.";
  const joinHint = !nameReady
    ? "Nhập biệt danh từ 2 ký tự trước đã."
    : !codeReady
      ? "Mã phòng gồm đúng 5 ký tự."
      : null;

  return (
    <>
      {/*
        * Hai lớp nền chồng nhau chứ không phải một.
        *
        * Backdrop lo bầu trời đêm và vignette - đúng cái nền mà phòng chơi dùng,
        * nên bước từ trang chủ vào phòng không đổi tông màu. VillageScene chồng
        * lên đó trăng, sao, sương và hai dải làng. Cả hai đều `fixed` ở z-index
        * âm: chúng không chiếm một pixel bố cục nào, nên trên điện thoại không
        * có gì phải giấu đi để lấy chỗ cho ô nhập chữ.
        */}
      <Backdrop mood="night" />
      <VillageScene />

      {/*
        * Cột dọc trên điện thoại, hai cột từ lg.
        *
        * Không `justify-center` trên mobile: căn giữa một cột cao hơn màn hình
        * thì đỉnh nó bị đẩy lên trên mép trên và logo biến mất. Bám mép trên,
        * để phần thừa rơi xuống dưới - chỗ đó là làng, không phải nội dung.
        *
        * pt-24 dưới ngưỡng sm là để chừa trời cho mặt trăng. Trên màn 390 tiêu
        * đề chạy gần hết bề ngang và góc trên phải là chỗ duy nhất còn trống
        * cho trăng; pt-9 của bản trước đẩy chữ "ONLINE" đè thẳng lên đĩa trăng.
        * 96px đủ để hai thứ rời nhau mà nút "Tạo phòng mới" vẫn nằm trong màn
        * hình đầu tiên, không phải cuộn.
        *
        * Trên lg, `safe center` chứ không phải `center` trần, và pt-10 thay cho
        * pt-0. Cột phải giờ mang hai thẻ, và trên màn 1366x768 tổng chiều cao
        * của nó chạm sát mép: `justify-content: center` với nội dung cao hơn
        * khung thì tràn ra CẢ HAI đầu, mà đầu trên của một trang thì không cuộn
        * ngược lên được - thương hiệu biến mất không lấy lại được. `safe center`
        * vẫn căn giữa khi còn chỗ và tự bám mép trên khi hết chỗ; trình duyệt
        * không hiểu từ khoá này thì bỏ nguyên khai báo và rơi về flex-start,
        * đúng bằng hành vi ta muốn ở trường hợp chật. pt-10 là để lúc đó chữ
        * không dán thẳng vào mép trên.
        */}
      <main className="relative mx-auto flex min-h-[100svh] w-full flex-col items-center px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-24 sm:px-6 sm:pt-12 lg:justify-center lg:px-8 lg:pt-10 lg:[justify-content:safe_center]">
        {/*
          * lg:row-span-2 trên panel form là thứ khâu hai cột lại với nhau.
          *
          * Panel cao hơn khối thương hiệu, và vì nó trải qua cả hai hàng nên
          * chính nó quyết định chiều cao của lưới. Khối thương hiệu `self-start`
          * bám mép TRÊN panel, dải chip `self-end` bám mép DƯỚI panel: hai cột
          * dùng chung đúng hai đường cơ sở, thay vì mỗi bên trôi một kiểu.
          *
          * Bề rộng khoá bằng min(84vw, 108rem). Trần 1728px là con số đo được
          * chứ không phải chọn bừa: ở 96rem trên màn 2560 cả cụm chỉ chiếm 60%
          * bề ngang và đọc ra một hòn đảo nhỏ giữa màn hình; 108rem đưa nó lên
          * ~68%, còn 84vw giữ cho màn 1280-1440 vẫn có lề tử tế. Phần bù còn
          * lại nằm ở clamp() của cỡ chữ và bề rộng panel, không dồn hết vào
          * việc kéo khung rộng thêm.
          */}
        <div className="flex w-full max-w-[34rem] flex-col gap-8 lg:grid lg:w-[min(84vw,108rem)] lg:max-w-none lg:grid-cols-[minmax(0,1fr)_clamp(25rem,24vw,33rem)] lg:gap-x-[clamp(3rem,6vw,7rem)] lg:gap-y-10">
          <section className="lg:col-start-1 lg:row-start-1 lg:self-start">
            <div className="flex items-center gap-4 sm:gap-5 lg:gap-6">
              <BrandMark className="aspect-square w-[clamp(3.25rem,4.4vw,6.75rem)]" />
              {/* Chuyển sắc bạc -> máu: ánh trăng rơi vào tên game rồi đọng
                * lại thành màu máu ở cuối. Cùng hai nguồn sáng của cả cảnh. */}
              <h1 className="font-display min-w-0 bg-gradient-to-br from-[#f6faff] via-[#a9c3ee] via-[58%] to-[#c81c34] bg-clip-text text-[clamp(2rem,5.6vw,7.25rem)] font-black leading-[0.94] tracking-tight text-transparent">
                MA SÓI ONLINE
              </h1>
            </div>

            <p className="font-display mt-6 max-w-[26ch] text-[clamp(1.25rem,1.75vw,2.45rem)] font-medium leading-[1.3] text-white/90 lg:mt-9 lg:max-w-[25ch]">
              Đêm buông, cổng làng khép lại. Trong số những người ngồi quanh đống lửa, có kẻ không
              phải người.
            </p>

            <p className="mt-4 max-w-[46ch] text-sm leading-relaxed text-mist/75 lg:mt-6 lg:max-w-[42ch] lg:text-[clamp(0.95rem,1.05vw,1.2rem)]">
              Mỗi đêm Sói chọn một người. Mỗi ngày cả làng bỏ phiếu. Ai đọc được kẻ nói dối trước,
              phe đó thắng.
            </p>
          </section>

          {/*
            * Cột phải là MỘT ô lưới chứa hai thẻ, không phải hai ô chồng nhau.
            *
            * Bản trước đặt panel form ở `row-start-1 row-span-2` rồi lại đặt
            * lịch sử ở `row-start-2` cùng cột: hai thứ được xếp đè lên đúng
            * một ô. Gộp vào một ô rồi để flex xếp dọc thì thứ tự đọc, khoảng
            * cách và bề rộng chỉ còn một nguồn sự thật - và cả hai thẻ tự khớp
            * đúng bề ngang của cột.
            *
            * gap-3.5 (14px) là cố ý ngắn: đủ để hai thẻ tách hẳn ra, chưa đủ
            * để lịch sử trôi thành một khối rời rạc dưới chân trang.
            */}
          <div className="flex flex-col gap-3.5 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-start">
            {/* motion-safe: chỉ một lần fade + trượt lên khi vào trang. Tắt
              * chuyển động thì panel hiện thẳng, không mất gì cả. */}
            <section className="motion-safe:animate-riseIn">
              <p className="mb-3.5 flex items-center gap-3 text-[0.68rem] font-bold uppercase tracking-[0.32em] text-mist/80">
                <span
                  aria-hidden="true"
                  className="h-px w-8 bg-gradient-to-r from-transparent to-mist/45"
                />
                Bước vào ngôi làng
              </p>

              <div className="gate-panel p-6 sm:p-7 lg:p-[clamp(1.75rem,2vw,2.5rem)]">
                {/* relative để nội dung nằm TRÊN hai lớp ánh sáng ::before và
                  * ::after của panel - chúng là phần tử định vị nên mặc định vẽ
                  * đè lên chữ trong luồng. */}
                <div className="relative space-y-5">
                  <div>
                    <label
                      htmlFor="nickname"
                      className="gate-label"
                    >
                      Biệt danh của bạn
                    </label>
                    <input
                      id="nickname"
                      className="gate-input"
                      value={nickname}
                      maxLength={20}
                      autoComplete="nickname"
                      placeholder="VD: Thợ săn đêm"
                      onChange={(e) => setNickname(e.target.value)}
                    />
                  </div>

                  <div>
                    <button
                      className="gate-cta"
                      disabled={busy || !nameReady}
                      aria-describedby={createHint ? "create-hint" : undefined}
                      onClick={handleCreate}
                    >
                      {pending === "create" ? (
                        <>
                          <span className="gate-spinner" aria-hidden="true" />
                          Đang mở phòng...
                        </>
                      ) : (
                        "Tạo phòng mới"
                      )}
                    </button>
                    {createHint && (
                      <p id="create-hint" className="mt-2 text-xs text-mist/80">
                        {createHint}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3" aria-hidden="true">
                    <span className="h-px flex-1 bg-white/10" />
                    <span className="text-[0.68rem] uppercase tracking-[0.18em] text-mist/85">
                      hoặc đã có mã phòng
                    </span>
                    <span className="h-px flex-1 bg-white/10" />
                  </div>

                  <div>
                    {/*
                      * Người rót `?code=` vào ô ngay bên dưới. Không vẽ gì cả.
                      *
                      * Đặt ngay cạnh ô nhập chứ không ở đầu trang: nó chỉ tồn tại
                      * vì cái input này, và đọc tới đây là thấy ngay ai chạm vào
                      * `joinCode`.
                      *
                      * `fallback={null}` không phải là bỏ trống cho xong - nó là
                      * bản sao chính xác của một component render null, nên
                      * boundary này không có gì để nhấp nháy lúc hydrate và không
                      * có bản giao diện thứ hai nào phải giữ cho khớp.
                      */}
                    <Suspense fallback={null}>
                      <JoinCodeFromQuery onCode={setJoinCode} />
                    </Suspense>
                    <label
                      htmlFor="join-code"
                      className="gate-label"
                    >
                      Mã phòng
                    </label>
                    <div className="flex gap-2.5">
                      <input
                        id="join-code"
                        className="gate-input uppercase tracking-[0.35em]"
                        value={joinCode}
                        maxLength={5}
                        autoComplete="off"
                        autoCapitalize="characters"
                        placeholder="ABCDE"
                        aria-describedby={joinHint ? "join-hint" : undefined}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                      />
                      <button
                        className="gate-secondary"
                        disabled={busy || !nameReady || !codeReady}
                        aria-describedby={joinHint ? "join-hint" : undefined}
                        onClick={handleJoin}
                      >
                        {pending === "join" ? (
                          <>
                            <span className="gate-spinner" aria-hidden="true" />
                            Đang vào...
                          </>
                        ) : (
                          "Vào phòng"
                        )}
                      </button>
                    </div>
                    {joinHint && (
                      <p id="join-hint" className="mt-2 text-xs text-mist/80">
                        {joinHint}
                      </p>
                    )}
                  </div>

                  {/* Dấu chấm than là bắt buộc, không phải trang trí: một khối
                    * đỏ nhạt là màu, và màu một mình thì người mù màu đọc ra
                    * đúng bằng một dòng chữ bình thường. */}
                  {error && (
                    <p
                      role="alert"
                      className="flex items-start gap-2.5 rounded-xl border border-blood-500/40 bg-blood-600/15 px-3.5 py-2.5 text-sm text-blood-400"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-blood-500 text-[0.6rem] font-black leading-none text-white"
                      >
                        !
                      </span>
                      <span>{error}</span>
                    </p>
                  )}

                  <p className="border-t border-white/[0.07] pt-4 text-xs leading-relaxed text-mist/75">
                    Tối thiểu 8 người mỗi ván - thiếu thì thêm bot ngay trong phòng chờ.
                  </p>

                  {/* Nhạt hơn hẳn CTA và không có nền: đây là việc người ta làm
                    * một lần trong đời chứ không phải hành động chính. */}
                  {hasIdentity && (
                    <button
                      className="w-full rounded-lg py-1 text-center text-xs text-mist/75 underline-offset-4 transition hover:text-white hover:underline"
                      onClick={handleLogout}
                    >
                      Xoá phiên đăng nhập trên thiết bị này
                    </button>
                  )}
                </div>
              </div>
            </section>

            {/*
              * Lịch sử ván: thẻ riêng, ngay dưới thẻ vào phòng.
              *
              * Tách hẳn ra `.card` chứ không nối thêm vào `.gate-panel`: nền,
              * bo góc và luồng sáng của hai lớp này khác nhau rõ, nên không ai
              * đọc nhầm danh sách ván là phần tiếp theo của ô nhập mã phòng.
              *
              * Tự ẩn hoàn toàn khi chưa đăng nhập hoặc chưa có ván nào, nên
              * người mới vào không thấy một khung rỗng nói rằng họ chưa làm gì -
              * và `gap` của flex cũng không chừa chỗ cho một thẻ không tồn tại.
              */}
            <MatchHistoryPanel />
          </div>

          {/*
            * Ba mục giới thiệu, gom thành chip.
            *
            * Nằm SAU panel trong DOM vì thứ tự đọc đúng là thương hiệu -> form
            * -> thông tin phụ; trên desktop grid mới đặt nó về lại cột trái.
            * Bản cũ trải chúng thành ba cột chữ nhỏ vắt ngang chân trang, đúng
            * hình dạng của một cái footer.
            */}
          <ul className="flex flex-wrap gap-2.5 lg:col-start-1 lg:row-start-2 lg:gap-3 lg:self-end">
            {[
              [`${MIN_PLAYERS_TO_START} - ${MAX_PLAYERS_PER_ROOM} người`, "#9db2d5"],
              ["Chơi được với bot", "#e0a35c"],
              ["Chat riêng theo phe", "#f04760"],
            ].map(([label, dot]) => (
              <li key={label} className="gate-chip">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: dot, boxShadow: `0 0 8px 1px ${dot}80` }}
                />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </main>
      <AssetCredits />
    </>
  );
}
