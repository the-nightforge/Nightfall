"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getIdentity, saveIdentity, clearIdentity } from "@/lib/identity";
import { runWhenSocketConnected } from "@/lib/room-socket-session";
import { disconnectSocket } from "@/lib/socket";
import type { Identity } from "@/lib/identity";
import { Backdrop } from "@/components/Backdrop";
import { BrandMark, HomeHero } from "@/components/HomeHero";

function HomeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState(params.get("code") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Có phiên đã lưu hay không phải là STATE, không được đọc thẳng localStorage
   * trong lúc render: server render không có localStorage nên luôn ra null, còn
   * client hydrate thì đã thấy phiên - hai cây DOM lệch nhau và React dựng lại
   * cả nhánh. Khởi tạo bằng false đúng bằng thứ server dựng, rồi effect bên
   * dưới mới bật lên sau khi hydrate xong.
   */
  const [hasIdentity, setHasIdentity] = useState(false);

  useEffect(() => {
    const existing = getIdentity();
    if (existing) {
      setNickname(existing.nickname);
      setHasIdentity(true);
    }
  }, []);

  async function ensurePlayer(): Promise<Identity | null> {
    const existing = getIdentity();
    // Đã có session và không đổi tên -> dùng lại để giữ khả năng reconnect
    if (existing && existing.nickname === nickname.trim()) return existing;
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000"}/api/players`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: nickname.trim() }),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Có lỗi xảy ra");
      return null;
    }
    const identity: Identity = data;
    saveIdentity(identity);
    setHasIdentity(true);
    return identity;
  }

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      const identity = await ensurePlayer();
      if (!identity) return;
      disconnectSocket();
      const { getSocket } = await import("@/lib/socket");
      const socket = getSocket(identity);
      const onError = (e: { message: string }) => {
        socket.off("room:snapshot", onSnapshot);
        setError(e.message);
        setBusy(false);
      };
      const onSnapshot = (snap: { code: string }) => {
        socket.off("error", onError);
        router.push(`/room/${snap.code}`);
      };
      socket.once("room:snapshot", onSnapshot);
      socket.once("error", onError);
      runWhenSocketConnected(socket, () => socket.emit("room:create", {}));
    } catch {
      setError("Không kết nối được server");
      setBusy(false);
    }
  }

  async function handleJoin() {
    setError(null);
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 5) {
      setError("Mã phòng gồm đúng 5 ký tự");
      return;
    }
    setBusy(true);
    try {
      const identity = await ensurePlayer();
      if (!identity) return;
      disconnectSocket();
      const { getSocket } = await import("@/lib/socket");
      const socket = getSocket(identity);
      const onError = (e: { message: string }) => {
        socket.off("room:snapshot", onSnapshot);
        setError(e.message);
        setBusy(false);
      };
      const onSnapshot = () => {
        socket.off("error", onError);
        router.push(`/room/${code}`);
      };
      socket.once("error", onError);
      socket.once("room:snapshot", onSnapshot);
      runWhenSocketConnected(socket, () => socket.emit("room:join", { code }));
    } catch {
      setError("Không kết nối được server");
      setBusy(false);
    }
  }

  function handleLogout() {
    clearIdentity();
    disconnectSocket();
    setNickname("");
    // Bắt buộc phải có: nút này từng ẩn đi nhờ setNickname("") làm render lại,
    // nhưng khi ô biệt danh vốn đã rỗng thì React bỏ qua lần set đó và nút vẫn
    // hiện dù phiên đã xoá.
    setHasIdentity(false);
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
      <Backdrop mood="dusk" />
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10 lg:max-w-5xl lg:grid lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-center lg:gap-14">
        {/*
          * Nửa trái chỉ là nhận diện, và trên desktop nó gánh luôn khoảng trống
          * mà bản cũ để không hai bên form. Trên điện thoại phần khung cảnh và
          * ba dòng giới thiệu bị cắt: ở đó chỗ trên màn hình thuộc về ô biệt
          * danh và ô mã phòng, không thuộc về trang trí.
          */}
        <section className="lg:self-center">
          <header className="flex items-center gap-4 lg:block">
            <BrandMark className="h-16 w-16 shrink-0 lg:h-20 lg:w-20" />
            <div className="min-w-0 lg:mt-5">
              <h1 className="font-display bg-gradient-to-r from-blood-400 via-white to-indigo-300 bg-clip-text text-3xl font-extrabold leading-tight text-transparent sm:text-4xl lg:text-6xl">
                MA SÓI ONLINE
              </h1>
              <p className="mt-1 text-sm text-mist/75 lg:mt-3 lg:text-base">
                Ngôi làng huyền bí - ai là Ma Sói? Tạo phòng và mời bạn bè cùng chơi.
              </p>
            </div>
          </header>

          <HomeHero className="mt-8 hidden lg:block" />

          <ul className="mt-6 hidden gap-4 text-sm text-mist/75 lg:grid lg:grid-cols-3">
            <li>
              <b className="block text-white">6 - 15 người</b>
              Một mã phòng năm ký tự là đủ để cả nhóm vào.
            </li>
            <li>
              <b className="block text-white">Chơi thử một mình</b>
              Thêm bot cho đủ bàn, luật chạy y như ván thật.
            </li>
            <li>
              <b className="block text-white">Chat theo pha</b>
              Làng, phe Sói và người chết mỗi bên một kênh riêng.
            </li>
          </ul>
        </section>

        <section className="card space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-mist">Biệt danh của bạn</span>
            <input
              className="input mt-1"
              value={nickname}
              maxLength={20}
              placeholder="VD: Thợ săn đêm"
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>

          <div>
            <button
              className="btn-primary w-full"
              disabled={busy || !nameReady}
              onClick={handleCreate}
            >
              Tạo phòng mới
            </button>
            {createHint && <p className="mt-1.5 text-xs text-mist/70">{createHint}</p>}
          </div>

          <div className="flex items-center gap-2">
            <span className="h-px flex-1 bg-night-600" />
            <span className="text-xs text-mist/65">hoặc tham gia bằng mã</span>
            <span className="h-px flex-1 bg-night-600" />
          </div>

          <div>
            <div className="flex gap-2">
              <input
                className="input uppercase tracking-widest"
                value={joinCode}
                maxLength={5}
                placeholder="ABCDE"
                aria-label="Mã phòng"
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              />
              <button
                className="btn-secondary shrink-0"
                disabled={busy || !nameReady || !codeReady}
                onClick={handleJoin}
              >
                Vào phòng
              </button>
            </div>
            {joinHint && <p className="mt-1.5 text-xs text-mist/70">{joinHint}</p>}
          </div>

          {error && (
            <p className="rounded-lg bg-blood-600/20 px-3 py-2 text-sm text-blood-400">{error}</p>
          )}
          {hasIdentity && (
            <button
              className="w-full text-center text-xs text-mist/60 hover:text-mist"
              onClick={handleLogout}
            >
              Xoá phiên đăng nhập trên thiết bị này
            </button>
          )}

          <p className="border-t border-white/[0.06] pt-3 text-center text-xs text-mist/60">
            MVP phiên bản chat - tối thiểu 6 người mỗi ván. Chơi thử một mình? Tạo phòng rồi bấm
            &quot;Thêm bot&quot;.
          </p>
        </section>
      </main>
    </>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeInner />
    </Suspense>
  );
}
