"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_TO_START } from "@masoi/shared";
import { EntryAttemptManager } from "@/lib/entry-attempt";
import { runEntryAttempt, type CreatePlayerOutcome, type EntryPorts } from "@/lib/home-entry";
import { getIdentity, saveIdentity, clearIdentity } from "@/lib/identity";
import { hasCompletedGuide } from "@/lib/guide-session";
import type { RoomEntryRequest } from "@/lib/room-entry";
import { disconnectSocket } from "@/lib/socket";
import { GIVE_UP_MESSAGE, WakeWatch, prewakeServer, wakeStatusText } from "@/lib/server-wake";
import type { Identity } from "@/lib/identity";
import { Backdrop } from "@/components/Backdrop";
import { BrandMark } from "@/components/HomeHero";
import { JoinCodeFromQuery } from "@/components/JoinCodeFromQuery";
import { MatchHistoryPanel } from "@/components/MatchHistoryPanel";
import { PlayerStatsCard } from "@/components/PlayerStatsCard";
import { LeaderboardPanel } from "@/components/LeaderboardPanel";
import { AssetCredits } from "@/components/AssetCredits";
import { InstallPrompt } from "@/components/InstallPrompt";
import "./home-cinematic.css";

/** Hành động đang chạy, hoặc null khi rảnh. */
/**
 * `guide` là "tạo phòng" cộng một cờ: cùng POST, cùng socket, cùng đường vào -
 * chỉ khác đích điều hướng (`?guide=1`) để trang phòng bật thẻ hướng dẫn và tự
 * gọi bot. Tách thành một `Pending` riêng để nút nào bấm thì nút đó quay.
 */
type Pending = "create" | "join" | "guide" | null;

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

/**
 * POST /api/players, có thể huỷ giữa chừng.
 *
 * `signal` là bắt buộc chứ không phải tuỳ chọn: người dùng bấm "Xoá phiên" hay
 * rời trang giữa lúc request đang bay thì nó phải chết theo, chứ không được về
 * muộn rồi ghi một phiên mới vào máy họ.
 */
async function createPlayer(nickname: string, signal: AbortSignal): Promise<CreatePlayerOutcome> {
  const res = await fetch(`${SERVER_URL}/api/players`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
    signal,
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, message: data.error ?? "Có lỗi xảy ra" };
  return { ok: true, identity: data as Identity };
}

/**
 * Ba dấu hiệu của dải giới thiệu trên trang chủ.
 *
 * Trước đây là ba ký tự hình học rời: ◎ ◈ ♧. Chúng không phải emoji, nhưng mắc
 * đúng một bệnh với emoji - chúng là KÝ TỰ, nên hình dáng do font của máy người
 * đọc quyết định. ♧ (U+2667) đặc biệt hay thiếu: font hệ thống nào không có nó
 * thì trình duyệt đi mượn một font khác, và ba dấu hiệu đứng cạnh nhau bỗng lệch
 * hẳn nét và trọng lượng; máy nào không mượn được thì ra ô vuông trống.
 *
 * Ba hình dưới đây còn nói đúng nội dung của ba ô thay vì chỉ là hoa văn: một
 * bàn chơi có người ngồi quanh, một chiếc mặt nạ, hai bóng người. Cùng lưới 24 /
 * stroke 2 với `MessageCircleIcon` của `ChatBox`, nên cả web dùng chung một bộ
 * nét mà không thêm dependency nào.
 *
 * Vẫn `aria-hidden`: mỗi ô đã có sẵn tiêu đề và câu mô tả bằng chữ ngay cạnh,
 * nên đọc thêm tên hình chỉ làm trình đọc màn hình dài dòng.
 */
