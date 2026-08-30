"use client";

import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, m } from "motion/react";
import type { RoomSnapshot } from "@masoi/shared";
import { getIdentity } from "@/lib/identity";
import { useRoomSocket } from "@/lib/useRoomSocket";
import { VoiceControl } from "@/components/VoiceControl";
import { VoiceProvider } from "@/components/VoiceProvider";
import { useGameAudio } from "@/lib/useGameAudio";
import { moodFor } from "@/lib/mood";
import { Backdrop } from "@/components/Backdrop";
import { PhaseBanner } from "@/components/PhaseBanner";
import { RosterPanel } from "@/components/RosterPanel";
import { ChatBox } from "@/components/ChatBox";
import { RightMetaPanel } from "@/components/RightMetaPanel";
import { RoleRevealView } from "@/components/RoleViews";
import { NightPanel } from "@/components/NightPanel";
import { DayView, EliminationView } from "@/components/DayViews";
import { GameOverView } from "@/components/GameOverView";
import { HunterShotPanel } from "@/components/HunterShotPanel";
import { TrialPanel } from "@/components/TrialPanel";
import { Lobby } from "@/components/Lobby";
import { SoundControl } from "@/components/SoundControl";
import { EventBanner } from "@/components/EventBanner";

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = (params.code ?? "").toUpperCase();
  const room = useRoomSocket(code);
  const snapshot = room.snapshot;
  useGameAudio(snapshot);

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
            onAddBot={() => room.emit("room:add-bot")}
            onUpdateConfig={(config) => room.emit("room:update-config", { config })}
            onLeave={leaveRoom}
          />
        );
      case "ROLE_REVEAL":
        return <RoleRevealView snapshot={snapshot} />;
      case "NIGHT":
        return (
          <NightPanel
            snapshot={snapshot}
            onAction={(type, targetId, secondaryTargetId) =>
              room.emit("game:action", {
                type,
                targetId: targetId ?? null,
                targetId2: secondaryTargetId ?? null,
              })
            }
          />
        );
      case "NIGHT_RESULT":
      case "DAY_DISCUSSION":
      case "VOTING":
        return (
          <DayView
            snapshot={snapshot}
            onVote={(targetId: string | null) => room.emit("game:vote", { targetId })}
            onSkipDiscussion={(skip) => room.emit("game:skip-discussion", { skip })}
            onDayOfTruthClaim={(role) => room.emit("game:day-of-truth-claim", { role })}
          />
        );
      case "DEFENSE":
      case "FINAL_VOTE":
        return (
          <TrialPanel
            snapshot={snapshot}
            onFinalVote={(guilty) => room.emit("game:final-vote", { guilty })}
          />
        );
      case "ELIMINATION":
      case "CHECK_WIN":
        return <EliminationView snapshot={snapshot} />;
      case "HUNTER_SHOT":
        return (
          <HunterShotPanel
            snapshot={snapshot}
            onShoot={(targetId) => room.emit("game:hunter-shot", { targetId })}
          />
        );
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
  }, [snapshot, isHost]);

  function leaveRoom() {
    room.emit("room:leave");
    router.push("/");
  }

  const chatPlaceholder = chatChannelHint(snapshot);

  return (
    <VoiceProvider snapshot={snapshot}>
      <Backdrop
        mood={snapshot ? moodFor(snapshot.phase) : "dusk"}
        event={snapshot?.config.mode === "ranked" ? null : (snapshot?.activeEvent ?? null)}
      />
      <main className="mx-auto w-full max-w-lg px-3 py-4 lg:max-w-[1600px]">
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
            <SoundControl />
            {!room.connected && (
              <span className="rounded bg-blood-600/30 px-2 py-0.5 text-xs text-blood-400">Mất kết nối...</span>
            )}
          </div>
        </header>

        {/*
          * Dưới lg vẫn đúng một cột như cũ. Từ lg trở lên là ba vùng: người chơi,
          * nội dung pha, chat. Hai cột biên có bề rộng CỐ ĐỊNH và hẹp - chúng
          * không đẹp thêm khi rộng ra, chỉ nội dung pha mới dùng được chỗ thừa.
          */}
        <div className="mt-3 grid gap-3 lg:grid-cols-[15rem_minmax(0,1fr)_21rem] lg:items-start">
          {/*
            * Trên điện thoại, trong ván thì cột người chơi xuống dưới nội dung -
            * ở đó nó chỉ để tra cứu, còn nội dung pha mới là thứ phải thao tác
            * ngay. Riêng phòng chờ thì ngược lại: câu hỏi đầu tiên luôn là ai đã
            * vào phòng, và bộ bài thì cuộn xuống xem lúc nào cũng được.
            */}
          <aside
            className={`${
              snapshot?.phase === "LOBBY" ? "order-1" : "order-2"
            } lg:order-none lg:sticky lg:top-4`}
          >
            {snapshot && (
              <RosterPanel
                snapshot={snapshot}
                lobby={
                  snapshot.phase === "LOBBY"
                    ? {
                        isHost,
                        onKick: (targetId) => room.emit("room:kick", { targetId }),
                      }
                    : undefined
                }
                onUpdateAvatar={(avatarUrl) => room.emit("room:update-avatar", { avatarUrl })}
              />
            )}
          </aside>

          <div
            className={`${
              snapshot?.phase === "LOBBY" ? "order-2" : "order-1"
            } flex min-w-0 flex-col gap-3 lg:order-none`}
          >
            {snapshot && <EventBanner event={snapshot.activeEvent} />}
            {snapshot && <PhaseBanner snapshot={snapshot} />}

            {/*
              * mode="wait" để hai pha không chồng lên nhau giữa chừng làm nhảy layout.
              * Đổi pha đã có nhịp riêng của nó rồi; 120ms chỉ đủ đánh dấu là "vừa
              * sang chuyện khác", không đủ để trì hoãn thông tin nào.
              */}
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={snapshot?.phase ?? "connecting"}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                {content}
              </m.div>
            </AnimatePresence>

            {room.error && (
              <p className="rounded-lg bg-blood-600/20 px-3 py-2 text-center text-sm text-blood-400">{room.error}</p>
            )}
          </div>

          <div className="order-3 flex h-[38dvh] min-h-0 flex-col gap-3 lg:order-none lg:sticky lg:top-4 lg:flex lg:h-[calc(100dvh-2rem)] lg:flex-col">
            <RightMetaPanel snapshot={snapshot} />
            <VoiceControl snapshot={snapshot} />
            <div className="min-h-0 flex-1 lg:max-h-[520px] lg:min-h-[320px]">
              <ChatBox
                messages={room.messages}
                onSend={(text) => room.emit("chat:send", { text })}
                placeholder={chatPlaceholder}
              />
            </div>
          </div>
        </div>
      </main>
    </VoiceProvider>
  );
}

function chatChannelHint(snapshot: RoomSnapshot | null): string {
  if (!snapshot) return "Nhập tin nhắn...";
  if (snapshot.phase === "LOBBY" || snapshot.phase === "GAME_OVER") return "Chat phòng...";
  if (!snapshot.you?.alive) return "Chat cùng những người đã chết...";
  if (snapshot.phase === "NIGHT") return snapshot.you.role === "WEREWOLF" ? "Chat phe Sói..." : "Ban đêm bạn không thể chat...";
  return "Chat làng...";
}
