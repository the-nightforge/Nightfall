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
  const chatEmpty = chatEmptyHint(snapshot);

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
        * hoác. 1440 là chỗ ba vùng còn thở mà không dãn ra.
        *
        * Trong ván, từ lg trở lên `main` là một KHUNG cao đúng bằng màn hình,
        * không phải một tấm giấy dài.
        *
        * Bản cũ để cả trang tự cuộn: bàn chơi cao chừng 700px nằm dán lên mép
        * trên của một màn 1440x900 rồi bỏ trống gần hai trăm pixel bên dưới, và
        * mỗi lần chat dài ra là cả trang trôi - kể cả lưới bỏ phiếu đang thao
        * tác dở. Cao 100dvh + `overflow-hidden` ở đây, cộng với ba cột tự cuộn
        * bên trong, đổi lại đúng cảm giác một cái bàn: mọi thứ nằm trong khung
        * nhìn, phần nào dài thì phần đó cuộn.
        *
        * KHÔNG hardcode chiều cao cho lưới (`calc(100dvh - 6rem)` chẳng hạn):
        * cụm mời + nút âm thanh trên đầu cao thấp khác nhau tuỳ có thông báo
        * hay không, và mọi hằng số đoán trước đều lệch đúng vào lúc đó. Để lưới
        * `flex-1` trong một cột flex thì nó tự lấy đúng phần còn lại.
        *
        * Phòng chờ giữ nguyên lối cũ: ở đó nội dung ngắn, và ép nó vào một
        * khung không cuộn thì bộ bài 13 vai không xem hết được.
        */}
      <main
        className={`mx-auto w-full max-w-lg px-3 pb-28 pt-4 lg:pb-6 ${
          isLobby
            ? "md:max-w-2xl lg:max-w-[1440px] lg:px-6"
            : "md:max-w-3xl lg:flex lg:h-[100dvh] lg:max-w-[1600px] lg:flex-col lg:overflow-hidden lg:px-4 xl:px-6"
        }`}
      >
        <header className="flex shrink-0 items-center justify-between gap-2">
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
          *
          * Trong ván, cột chat rộng 23rem (368px) từ xl: ở 21rem cũ một câu chat
          * trung bình gãy làm ba dòng vì bong bóng chỉ còn ~250px chữ sau khi
          * trừ đệm và mép 15%. Cột người chơi thì đi ngược lại, 15rem là đủ cho
          * một danh sách chỉ để TRA CỨU, và mỗi rem lấy bớt ở đây là một rem
          * trả về cho lưới bỏ phiếu ở giữa.
          *
          * Nấc lg (1024-1279px) bóp cả hai cột biên lại: ở 1024 mà giữ nguyên
          * bề rộng của desktop lớn thì khu chơi chỉ còn 400px - lưới ghế tụt
          * xuống hai cột và cả tên pha cũng bị cắt ("Bỏ phi..."). Hai cột biên
          * ở nấc này vẫn dùng được đúng việc của chúng, còn chỗ tiết kiệm được
          * thì trả hết cho khu chơi, đúng thứ tự ưu tiên ở màn hình hẹp.
          *
          * items-start chỉ dành cho phòng chờ. Trong ván ba cột phải cao bằng
          * nhau và bằng khung - đó là thứ làm nó ra hình một cái bàn thay vì ba
          * mẩu thẻ trôi lệch nhau ở nửa trên màn hình.
          */}
        <div
          className={`mt-3 grid gap-3 ${
            isLobby
              ? "lg:grid-cols-[18rem_minmax(0,1fr)_21rem] lg:items-start lg:gap-5 xl:grid-cols-[19rem_minmax(0,1fr)_22rem]"
              : "lg:min-h-0 lg:flex-1 lg:grid-cols-[14rem_minmax(0,1fr)_17.5rem] xl:grid-cols-[15rem_minmax(0,1fr)_23rem] xl:gap-4"
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
              isLobby ? "order-1 lg:sticky lg:top-4" : "order-2 lg:min-h-0"
            } lg:order-none`}
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

          {/*
            * Cột giữa tự cuộn thay vì đẩy cả trang.
            *
            * Trong một pha có lưới bỏ phiếu + lịch sử phiếu + thẻ sự kiện, cột
            * này dài hơn khung nhìn là chuyện thường. Để nó đẩy trang thì hai
            * cột biên - vốn đã cao đúng bằng màn - trôi mất theo, và người chơi
            * cuộn xuống xem lịch sử phiếu là mất luôn khung chat lẫn đồng hồ.
            * `pr-1` chừa chỗ cho thanh cuộn để nó không đè lên viền thẻ.
            */}
          <div
            className={`${
              isLobby
                ? "order-2"
                : "lobby-roster-scroll order-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
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
            *
            * `sticky` chỉ còn dùng ở phòng chờ. Trong ván cả lưới đã cao đúng
            * bằng khung nhìn và không cuộn, nên cột này tự đứng yên - dán thêm
            * sticky vào một thứ vốn không trôi chỉ tổ thêm một tầng chồng lớp.
            */}
          <div
            className={`hidden lg:order-none lg:flex lg:min-h-0 lg:flex-col lg:gap-3 ${
              isLobby ? "lg:sticky lg:top-4 lg:h-[calc(100dvh-2rem)]" : ""
            }`}
          >
            <RightMetaPanel snapshot={snapshot} />
            <VoiceControl snapshot={snapshot} />
            {/*
              * Trong ván khung chat lấy TRỌN phần còn lại của cột chứ không bị
              * chặn ở 520px: cột cao bằng màn hình, nên một trần cứng chỉ để
              * lại một mảng trống dưới đáy cột phải - đúng khoảng trống mà cả
              * bố cục này sinh ra để dẹp. Phòng chờ vẫn giữ trần thấp: chưa ai
              * nói gì mà dựng sẵn một khung rỗng cao 700px thì chính nó là
              * khoảng trống lớn nhất màn hình.
              */}
            <div
              className={`min-h-0 flex-1 ${
                isLobby ? "lg:max-h-[420px] lg:min-h-[240px]" : "lg:min-h-[320px]"
              }`}
            >
              <ChatBox
                messages={room.messages}
                onSend={(text) => room.emit("chat:send", { text })}
                placeholder={chatPlaceholder}
                emptyHint={chatEmpty}
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
        emptyHint={chatEmpty}
        draft={chatDraft}
        onDraftChange={setChatDraft}
        selfId={snapshot?.you?.id ?? null}
        phase={snapshot?.phase ?? null}
      />
    </VoiceProvider>
  );
}

/**
 * Câu gợi ý khi khung chat còn rỗng.
 *
 * Đứng cạnh `chatChannelHint` vì cùng một lý do và cùng một đầu vào: chỗ này
 * biết đang ở pha nào, còn `ChatBox` thì không. Ba câu, một hàm - không đáng
 * dựng thêm một lớp trừu tượng nào cho ba dòng chữ.
 */
function chatEmptyHint(snapshot: RoomSnapshot | null): string {
  if (!snapshot || snapshot.phase === "LOBBY") {
    return "Chào cả phòng một câu trong lúc chờ đủ người.";
  }
  if (snapshot.phase === "GAME_OVER") return "Chưa có tin nhắn nào sau trận.";
  return "Chưa có tin nhắn trong kênh này.";
}

function chatChannelHint(snapshot: RoomSnapshot | null): string {
  if (!snapshot) return "Nhập tin nhắn...";
  if (snapshot.phase === "LOBBY" || snapshot.phase === "GAME_OVER") return "Chat phòng...";
  if (!snapshot.you?.alive) return "Chat cùng những người đã chết...";
  if (snapshot.phase === "NIGHT") return snapshot.you.role === "WEREWOLF" ? "Chat phe Sói..." : "Ban đêm bạn không thể chat...";
  return "Chat làng...";
}
