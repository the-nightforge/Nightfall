"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getIdentity, saveIdentity, clearIdentity } from "@/lib/identity";
import { disconnectSocket } from "@/lib/socket";
import type { Identity } from "@/lib/identity";

function HomeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState(params.get("code") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const existing = getIdentity();
    if (existing) setNickname(existing.nickname);
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
      socket.once("connect", () => {
        socket.emit("room:create", {});
        socket.once("room:snapshot", (snap) => {
          router.push(`/room/${snap.code}`);
        });
        socket.once("error", (e) => {
          setError(e.message);
          setBusy(false);
        });
      });
      if (socket.connected) socket.emit("room:create", {});
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
      socket.once("error", function onErr(e) {
        socket.off("error", onErr);
        setError(e.message);
        setBusy(false);
      });
      socket.once("room:snapshot", () => router.push(`/room/${code}`));
      socket.on("connect", () => socket.emit("room:join", { code }));
      if (socket.connected) socket.emit("room:join", { code });
    } catch {
      setError("Không kết nối được server");
      setBusy(false);
    }
  }

  function handleLogout() {
    clearIdentity();
    disconnectSocket();
    setNickname("");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <header className="text-center">
        <div className="text-6xl">🐺</div>
        <h1 className="mt-3 bg-gradient-to-r from-blood-400 via-white to-indigo-300 bg-clip-text text-4xl font-extrabold text-transparent">
          MA SÓI ONLINE
        </h1>
        <p className="mt-2 text-sm text-mist/70">
          Ngôi làng huyền bí - ai là Ma Sói? Tạo phòng và mời bạn bè cùng chơi.
        </p>
      </header>

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

        <button className="btn-primary w-full" disabled={busy || nickname.trim().length < 2} onClick={handleCreate}>
          Tạo phòng mới
        </button>

        <div className="flex items-center gap-2">
          <span className="h-px flex-1 bg-night-600" />
          <span className="text-xs text-mist/50">hoặc tham gia bằng mã</span>
          <span className="h-px flex-1 bg-night-600" />
        </div>

        <div className="flex gap-2">
          <input
            className="input uppercase tracking-widest"
            value={joinCode}
            maxLength={5}
            placeholder="ABCDE"
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
          />
          <button
            className="btn-secondary shrink-0"
            disabled={busy || nickname.trim().length < 2 || joinCode.length !== 5}
            onClick={handleJoin}
          >
            Vào phòng
          </button>
        </div>

        {error && (
          <p className="rounded-lg bg-blood-600/20 px-3 py-2 text-sm text-blood-400">{error}</p>
        )}
        {getIdentity() && (
          <button className="w-full text-center text-xs text-mist/40 hover:text-mist" onClick={handleLogout}>
            Xoá phiên đăng nhập trên thiết bị này
          </button>
        )}
      </section>

      <footer className="text-center text-xs text-mist/40">
        MVP phiên bản chat - tối thiểu 6 người mỗi ván. Chơi thử một mình? Tạo phòng rồi bấm &quot;Thêm bot&quot;.
      </footer>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeInner />
    </Suspense>
  );
}