function HomeFeatureIcon({ name }: { name: "table" | "mask" | "company" }) {
  return (
    <span className="home-feature-icon" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {name === "table" && (
          // Bàn tròn và bốn chỗ ngồi quanh nó.
          <>
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
          </>
        )}
        {name === "mask" && (
          // Mặt nạ sân khấu: vòm trên và hai khe mắt.
          <>
            <path d="M4 5h16v7a8 8 0 0 1-16 0V5Z" />
            <path d="M8.5 10h2M13.5 10h2" />
          </>
        )}
        {name === "company" && (
          // Hai bóng người, một đứng trước một đứng sau.
          <>
            <circle cx="9" cy="8" r="3.5" />
            <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
            <path d="M16 5.2a3.5 3.5 0 0 1 0 5.6M17.5 14.4a6.5 6.5 0 0 1 4 5.6" />
          </>
        )}
      </svg>
    </span>
  );
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
   * Mốc bắt đầu chờ máy chủ thức dậy, hoặc null khi không có gì đáng nói.
   *
   * Không phải lỗi: máy chủ miễn phí ngủ khi vắng người và lần gọi đầu treo
   * cả phút là chuyện bình thường. Nói ra điều đó thay vì để nút quay trong
   * im lặng, vì im lặng là thứ khiến người ta bấm lại rồi bỏ đi.
   */
  const [wakingSince, setWakingSince] = useState<number | null>(null);
  const [wakingElapsed, setWakingElapsed] = useState(0);
  /*
   * Có phiên đã lưu hay không phải là STATE, không được đọc thẳng localStorage
   * trong lúc render: server render không có localStorage nên luôn ra null, còn
   * client hydrate thì đã thấy phiên - hai cây DOM lệch nhau và React dựng lại
   * cả nhánh. Khởi tạo bằng false đúng bằng thứ server dựng, rồi effect bên
   * dưới mới bật lên sau khi hydrate xong.
   */
  const [hasIdentity, setHasIdentity] = useState(false);
  /*
   * Đã đi hết một ván hướng dẫn chưa - cũng đọc SAU khi hydrate, cùng lý do
   * với `hasIdentity`. Chỉ đổi LỜI MỜI: nút vẫn ở đó cho người muốn xem lại.
   */
  const [guideDone, setGuideDone] = useState(false);
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

  /** Đồng hồ của lượt đang chạy; mỗi lượt một cái, lượt sau dừng lượt trước. */
  const wakeWatchRef = useRef<WakeWatch | null>(null);

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
    wakeWatchRef.current?.stop();
    pendingRef.current = null;
    if (mountedRef.current) {
      setPending(null);
      setWakingSince(null);
    }
  }, [attempts]);

  /*
   * Đánh thức máy chủ ngay khi trang mở, trong lúc người chơi còn gõ tên.
   * Chạy một lần; kết quả không quan trọng - xem `prewakeServer`.
   */
  useEffect(() => {
    void prewakeServer(SERVER_URL);
  }, []);

  /* Đồng hồ giây cho dòng "đã chờ N giây". Chỉ chạy khi đang chờ. */
  useEffect(() => {
    if (wakingSince === null) return;
    setWakingElapsed(0);
    const id = setInterval(() => {
      setWakingElapsed(Math.floor((Date.now() - wakingSince) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [wakingSince]);

  useEffect(() => {
    const existing = getIdentity();
    if (existing) {
      setNickname(existing.nickname);
      setHasIdentity(true);
    }
    setGuideDone(hasCompletedGuide());
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
  async function beginEntry(request: RoomEntryRequest, as: Exclude<Pending, null> = request.kind) {
    if (pendingRef.current !== null) return;
    setError(null);
    startPending(as);

    const attempt = attempts.begin();
    /*
     * Mọi callback của đồng hồ đều hỏi `attempt.isActive()` trước, cùng lý do
     * với mọi callback khác trong lượt: người dùng có thể đã huỷ.
     */
    const watch = new WakeWatch({
      onSlow: () => {
        if (attempt.isActive() && mountedRef.current) setWakingSince(Date.now());
      },
      onGiveUp: () => {
        if (!attempt.isActive()) return;
        cancelActiveEntry();
        if (mountedRef.current) setError(GIVE_UP_MESSAGE);
      },
    });
    wakeWatchRef.current?.stop();
    wakeWatchRef.current = watch;
    watch.start();

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
        watch.stop();
        setWakingSince(null);
        setError(message);
        stopPending();
      },
      // Cố ý KHÔNG hạ cờ bận: đang điều hướng, để nút quay tiếp cho tới khi
      // trang phòng thay chỗ. Hạ xuống là nút sáng lại một nhịp và mời người
      // dùng bấm thêm lần nữa.
      onEntered: (code) => {
        watch.stop();
        setWakingSince(null);
        router.push(pendingRef.current === "guide" ? `/room/${code}?guide=1` : `/room/${code}`);
      },
    };

    await runEntryAttempt(attempt, request, nickname, ports);
  }

  function handleCreate() {
    void beginEntry({ kind: "create" });
  }

  /**
   * Ván đầu có hướng dẫn: đúng luồng tạo phòng, thêm cờ `?guide=1`.
   *
   * `beginEntry` từ chối khi đang có lượt khác chạy, và `onEntered` không hạ cờ
   * bận cho tới khi trang phòng thay chỗ - nên bấm liên tiếp không tạo hai tài
   * khoản hay hai phòng, cùng lớp bảo vệ với "Tạo phòng mới".
   */
  function handleGuide() {
    void beginEntry({ kind: "create" }, "guide");
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
      <Backdrop mood="night" />
      <div className="home-page">
        <div className="home-cinema-art" aria-hidden="true" />
        <header className="home-header">
          <a href="#" className="home-brand" aria-label="Ma Sói Online — Trang chủ">
            <BrandMark className="h-10 w-10" />
            <span>MA SÓI <span className="home-brand-online">ONLINE</span></span>
          </a>
          <nav aria-label="Điều hướng trang chủ">
            <a href="#cach-choi">Cách chơi</a>
            <a href="#nhat-ky" className="home-journal-link">Thành tích</a>
            <a className="home-nav-play" href="#vao-lang">Chơi ngay <span aria-hidden="true">↗</span></a>
          </nav>
        </header>

        <main className="home-main">
          <div className="home-hero">
            <section className="home-intro" aria-labelledby="home-title">
              <p className="home-eyebrow"><span className="home-status-dot" /> KHI ĐÊM XUỐNG, ĐỪNG TIN AI.</p>
              <h1 id="home-title" aria-label="MA SÓI ONLINE"><span>MA</span><span>SÓI<span className="home-title-period">.</span></span></h1>
              <p className="home-online">O N L I N E</p>
              <p className="home-story">Giữa những người bạn.<br />Có một kẻ săn mồi.</p>
              <p className="home-description">Ẩn giấu thân phận. Đọc vị lời nói dối.<br />Sống sót qua đêm — hoặc làm chủ bóng tối.</p>
              <a className="home-discover" href="#cach-choi"><span aria-hidden="true">↓</span> Khám phá cách chơi</a>
            </section>
            <section id="vao-lang" className="home-entry" aria-labelledby="entry-heading">
              <div className="gate-panel home-gate">
                <div className="relative space-y-5">
                  <div className="home-gate-heading">
                    <span className="home-eyebrow">BẠN ĐÃ SẴN SÀNG?</span>
                    <h2 id="entry-heading">Đêm nay, bạn là ai?</h2>
                    <p>Nhập biệt danh và bước vào cuộc chơi.</p>
                  </div>
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
                        <>Tạo phòng mới <span aria-hidden="true">↗</span></>
                      )}
                    </button>
                    {createHint && (
                      <p id="create-hint" className="mt-2 text-xs text-mist/85">
                        {createHint}
                      </p>
                    )}
                    <button
                      type="button"
                      className="gate-guide mt-2.5 w-full"
                      disabled={busy || !nameReady}
                      aria-describedby="guide-hint"
                      onClick={handleGuide}
                    >
                      {pending === "guide" ? (
                        <>
                          <span className="gate-spinner" aria-hidden="true" />
                          Đang mở ván hướng dẫn...
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">▷</span> {guideDone ? "Xem lại ván hướng dẫn" : "Chơi thử có hướng dẫn"}
                        </>
                      )}
                    </button>
                    <p id="guide-hint" className="mt-1.5 text-xs text-mist/85">
                      {guideDone
                        ? "Bạn đã đi hết một ván hướng dẫn. Vẫn mở lại được nếu muốn ôn - ván thật thì dùng “Tạo phòng mới”."
                        : "Lần đầu chơi? Thử một ván với 7 bot và hướng dẫn từng bước."}
                    </p>
                  </div>
                  <div className="flex items-center gap-3" aria-hidden="true">
                    <span className="h-px flex-1 bg-white/10" />
                    <span className="text-[0.68rem] uppercase tracking-[0.18em] text-mist/85">
                      THAM GIA CÙNG BẠN BÈ
                    </span>
                    <span className="h-px flex-1 bg-white/10" />
                  </div>
                  <div>
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
                      <p id="join-hint" className="mt-2 text-xs text-mist/85">
                        {joinHint}
                      </p>
                    )}
                  </div>
                  {wakingSince !== null && busy && (
                    <p
                      role="status"
                      className="flex items-start gap-2.5 rounded-xl border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-sm text-mist"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-mist/40 border-t-white"
                      />
                      <span>{wakeStatusText(wakingElapsed)}</span>
                    </p>
                  )}
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
                  <p className="border-t border-white/[0.07] pt-4 text-xs leading-relaxed text-mist/85">
                    Tối thiểu 8 người mỗi ván - thiếu thì thêm bot ngay trong phòng chờ.
                  </p>
                  {hasIdentity && (
                    <button
                      className="w-full rounded-lg py-1 text-center text-xs text-mist/85 underline-offset-4 transition hover:text-white hover:underline"
                      onClick={handleLogout}
                    >
                      Xoá phiên đăng nhập trên thiết bị này
                    </button>
                  )}
                </div>
              </div>
            </section>
          </div>

          <div className="home-feature-strip" aria-label="Thông tin trò chơi">
            <div><HomeFeatureIcon name="table" /><p><strong>{MIN_PLAYERS_TO_START}–{MAX_PLAYERS_PER_ROOM} người chơi</strong><span>Một bàn chơi. Vô vàn nghi ngờ.</span></p></div>
            <div><HomeFeatureIcon name="mask" /><p><strong>Mỗi vai, một bí mật</strong><span>Phe Dân Làng, Ma Sói và Trung Lập.</span></p></div>
            <div><HomeFeatureIcon name="company" /><p><strong>Luôn có người cùng chơi</strong><span>Rủ bạn bè hoặc đấu trí cùng bot.</span></p></div>
          </div>
          <section id="nhat-ky" className="home-journal" aria-labelledby="journal-heading">
            <div className="home-section-heading"><div><p className="home-eyebrow">SAU NHỮNG ĐÊM DÀI</p><h2 id="journal-heading">Dấu ấn trong làng</h2></div></div>
            <div className="home-dashboard">
              <div className="home-personal"><PlayerStatsCard /><MatchHistoryPanel /></div>
              <div className="home-community"><LeaderboardPanel /></div>
            </div>
          </section>

          <section id="cach-choi" className="home-howto" aria-labelledby="howto-heading">
            <div className="home-section-heading"><div><p className="home-eyebrow">LUẬT CHƠI</p><h2 id="howto-heading">Dễ chơi. Khó tin nhau.</h2></div></div>
            <ol className="home-steps">
              <li><span className="home-step-number">01 /</span><div><h3>Nhận vai, giữ bí mật</h3><p>Bạn là Dân Làng, Ma Sói hay một vai đặc biệt? Chỉ bạn biết sự thật.</p></div></li>
              <li><span className="home-step-number">02 /</span><div><h3>Đêm hành động, ngày suy luận</h3><p>Dùng năng lực trong đêm. Khi trời sáng, cùng cả làng tìm ra kẻ nói dối.</p></div></li>
              <li><span className="home-step-number">03 /</span><div><h3>Bỏ phiếu, định số phận</h3><p>Thuyết phục mọi người, chọn người bị treo và đưa phe mình đến chiến thắng.</p></div></li>
            </ol>
          </section>
          <div className="home-install"><InstallPrompt /></div>
        </main>
        <div className="home-footer"><span>MA SÓI ONLINE</span><p>Đừng tin tất cả những gì bạn nghe khi đêm xuống.</p><a href="#vao-lang">Hẹn gặp trong làng <span aria-hidden="true">↗</span></a></div>
        <AssetCredits />
      </div>
    </>
  );
}
