"use client";

import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import type { RoomSnapshot } from "@masoi/shared";
import { getIdentity } from "@/lib/identity";
import { useRoomSocket } from "@/lib/useRoomSocket";
import { PhaseBanner } from "@/components/PhaseBanner";
import { PlayerGrid } from "@/components/PlayerGrid";
import { ChatBox } from "@/components/ChatBox";
import { RoleRevealView } from "@/components/RoleViews";
import { NightPanel } from "@/components/NightPanel";
import { DayView, EliminationView, GameOverView } from "@/components/DayViews";
import { Lobby } from "@/components/Lobby";

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = (params.code ?? "").toUpperCase();
  const room = useRoomSocket();
  const snapshot = room.snapshot;

  // Chưa đăng nhập -> về trang chủ kèm mã phòng
  useEffect(() => {
    if (room.identityMissing) router.replace(`/?code=${code}`);
  }, [room.identityMissing, code, router]);

  const isHost = !!snapshot && snapshot.hostId === getIdentity()?.playerId;

  const content = useMemo(() => {
    if (!snapshot) {
      return (
        <div className="card animate-pulseSlow text-center text-mist/60">
          Đang kết nối vào phòng <b className="text-white">{code}</b>...
        </div>
      );
    }
    switch (snapshot.phase) {
      case "LOBBY":
        return (
          <Lobby
            snapshot={snapshot}
            identity={getIdentity()!}
            onReady={(ready) => room.emit("room:set-ready", { ready })}
            onStart={() => room.emit("room:start")}
            onKick={(targetId) => room.emit("room:kick", { targetId })}
            onAddBot={() => room.emit("room:add-bot")}
            onUpdateConfig={(config) => room.emit("room:update-config", { config })}
            onLeave={leaveRoom}
          />
        );
      case "ROLE_REVEAL":
        return <RoleRevealView snapshot={snapshot} />;
      case "NIGHT":
        return <NightPanel snapshot={snapshot} onAction={(type, targetId) => room.emit("game:action", { type, targetId: targetId ?? null })} />;
      case "NIGHT_RESULT":
      case "DAY_DISCUSSION":
      case "VOTING":
        return <DayView snapshot={snapshot} onVote={(targetId) => room.emit("game:vote", { targetId })} />;
      case "ELIMINATION":
      case "CHECK_WIN":
        return <EliminationView snapshot={snapshot} />;
      case "GAME_OVER":
        return (
          <GameOverView
            snapshot={snapshot}
            isHost={isHost}
            onReset={() => room.emit("room:reset")}
            onLeave={leaveRoom}
          />
        );
      default:
        return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, isHost, room.messages]);

  function leaveRoom() {
    room.emit("room:leave");
    router.push("/");
  }

  const chatPlaceholder = chatChannelHint(snapshot);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-3 px-3 py-4">
      <header className="flex items-center justify-between">
        <button className="text-sm text-mist/60 hover:text-white" onClick={leaveRoom}>
          ← Rời phòng
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-mist/50">Mã phòng:</span>
          <button
            className="rounded-lg border border-night-600 bg-night-800 px-3 py-1 font-mono text-sm font-bold tracking-widest text-white"
            onClick={() => navigator.clipboard?.writeText(code)}
            title="Bấm để sao chép"
          >
            {code}
          </button>
          {!room.connected && (
            <span className="rounded bg-blood-600/30 px-2 py-0.5 text-xs text-blood-400">Mất kết nối...</span>
          )}
        </div>
      </header>

      {snapshot && <PhaseBanner snapshot={snapshot} />}
      {snapshot?.phase === "LOBBY" && (
        <p className="text-center text-xs text-mist/50">
          Gửi mã phòng cho bạn bè để họ tham gia cùng bạn.
        </p>
      )}

      {content}

      {/* Chat hiển thị mọi lúc; server tự quyết định kênh & quyền xem */}
      <ChatBox messages={room.messages} onSend={(text) => room.emit("chat:send", { text })} placeholder={chatPlaceholder} />

      {room.error && (
        <p className="rounded-lg bg-blood-600/20 px-3 py-2 text-center text-sm text-blood-400">{room.error}</p>
      )}

      {snapshot && snapshot.phase !== "LOBBY" && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-mist/70">Người chơi</h3>
          <PlayerGrid snapshot={snapshot} />
        </section>
      )}
    </main>
  );
}

function chatChannelHint(snapshot: RoomSnapshot | null): string {
  if (!snapshot) return "Nhập tin nhắn...";
  if (snapshot.phase === "LOBBY" || snapshot.phase === "GAME_OVER") return "Chat phòng...";
  if (!snapshot.you?.alive) return "Chat cùng những người đã chết...";
  if (snapshot.phase === "NIGHT") return snapshot.you.role === "WEREWOLF" ? "Chat phe Sói..." : "Ban đêm bạn không thể chat...";
  return "Chat làng...";
}
