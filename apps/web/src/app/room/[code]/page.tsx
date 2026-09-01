"use client";

import { useEffect, useMemo, useState } from "react";
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
import { MobileChatDock } from "@/components/MobileChatDock";
import { CinematicOverlay } from "@/components/CinematicOverlay";
import { RoomInvite } from "@/components/RoomInvite";
import { LobbyHeader } from "@/components/LobbyHeader";

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = (params.code ?? "").toUpperCase();
  const room = useRoomSocket(code);
  const snapshot = room.snapshot;
  useGameAudio(snapshot);
  /*
   * Bản nháp chat sống ở đây chứ không trong ChatBox.
   *
   * Trên điện thoại khung chat nằm trong tấm trượt đóng mở được, và đóng nó lại
   * là tháo hẳn component. Nháp nằm trong ChatBox thì mỗi lần liếc ra xem lưới
   * bỏ phiếu là mất câu đang gõ dở. Ở đây nó cũng dùng chung cho cả khung chat
   * cột phải trên desktop, nên chuyển kích cỡ màn hình giữa chừng không mất chữ.
   */
  const [chatDraft, setChatDraft] = useState("");

  // Chưa đăng nhập -> về trang chủ kèm mã phòng
  useEffect(() => {
    if (room.identityMissing) router.replace(`/?code=${code}`);
  }, [room.identityMissing, code, router]);

  const isHost = !!snapshot && snapshot.hostId === getIdentity()?.playerId;
  const droppedConnection = !!snapshot && !room.connected;
  const isLobby = snapshot?.phase === "LOBBY";

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
            onDeadMessage={(text) => room.emit("game:dead-message", { text })}
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
      {/*
        * Đặt ngay đầu cây chứ không phải cuối: lớp phủ che cả màn hình, nên nút
        * "Bỏ qua" phải nằm gần đầu thứ tự Tab. Nó cũng chỉ ĐỌC snapshot - không
        * emit, không giữ, không hoãn - nên nội dung pha bên dưới đã là nội dung
        * MỚI ngay từ khung hình đầu tiên của cảnh.
        */}
      <CinematicOverlay snapshot={snapshot} />

      {/* pb-28 chừa chỗ cho nút chat nổi ở đáy - thiếu nó thì nút cuối trang
        * (Bỏ phiếu, Rời phòng) nằm ngay dưới nút chat và bấm nhầm.
        *
        * Phòng chờ hẹp hơn lúc chơi: 1600px là bề ngang cho một bàn 15 ô cộng
        * hai cột biên, còn ở phòng chờ cột giữa chỉ có một thẻ thiết lập, và kéo
        * nó ra 1600 thì mỗi dòng chữ dài quá tầm đọc trong khi thẻ vẫn trống
        * hoác. 1440 là chỗ ba vùng còn thở mà không dãn ra. */}
      <main
        className={`mx-auto w-full max-w-lg px-3 pb-28 pt-4 lg:pb-6 ${
          isLobby ? "md:max-w-2xl lg:max-w-[1440px] lg:px-6" : "lg:max-w-[1600px]"
        }`}
      >
        <header className="flex items-center justify-between gap-2">
          {/*
            * MỘT chỗ rời phòng cho cả trang.
            *
            * Phòng chờ bản cũ có thêm một nút "Rời phòng" toàn chiều ngang ngay
            * dưới "Bắt đầu trận đấu" - cùng bề ngang, cùng chiều cao với CTA -
            * nên hai nút cạnh tranh nhau, và người chơi gặp cùng một hành động ở
            * cả đầu lẫn cuối trang. Cái ở đây giữ lại vì nó có mặt ở MỌI pha.
            */}
          <button
            className="btn-tertiary-danger shrink-0 whitespace-nowrap"
            onClick={leaveRoom}
          >
            <span aria-hidden="true">←</span> Rời phòng
          </button>
          {/* items-start: cụm mời cao hơn một dòng khi có thông báo hoặc ô chép
            * tay, và nút âm thanh không được trôi xuống giữa theo nó. */}
          <div className="flex items-start gap-2">
            {/* Trong phòng chờ cụm mời đã lên `LobbyHeader` cùng mã phòng và bộ
              * đếm người; để lại bản thứ hai ở đây là hai mã phòng trên cùng một
              * màn hình. */}
            {!isLobby && <RoomInvite code={code} />}
            <SoundControl />
            {/*
              * Điều kiện là `snapshot &&`, không phải chỉ `!connected`.
              *
              * Lúc mới mở trang, connected còn false trong khi socket đang bắt
              * tay - phù hiệu đỏ "Mất kết nối" nhấp nháy ngay cạnh dòng "Đang
              * kết nối vào phòng..." ở giữa màn, hai câu nói ngược nhau. Có
              * snapshot nghĩa là đã từng vào được phòng, nên mất kết nối lúc đó
              * mới thật sự là RỚT.
              *
              * Vùng sr-only nằm NGOÀI điều kiện: một node chỉ mọc ra lúc có
              * chuyện thì aria-live trên chính nó không đọc gì cả - trình đọc
              * màn hình phải thấy vùng đó từ trước mới theo dõi được thay đổi.
              */}
            <span className="sr-only" role="status">
              {droppedConnection ? "Mất kết nối với máy chủ, đang thử kết nối lại" : ""}
            </span>
            {droppedConnection && (
              <span className="rounded bg-blood-600/30 px-2 py-0.5 text-xs text-blood-400">Mất kết nối...</span>
            )}
          </div>
        </header>

        {/*
          * Đầu phòng chờ nằm NGOÀI lưới, vắt ngang cả ba vùng.
          *
          * Đặt nó trong cột giữa thì dưới lg nó rơi xuống SAU danh sách người
          * chơi (cột trái cố ý lên trước ở phòng chờ), và người vừa mở link mời
          * phải cuộn qua cả danh sách mới thấy mã phòng cùng nút mời bạn - đúng
          * hai thứ họ cần trong mười giây đầu. Ở đây nó cũng thay luôn
          * `PhaseBanner`: hai khối đó cùng nói "Phòng chờ", mà ở pha này thanh
          * pha không có thêm gì để nói (chưa có hạn giờ, chưa có số vòng).
          */}
        {snapshot && snapshot.phase === "LOBBY" && (
          <div className="mt-3 lg:mt-5">
            <LobbyHeader snapshot={snapshot} code={code} />
          </div>
        )}

        {/*
          * Dưới lg vẫn đúng một cột như cũ. Từ lg trở lên là ba vùng: người chơi,
          * nội dung pha, chat. Hai cột biên có bề rộng CỐ ĐỊNH và hẹp - chúng
          * không đẹp thêm khi rộng ra, chỉ nội dung pha mới dùng được chỗ thừa.
          * Phòng chờ nới hai cột biên rộng thêm một chút: tên người chơi ở 15rem
          * bị cắt cụt ngay khi có thêm nút Kick bên cạnh.
          */}
        <div
          className={`mt-3 grid gap-3 lg:items-start ${
            isLobby
              ? "lg:grid-cols-[18rem_minmax(0,1fr)_21rem] lg:gap-5 xl:grid-cols-[19rem_minmax(0,1fr)_22rem]"
              : "lg:grid-cols-[15rem_minmax(0,1fr)_21rem]"
          }`}
        >
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
              />
            )}
          </aside>

          <div
            className={`${
              snapshot?.phase === "LOBBY" ? "order-2" : "order-1"
            } flex min-w-0 flex-col gap-3 lg:order-none`}
          >
            {snapshot && <EventBanner event={snapshot.activeEvent} />}
            {/* Phòng chờ dùng `LobbyHeader` phía trên lưới thay cho thanh pha -
              * xem chú thích ở chỗ dựng nó. */}
            {snapshot && snapshot.phase !== "LOBBY" && <PhaseBanner snapshot={snapshot} />}

            {/* Voice là thao tác trực tiếp, không phải thông tin phụ: trên điện
              * thoại nó phải ở ngay đầu cột nội dung chứ không theo cột phải đi
              * mất. Trên desktop bản này ẩn đi, cái trong cột phải mới hiện. */}
            <div className="lg:hidden">
              <VoiceControl snapshot={snapshot} />
            </div>

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

          {/*
            * Cột phải chỉ tồn tại từ lg. Dưới đó nó từng bị đẩy xuống cuối trang,
            * sau cả nội dung pha lẫn danh sách người chơi - trong màn bỏ phiếu
            * khung chat rơi xuống quanh mốc 1800px. Trên điện thoại chat đi qua
            * MobileChatDock ở cuối file này thay vì nằm chờ cuối trang.
            */}
          <div className="hidden lg:order-none lg:sticky lg:top-4 lg:flex lg:h-[calc(100dvh-2rem)] lg:min-h-0 lg:flex-col lg:gap-3">
            <RightMetaPanel snapshot={snapshot} />
            <VoiceControl snapshot={snapshot} />
            {/* Trong phòng chờ khung chat thấp hơn: chưa có ai nói gì thì một
              * khung 520px rỗng là khoảng trống lớn nhất trên màn hình. */}
            <div
              className={`min-h-0 flex-1 ${
                isLobby ? "lg:max-h-[420px] lg:min-h-[240px]" : "lg:max-h-[520px] lg:min-h-[320px]"
              }`}
            >
              <ChatBox
                messages={room.messages}
                onSend={(text) => room.emit("chat:send", { text })}
                placeholder={chatPlaceholder}
                draft={chatDraft}
                onDraftChange={setChatDraft}
              />
            </div>
          </div>
        </div>
      </main>

      <MobileChatDock
        messages={room.messages}
        onSend={(text) => room.emit("chat:send", { text })}
        placeholder={chatPlaceholder}
        draft={chatDraft}
        onDraftChange={setChatDraft}
        selfId={snapshot?.you?.id ?? null}
        phase={snapshot?.phase ?? null}
      />
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
