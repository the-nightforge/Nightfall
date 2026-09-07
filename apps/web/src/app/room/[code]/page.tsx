"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, m } from "motion/react";
import type { RoomSnapshot } from "@masoi/shared";
import { getIdentity } from "@/lib/identity";
import {
  chatComposerState,
  chatEmptyHint,
  chatHeading,
  presentChannels,
} from "@/lib/chat-channels";
import { usePhaseMarkers } from "@/lib/use-phase-markers";
import { mentionNamesFor, quickPhrasesFor } from "@/lib/quick-phrases";
import { useLiveTrial } from "@/lib/useLiveTrial";
import { useRoomSocket } from "@/lib/useRoomSocket";
import { VoiceControl } from "@/components/VoiceControl";
import { RulesDrawer } from "@/components/RulesDrawer";
import { VoiceProvider } from "@/components/VoiceProvider";
import { useGameAudio } from "@/lib/useGameAudio";
import { useAttention } from "@/lib/useAttention";
import { requestAttentionPermission } from "@/lib/attention";
import { moodFor } from "@/lib/mood";
import { Backdrop } from "@/components/Backdrop";
import { PhaseBanner } from "@/components/PhaseBanner";
import { RosterPanel } from "@/components/RosterPanel";
import { ChatBox } from "@/components/ChatBox";
import { RightMetaPanel } from "@/components/RightMetaPanel";
import { RoleRevealView } from "@/components/RoleViews";
import { NightPanel } from "@/components/NightPanel";
import { DayView, EliminationView } from "@/components/DayViews";
import { ExecutionerMission } from "@/components/ExecutionerMission";
import { GameOverView } from "@/components/GameOverView";
import { HunterShotPanel } from "@/components/HunterShotPanel";
import { TrialPanel } from "@/components/TrialPanel";
import { TrialStage } from "@/components/TrialStage";
import { Lobby } from "@/components/Lobby";
import { LobbySettingsDrawer } from "@/components/LobbySettingsDrawer";
import { SoundControl } from "@/components/SoundControl";
import { EventBanner } from "@/components/EventBanner";
import { MobileChatDock } from "@/components/MobileChatDock";
import { CinematicOverlay } from "@/components/CinematicOverlay";
import { LastLetterReveal } from "@/components/LastLetterReveal";
import { RoomInvite } from "@/components/RoomInvite";
import { LobbyPlayerGrid } from "@/components/LobbyPlayerGrid";
import { GuideBanner } from "@/components/GuideBanner";
import {
  finishGuide,
  guideRoomState,
  hideGuide,
  markGuidedRoom,
  type GuideRoomState,
} from "@/lib/guide-session";
import { useGuidePrep } from "@/lib/useGuidePrep";

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = (params.code ?? "").toUpperCase();
  const room = useRoomSocket(code);
  const snapshot = room.snapshot;
  useGameAudio(snapshot);
  useAttention(snapshot);
  /*
   * "Phiên toà sống" đọc TỪNG snapshot, kể cả những pha không có phiên toà nào.
   *
   * Vì vậy nó nằm ở đây chứ không trong component sân khấu: trí nhớ của nó phải
   * sống qua cả ván thì mới phân biệt được "phiên toà vừa mở ra trước mắt tôi"
   * với "phiên toà đã mở từ trước khi tôi vào" - xem `useLiveTrial`.
   */
  const live = useLiveTrial(snapshot, room.connected);
  const liveStage = live.view !== null;
  /*
   * Bản nháp chat sống ở đây chứ không trong ChatBox.
   *
   * Trên điện thoại khung chat nằm trong tấm trượt đóng mở được, và đóng nó lại
   * là tháo hẳn component. Nháp nằm trong ChatBox thì mỗi lần liếc ra xem lưới
   * bỏ phiếu là mất câu đang gõ dở. Ở đây nó cũng dùng chung cho cả khung chat
   * cột phải trên desktop, nên chuyển kích cỡ màn hình giữa chừng không mất chữ.
   */
  const [chatDraft, setChatDraft] = useState("");

  /*
   * Ván đầu có hướng dẫn.
   *
   * Cờ đọc SAU khi mount, không phải trong lúc render: `?guide=1` và
   * sessionStorage đều là chuyện của trình duyệt, server render không có.
   * `?guide=1` được cất vào sessionStorage theo mã phòng rồi GỠ khỏi URL - nếu
   * để lại, người bấm "Ẩn" rồi tải lại trang sẽ thấy hướng dẫn mọc lại từ
   * chính cái URL đó. Đường dẫn sạch cũng là đường dẫn chia sẻ được: bạn vào
   * bằng link không bị ép xem hướng dẫn của người tạo phòng.
   *
   * Ba trạng thái (`guide-session.ts`): `active` hiện thẻ, `hidden` đã ẩn thẻ
   * nhưng bàn vẫn được chuẩn bị, `finished` đã đi hết ván - chỉ còn lời tổng
   * kết ở GAME_OVER, ván sau trong cùng phòng không tự bật lại.
   */
  const [guideState, setGuideState] = useState<GuideRoomState>("none");
  useEffect(() => {
    if (!code) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("guide") === "1") {
      markGuidedRoom(code);
      router.replace(`/room/${code}`);
      // Đặt thẳng, không đọc lại từ kho: kho bị chặn thì hướng dẫn vẫn sống
      // trọn lần tải này (chỉ mất khi F5).
      setGuideState("active");
      return;
    }
    setGuideState(guideRoomState(code));
  }, [code, router]);

  // Chưa đăng nhập -> về trang chủ kèm mã phòng
  useEffect(() => {
    if (room.identityMissing) router.replace(`/?code=${code}`);
  }, [room.identityMissing, code, router]);

  const identity = getIdentity();
  const isHost = !!snapshot && snapshot.hostId === identity?.playerId;
  const droppedConnection = !!snapshot && !room.connected;
  const isLobby = snapshot?.phase === "LOBBY";

  /*
   * Ván hướng dẫn tự chuẩn bị bàn: bộ bài chuẩn của bàn 8 rồi bot cho đủ 8,
   * bằng ĐÚNG hai sự kiện mà các nút trong phòng chờ gửi, mỗi bước chờ
   * snapshot xác nhận rồi mới đi tiếp. Luật ở `lib/guide-prep.ts`; ở đây chỉ
   * nối nó vào socket. Chạy khi hướng dẫn đã được XIN cho phòng này - kể cả
   * khi người dùng đã ẩn thẻ - và không chạy cho phòng thường hay phòng đã đi
   * hết ván hướng dẫn. Bắt đầu ván vẫn là việc của người chơi.
   */
  const guideRequested = guideState === "active" || guideState === "hidden";
  const guidePrep = useGuidePrep({
    code,
    requested: guideRequested,
    snapshot,
    isHost,
    connected: room.connected,
    emit: room.emit,
  });

  /* Đi hết một ván hướng dẫn: khoá phòng này lại, nhớ toàn cục để trang chủ
   * đổi lời mời. Thẻ vẫn hiện lời tổng kết ở GAME_OVER (xem `guideVisible`). */
  useEffect(() => {
    if (guideRequested && snapshot?.phase === "GAME_OVER") {
      finishGuide(code);
      setGuideState("finished");
    }
  }, [guideRequested, snapshot?.phase, code]);

  const guideVisible =
    !!snapshot &&
    (guideState === "active" || (guideState === "finished" && snapshot.phase === "GAME_OVER"));
  const guideContext = { prep: isHost ? guidePrep : null };

  const onHideGuide = () => {
    hideGuide(code);
    // "Ẩn" chỉ ẩn thẻ; bàn vẫn được chuẩn bị (`guideRequested` vẫn true).
    setGuideState((state) => (state === "active" ? "hidden" : state));
  };

  const content = useMemo(() => {
    if (!snapshot) {
      return (
        <div className="card animate-pulseSlow text-center text-mist/85">
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
            /* Xin quyền thông báo ngay trong cử chỉ bấm nút, vì Safari chỉ
             * nhận yêu cầu từ một cử chỉ người dùng. Hỏi ở đây chứ không lúc
             * vào phòng: người vừa mở trang chưa có lý do gì để đồng ý, còn
             * người bấm "Sẵn sàng" đã quyết định ở lại một ván 20 phút. */
            onReady={(ready) => {
              if (ready) requestAttentionPermission();
              room.emit("room:set-ready", { ready });
            }}
            onStart={() => {
              requestAttentionPermission();
              room.emit("room:start");
            }}
            onAddBot={() => room.emit("room:add-bot")}
            /* Cùng sự kiện mà lớp phủ "Luật và vai trò" gửi: thẻ điều khiển chỉ
             * dùng nó cho đúng một việc - áp preset để gỡ lý do đang chặn nút
             * Bắt đầu (xem `BlockReason`). */
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
            onLastLetter={(text) => room.emit("game:last-letter-set", { text })}
          />
        );
      case "DEFENSE":
      case "FINAL_VOTE":
        return (
          <TrialPanel
            snapshot={snapshot}
            onFinalVote={(guilty) => room.emit("game:final-vote", { guilty })}
            liveStage={liveStage}
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
  }, [snapshot, isHost, liveStage]);

  function leaveRoom() {
    room.emit("room:leave");
    router.push("/");
  }

  /*
   * Ba thứ dưới đây tách BẠCH hai câu hỏi mà bản cũ trộn làm một.
   *
   * `chatHeading` nói người xem đang ĐỌC những kênh nào; `composer` nói họ đang
   * GỬI vào đâu, hoặc vì sao không gửi được. Bản cũ chỉ tính được vế thứ hai
   * rồi in nó lên đầu danh sách đọc - đó là lý do một người đã chết nhìn thấy
   * "Kênh người chết" bên trên một loạt câu của người còn sống.
   */
  const heading = chatHeading(snapshot);
  const composer = chatComposerState(snapshot);
  const channels = presentChannels(snapshot, room.messages);
  const markers = usePhaseMarkers(snapshot);
  const chatEmpty = chatEmptyHint(snapshot);
  // Ba thứ chat cần từ snapshot, tính một lần cho cả cột chat desktop lẫn tấm
  // trượt điện thoại - hai bên phải gợi ý cùng một danh sách tên.
  const mentionNames = useMemo(() => mentionNamesFor(snapshot), [snapshot]);
  const quickPhrases = useMemo(() => quickPhrasesFor(snapshot, composer.channel), [snapshot, composer.channel]);
  const meName = snapshot?.you?.name;

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
        * Từ lg trở lên `main` là một KHUNG cao đúng bằng màn hình ở MỌI pha,
        * phòng chờ nay cũng vậy - không phải một tấm giấy dài.
        *
        * Bản cũ để cả trang tự cuộn: bàn chơi cao chừng 700px nằm dán lên mép
        * trên của một màn 1440x900 rồi bỏ trống gần hai trăm pixel bên dưới, và
        * mỗi lần chat dài ra là cả trang trôi - kể cả lưới bỏ phiếu đang thao
        * tác dở. Cao 100dvh + `overflow-hidden` ở đây, cộng với các cột tự cuộn
        * bên trong, đổi lại đúng cảm giác một cái bàn: mọi thứ nằm trong khung
        * nhìn, phần nào dài thì phần đó cuộn.
        *
        * Phòng chờ theo cùng lối đó từ khi bộ bài 13 vai chuyển vào lớp phủ
        * "Luật và vai trò": thứ duy nhất còn dài hơn màn hình đã có chỗ tự cuộn
        * riêng, nên trang không còn lý do nào để trôi.
        *
        * KHÔNG hardcode chiều cao cho lưới (`calc(100dvh - 6rem)` chẳng hạn):
        * cụm mời + nút âm thanh trên đầu cao thấp khác nhau tuỳ có thông báo
        * hay không, và mọi hằng số đoán trước đều lệch đúng vào lúc đó. Để lưới
        * `flex-1` trong một cột flex thì nó tự lấy đúng phần còn lại.
        *
        * Bề ngang: 1600px là bề ngang cho một bàn 15 ô cộng hai cột biên. Phòng
        * chờ chỉ có hai vùng nên dừng ở 1440 - quá mốc đó thì sân người chơi
        * chỉ dãn ra thành những ô cách nhau quá xa để đọc thành một đám đông.
        */}
      {/*
        * pt phải cộng `env(safe-area-inset-top)`, không được để trần `pt-4`.
        *
        * Layout khai `viewport-fit=cover` và `statusBarStyle:
        * "black-translucent"`, nên khi cài lên màn hình chính iPhone thì web
        * view trải HẾT lên tận mép trên - đồng hồ, sóng, pin của iOS nằm ĐÈ
        * lên hàng đầu trang. Chụp lại trên máy thật: "06:50" chồng lên "Rời
        * phòng", cụm pin che nút âm thanh. Đây là cái giá của black-translucent
        * và nó chỉ trả đúng một lần, ở đây, bằng lề an toàn.
        *
        * Trên trình duyệt thường và trên desktop `env(safe-area-inset-top)` là
        * 0, nên biểu thức rút về đúng 1rem của bản cũ - không có nhánh riêng
        * nào cần giữ đồng bộ.
        *
        * Lề đi bằng class Tailwind chứ không phải inline style: `env()` trong
        * thuộc tính style của React bị bỏ qua ở một số trình duyệt, còn trong
        * CSS sinh ra từ class thì luôn được tính.
        */}
      <main
        className={`mx-auto w-full max-w-lg px-3 pb-28 pt-[calc(1rem+env(safe-area-inset-top))] lg:flex lg:h-[100dvh] lg:flex-col lg:overflow-hidden lg:pb-6 ${
          isLobby
            ? "lobby-page md:max-w-3xl lg:max-w-[1440px] lg:px-6"
            : "md:max-w-3xl lg:max-w-[1600px] lg:px-4 xl:px-6"
        }`}
      >
        <header className="room-topbar flex shrink-0 items-center justify-between gap-2">
          {/*
            * MỘT chỗ rời phòng cho mỗi pha - không bao giờ hai.
            *
            * Phòng chờ bản cũ có thêm một nút "Rời phòng" toàn chiều ngang ngay
            * dưới "Bắt đầu trận đấu" - cùng bề ngang, cùng chiều cao với CTA -
            * nên hai nút cạnh tranh nhau, và người chơi gặp cùng một hành động ở
            * cả đầu lẫn cuối trang. Cái ở đây phục vụ MỌI pha còn lại.
            *
            * Trừ GAME_OVER. Ở đó `PostMatchActions` đã có "Rời phòng và về trang
            * chủ", và hai điều khiển đó gọi ĐÚNG một hàm `leaveRoom` - cùng emit
            * `room:leave`, cùng đẩy về `/`. Hai nút khác tên mà cùng kết quả thì
            * người chơi phải đoán xem cái nào là cái nào, nên chỉ một cái được ở
            * lại. Cái ở lại là cái trong cụm hành động sau trận: nhãn của nó nói
            * rõ ĐÍCH ĐẾN, và nó đứng ngay dưới CTA nên đọc ra là một lựa chọn
            * đối lập với "Về phòng chờ" chứ không phải một cái nút lạc ở góc.
            */}
          {snapshot?.phase !== "GAME_OVER" && (
            <button
              /* Có nền mờ vì nút này đứng ngay trên mặt trăng của phông nền:
               * chữ trần ở đó chìm vào vùng sáng nhất của cả trang. Cùng độ
               * cao với cụm mã phòng bên phải để cả hàng đọc ra là MỘT thanh.
               *
               * Chiều cao 44px đến từ `.room-topbar button` trong globals.css,
               * không viết lại ở đây: cả hàng phải cao BẰNG NHAU, và bốn nút
               * trong hàng đến từ bốn file khác nhau. */
              className="btn-tertiary-danger shrink-0 whitespace-nowrap bg-night-900/55 backdrop-blur-sm"
              onClick={leaveRoom}
            >
              <span aria-hidden="true">←</span> Rời phòng
            </button>
          )}
          {/* items-start: cụm mời cao hơn một dòng khi có thông báo hoặc ô chép
            * tay, và nút âm thanh không được trôi xuống giữa theo nó.
            *
            * ml-auto để cụm này vẫn dính mép phải khi nút rời phòng vắng mặt:
            * `justify-between` với một đứa con duy nhất sẽ dồn nó về bên TRÁI. */}
          <div className="ml-auto flex items-start gap-2">
            {/*
              * MỘT mã phòng cho cả trang, và nó ở đây.
              *
              * Phòng chờ từng có bản thứ hai trong `LobbyHeader` - hai mã phòng
              * cùng lúc trên một màn hình, và người vừa nhận link phải đoán xem
              * cái nào là cái thật. Giờ đầu bảng người chơi chỉ còn nói chuyện
              * của bảng đó, còn mã phòng và hai nút mời đứng nguyên một hàng
              * `Rời phòng | Mã phòng + Mời bạn | Âm thanh` ở đây.
              *
              * Cỡ `lg` chỉ dùng ở phòng chờ: đó là lúc mã phòng được đọc to lên
              * cho bạn bè chép, còn trong ván nó chỉ là chỗ tra lại.
              */}
            <RoomInvite code={code} size={isLobby ? "lg" : "sm"} />
            {/* Chỉ trong ván: phòng chờ đã có "Luật và vai trò" ở thanh điều
              * khiển, còn màn kết thúc thì lật hết bài rồi, không còn gì để tra. */}
            {snapshot && !isLobby && snapshot.phase !== "GAME_OVER" && (
              <RulesDrawer snapshot={snapshot} />
            )}
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
          * Trần 68rem + `my-auto`: trên màn rất cao (2559x1346 chẳng hạn) một
          * cái bàn kéo dài 1240px chỉ tạo ra khoảng trống BÊN TRONG cột chơi -
          * thứ không có gì để đổ vào mà cũng không được phép bịa nội dung ra
          * lấp. Chặn chiều cao rồi thả cho nó tự căn giữa thì phần thừa chuyển
          * ra ngoài thành lề trên/dưới cân nhau, và ba cột vẫn cao bằng nhau.
          * Dưới mốc đó (1080p trở xuống) trần không bao giờ chạm tới.
          *
          * Phòng chờ là hai vùng: sân người chơi và thanh điều khiển, chia
          * 65/35 (1.85fr : 1fr). Cận dưới 21rem cho cột phải là bề ngang tối
          * thiểu để một bong bóng chat không gãy làm ba dòng; ở 1024px cột đó
          * rơi vào khoảng 22rem nên cận này không bao giờ phải ra tay, nó chỉ
          * ở đó để một màn hẹp bất thường không bóp chat thành một sợi chỉ.
          *
          * Ba hàng của thanh điều khiển, và mỗi hàm minmax ở đây là một câu trả
          * lời cho một câu hỏi khác nhau:
          *
          *   - `minmax(0,auto)` cho thẻ điều khiển: bình thường nó cao đúng
          *     bằng nội dung, nhưng cận dưới 0 cho phép lưới BÓP nó lại khi màn
          *     hình thấp. Để `auto` trơn thì ở 1024x768 nó giữ nguyên 476px và
          *     đẩy khung chat lòi ra ngoài khung nhìn. Nó co được mà nút Bắt
          *     đầu vẫn nguyên chỗ là nhờ `.lobby-command-summary` bên trong -
          *     xem `Lobby`.
          *   - `minmax(15rem,1fr)` cho chat: phần còn lại rơi HẾT vào đây. Sàn
          *     cũ là 9.5rem - đúng bằng đầu khung cộng ô nhập và KHÔNG chừa một
          *     pixel nào cho tin nhắn. Ở 1024x768 lẫn 1280x800 lưới đưa chat
          *     xuống đúng cái sàn đó, nên khung tin nhắn còn 1px: khung rỗng
          *     tràn ra đè lên ô nhập, còn phòng có người nói thì không đọc được
          *     câu nào. 15rem để lại khoảng 5.5rem cho tin nhắn - vừa đủ lời
          *     mời chào của khung rỗng, hoặc hai bong bóng ngắn - và chỗ đó lấy
          *     từ thẻ điều khiển, vốn đã tự cuộn được.
          *   - `auto` cho nút "Luật và vai trò": nó chỉ cao bằng chính nó.
          *
          * Nhờ thứ tự đó, nút Bắt đầu - nằm ở hàng đầu - không bao giờ bị một
          * cuộc trò chuyện dài đẩy khỏi màn hình.
          */}
        <div
          className={`mt-3 grid gap-3 lg:min-h-0 lg:flex-1 ${
            isLobby
              ? "lg:grid-cols-[minmax(0,1.85fr)_minmax(21rem,1fr)] lg:grid-rows-[minmax(0,auto)_minmax(15rem,1fr)_auto] lg:gap-x-5"
              : "lg:my-auto lg:max-h-[68rem] lg:grid-cols-[14rem_minmax(0,1fr)_17.5rem] xl:grid-cols-[15rem_minmax(0,1fr)_23rem] xl:gap-4"
          }`}
        >
          {/*
            * Trên điện thoại, trong ván thì cột người chơi xuống dưới nội dung -
            * ở đó nó chỉ để tra cứu, còn nội dung pha mới là thứ phải thao tác
            * ngay. Riêng phòng chờ thì ngược lại: câu hỏi đầu tiên luôn là ai đã
            * vào phòng, và bộ bài thì cuộn xuống xem lúc nào cũng được.
            *
            * Đầu phòng chờ nằm TRONG bảng người chơi chứ không vắt ngang phía
            * trên lưới như trước, và đó là điều kiện để khung chat lên được màn
            * hình đầu - xem `LobbyHeader`.
            *
            * Thứ tự trên điện thoại KHÔNG đổi: khối này vẫn là `order-1`, nên
            * sau mã phòng ở thanh đầu trang, thứ gặp tiếp theo là danh sách
            * người chơi, rồi mới tới thanh điều khiển.
            *
            * Nó cũng thay luôn `PhaseBanner`: hai khối đó cùng nói "Phòng chờ",
            * mà ở pha này thanh pha không có thêm gì để nói (chưa có hạn giờ,
            * chưa có số vòng).
            *
            * Phòng chờ dùng `div` chứ không `aside`: khối này chứa `h1` của cả
            * trang, và một landmark "nội dung phụ" bọc lấy tiêu đề chính thì
            * trình đọc màn hình đọc ra ngược hẳn tầm quan trọng thật.
            *
            * `row-span-3` + `min-h-0`: cột trái cao đúng bằng cả ba hàng của
            * thanh điều khiển bên phải, và bảng bên trong tự cuộn phần lưới.
            */}
          {isLobby ? (
            <div className="order-1 flex min-w-0 flex-col gap-3 lg:order-none lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:min-h-0">
              {/* Ở phòng chờ thẻ hướng dẫn đứng TRÊN sân người chơi: trên điện
                * thoại cột điều khiển nằm dưới lưới và nút Bắt đầu dính đáy che
                * mất nó - đúng chỗ người mới cần đọc "bấm Bắt đầu" nhất. */}
              {guideVisible && (
                <GuideBanner snapshot={snapshot} context={guideContext} onDismiss={onHideGuide} />
              )}
              {snapshot && (
                <LobbyPlayerGrid
                  snapshot={snapshot}
                  isHost={isHost}
                  onKick={(targetId) => room.emit("room:kick", { targetId })}
                />
              )}
            </div>
          ) : (
            <aside className="order-2 lg:order-none lg:min-h-0">
              {snapshot && <RosterPanel snapshot={snapshot} />}
            </aside>
          )}

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
                ? "order-2 lg:col-start-2 lg:row-start-1 lg:min-h-0"
                : "lobby-roster-scroll order-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
            } flex min-w-0 flex-col gap-3 lg:order-none`}
          >
            {snapshot && <EventBanner event={snapshot.activeEvent} />}
            {/* Phòng chờ không có thanh pha: `LobbyHeader` - nay là đầu bảng
              * người chơi ở cột trái - đã in tên cảnh, và ở pha này thanh pha
              * không có thêm gì để nói (chưa có hạn giờ, chưa có số vòng). */}
            {snapshot && snapshot.phase !== "LOBBY" && <PhaseBanner snapshot={snapshot} />}

            {/*
              * Thẻ hướng dẫn đứng NGAY DƯỚI thanh pha, trên nội dung pha: đọc
              * theo đúng thứ tự "đang ở đâu -> cần làm gì -> làm ở đây". Không
              * phải modal, không che, không chặn - xem `GuideBanner`.
              */}
            {guideVisible && !isLobby && (
              <GuideBanner snapshot={snapshot} context={guideContext} onDismiss={onHideGuide} />
            )}

            {/*
              * Sân khấu phiên toà đứng NGOÀI `AnimatePresence`, và đó là điều
              * kiện để nó tồn tại được.
              *
              * Khối bên dưới lấy `key` theo pha, nên nội dung pha bị THÁO rồi
              * dựng lại ở mỗi cạnh pha - kể cả DEFENSE -> FINAL_VOTE, vốn là đi
              * tiếp trong cùng một phiên toà. Đặt sân khấu vào trong đó nghĩa là
              * huỷ context WebGL và dựng lại đúng vào giây người chơi bấm Treo
              * hay Tha, rồi huỷ lần nữa ngay trước lúc tuyên án. Ở đây nó giữ
              * nguyên MỘT renderer suốt cả ba chặng và tự tháo khi phiên toà
              * kết thúc (`live.view` về null).
              */}
            {snapshot && liveStage && live.view && (
              <TrialStage
                view={live.view}
                beats={live.beats}
                beatsId={live.beatsId}
                onBeatsConsumed={live.consumeBeats}
                snapshot={snapshot}
              />
            )}

            {/*
              * mode="wait" để hai pha không chồng lên nhau giữa chừng làm nhảy layout.
              * Đổi pha đã có nhịp riêng của nó rồi; 120ms chỉ đủ đánh dấu là "vừa
              * sang chuyện khác", không đủ để trì hoãn thông tin nào.
              */}
            <AnimatePresence mode="wait" initial={false}>
              {/* Ở phòng chờ khối này phải TRUYỀN chiều cao xuống: thẻ điều
                * khiển bên trong chỉ co được khi mọi tầng trên nó cũng co
                * được, và một tầng duy nhất còn `min-height: auto` là đủ để cả
                * chuỗi đứng im. Trong ván nó giữ nguyên hình cũ - ở đó cột
                * giữa tự cuộn và không có gì phải co. */}
              <m.div
                className={isLobby ? "flex min-h-0 flex-1 flex-col" : undefined}
                key={snapshot?.phase ?? "connecting"}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                {content}
              </m.div>
            </AnimatePresence>

            {/*
              * Thẻ mở thư đứng SAU nội dung pha, không phải đè lên nó.
              *
              * Ở NIGHT_RESULT và ELIMINATION, nội dung pha chính là thông báo
              * ai đã chết và vì sao - lá thư chỉ có nghĩa khi người đọc đã thấy
              * dòng đó, nên nó không được che. Đặt ở cấp trang chứ không trong
              * từng view vì thư có thể mở ở bất kỳ pha nào một cái chết xảy ra.
              */}
            {/*
              * Khu nhiệm vụ của Kẻ Báo Thù, ở cấp TRANG chứ không trong từng
              * view pha.
              *
              * Nhiệm vụ này không thuộc về một pha nào: nó có nghĩa suốt cả
              * ván, kể cả trong đêm mà vai này không có gì để làm, và nó phải
              * đứng ngay đó vào đúng lúc người chơi đang chọn bỏ phiếu cho ai.
              * Nhét nó vào `DayView` sẽ khiến nó biến mất ở mọi pha khác, và
              * lặp lại nó ở từng view là bốn bản sao để trôi lệch.
              *
              * `snapshot.executioner` đã được server lọc theo chủ sở hữu, nên
              * ở đây không có phép kiểm tra quyền nào - và không được có.
              */}
            {snapshot && <ExecutionerMission snapshot={snapshot} />}

            {snapshot && <LastLetterReveal snapshot={snapshot} />}

            {room.error && (
              <p className="rounded-lg bg-blood-600/20 px-3 py-2 text-center text-sm text-blood-400">{room.error}</p>
            )}

            {/*
              * Dải thông tin trận chuyển từ đầu cột chat xuống CHÂN cột chơi.
              *
              * Hai lý do, cùng một nước đi: ở trên cột chat nó làm cả cột đó
              * đọc ra như một bảng số liệu chứ không phải khu trò chuyện; còn ở
              * đây nó neo cái đáy của khu chơi lại, nên khoảng trống giữa thẻ
              * bỏ phiếu và nó thành khoảng thở của một cái bàn thay vì một
              * mảng bỏ lửng. Nó tự đẩy mình xuống đáy bằng `mt-auto`.
              */}
            {snapshot && <RightMetaPanel snapshot={snapshot} />}
          </div>

          {/*
            * Cột phải chỉ tồn tại từ lg. Dưới đó nó từng bị đẩy xuống cuối trang,
            * sau cả nội dung pha lẫn danh sách người chơi - trong màn bỏ phiếu
            * khung chat rơi xuống quanh mốc 1800px. Trên điện thoại chat đi qua
            * MobileChatDock ở cuối file này thay vì nằm chờ cuối trang.
            *
            * Ở phòng chờ đây là hàng GIỮA của thanh điều khiển: voice rồi chat.
            * Nó nhận `1fr` của lưới, nên chat lấy trọn phần chiều cao mà thẻ
            * điều khiển và nút "Luật và vai trò" không dùng tới - không nhiều
            * hơn, không ít hơn.
            */}
          <div
            className={`hidden lg:order-none lg:flex lg:min-h-0 lg:flex-col lg:gap-3 ${
              isLobby ? "order-3 lg:col-start-2 lg:row-start-2" : ""
            }`}
          >
            <VoiceControl snapshot={snapshot} variant="panel" />
            {/*
              * Khung chat lấy TRỌN phần còn lại của cột chứ không bị chặn ở một
              * con số đoán trước - ở mọi pha, phòng chờ nay cũng vậy.
              *
              * Bản trước cho phòng chờ một trần `clamp(320px,42vh,560px)` vì
              * lúc đó cột phải là một tấm giấy dài tự do: không có trần thì
              * khung phình theo số tin nhắn và đẩy nhóm thiết lập xuống vô tận.
              * Giờ cột phải là ba hàng của một lưới cao đúng bằng màn hình, nên
              * phần "còn lại" đã là một con số có thật - và nó luôn đúng, kể cả
              * ở 768px chiều cao lẫn trên màn 1440 chiều cao, là hai chỗ mà mọi
              * hằng số đều lệch.
              */}
            {/* Sàn 320px chỉ dành cho trong ván, nơi cột phải không có gì khác
              * tranh chỗ. Ở phòng chờ một sàn cứng sẽ đẩy khung chat lòi khỏi
              * hàng của nó ngay khi voice bật lên trên màn cao 768px. */}
            <div className={`min-h-0 flex-1 ${isLobby ? "" : "lg:min-h-[320px]"}`}>
              <ChatBox
                heading={heading}
                messages={room.messages}
                onSend={(text) => room.emit("chat:send", { text })}
                composer={composer}
                channels={channels}
                markers={markers}
                emptyHint={chatEmpty}
                draft={chatDraft}
                onDraftChange={setChatDraft}
                mentionNames={mentionNames}
                meName={meName}
                quickPhrases={quickPhrases}
              />
            </div>
          </div>

          {/*
            * Chân thanh điều khiển: một cái nút mở ra toàn bộ thiết lập ván.
            *
            * Nó là con thứ tư của lưới chứ không phải nội dung nhét vào một cột
            * nào, vì khung chat phải chen vào GIỮA nó và thẻ điều khiển. Thứ tự
            * DOM ở đây trùng đúng thứ tự nhìn thấy, nên Tab đi từ thẻ điều
            * khiển sang chat rồi mới tới đây, y như mắt.
            *
            * Trên điện thoại không có gì chen vào giữa (chat đi qua
            * `MobileChatDock`), nên nó là thứ cuối cùng của một mạch đọc:
            * người chơi, điều khiển, rồi luật.
            */}
          {isLobby && snapshot && identity && (
            <div className="order-4 min-w-0 lg:order-none lg:col-start-2 lg:row-start-3">
              <LobbySettingsDrawer
                snapshot={snapshot}
                identity={identity}
                onUpdateConfig={(config) => room.emit("room:update-config", { config })}
              />
            </div>
          )}
        </div>
      </main>

      {/*
        * Voice là thao tác trực tiếp, không phải thông tin phụ.
        *
        * Bản trước nhét nó vào ĐẦU cột nội dung trên điện thoại, nên nó trôi đi
        * mất ngay khi người chơi cuộn xuống xem lưới bỏ phiếu - đúng lúc cần
        * bấm mic nhất. Giờ nó nổi cố định ở góc phải dưới, đối diện nút chat
        * (`bottom-4 left-4`), cùng một tầm ngón cái.
        *
        * Đứng cạnh `MobileChatDock` chứ không nằm trong lưới: cả hai đều là lớp
        * `fixed` phủ lên trang, và để chúng cạnh nhau trong DOM là cách duy
        * nhất còn đọc được thứ tự chồng lớp của chúng.
        */}
      <VoiceControl snapshot={snapshot} variant="dock" />

      <MobileChatDock
        messages={room.messages}
        onSend={(text) => room.emit("chat:send", { text })}
        composer={composer}
        channels={channels}
        markers={markers}
        emptyHint={chatEmpty}
        draft={chatDraft}
        onDraftChange={setChatDraft}
        selfId={snapshot?.you?.id ?? null}
        snapshot={snapshot}
        title={heading.title}
        mentionNames={mentionNames}
        meName={meName}
        quickPhrases={quickPhrases}
      />
    </VoiceProvider>
  );
}
