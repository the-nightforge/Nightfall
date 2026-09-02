"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { GHOST_AUTHOR_ID, type ChatMessage } from "@masoi/shared";
import { getIdentity } from "@/lib/identity";
import { canSendMessage } from "@/lib/chat-draft";
import { insertEmoji } from "@/lib/chat-emoji";
import {
  CHAT_CHANNEL_META,
  channelMeta,
  type ChatChannelId,
  type ChatComposerState,
  type ChatHeading,
} from "@/lib/chat-channels";
import { buildChatTimeline, isNearBottom, type PhaseMarker } from "@/lib/chat-timeline";
import { EmojiPicker } from "./EmojiPicker";

/**
 * Nền bong bóng theo kênh.
 *
 * Kênh là thông tin an toàn quan trọng nhất trong khung này: người chết xem
 * được cả kênh Sói lẫn kênh Làng, và một dòng đọc nhầm kênh là đọc nhầm cả ván.
 * Nhãn chữ nhỏ ở bản cũ quá dễ lướt qua, nên màu nền mang luôn nghĩa đó.
 */
const CHANNEL_STYLE: Record<string, string> = {
  wolves: "bg-blood-600/15 border-blood-500/25",
  dead: "bg-night-800/60 border-white/[0.04]",
};
const DEFAULT_CHANNEL_STYLE = "bg-night-800/70 border-white/[0.05]";

/** Nhãn kênh gắn trên từng bong bóng, chỉ dùng khi khung đang trộn nhiều kênh. */
const CHANNEL_TAG_STYLE: Record<string, string> = {
  day: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  wolves: "border-blood-500/30 bg-blood-600/15 text-blood-400",
  dead: "border-violet-400/25 bg-violet-500/10 text-violet-200",
  lobby: "border-white/15 bg-white/[0.06] text-mist-strong",
};

/**
 * Bong bóng hội thoại đặt trong ô nhập.
 *
 * Vẽ tay thay vì kéo về một bộ icon: cả web mới chỉ cần đúng một hình này, và
 * thêm hẳn một dependency cho một thẻ <svg> thì phần tải về đắt hơn phần dùng.
 * Nét theo đúng dựng hình của Lucide MessageCircle (lưới 24, stroke 2) để sau
 * này có lắp bộ icon thật thì hình không nhảy.
 */
function MessageCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

/** Ổ khoá cho thanh soạn bị đóng. Cùng lưới 24 và stroke 2 với hình trên. */
function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

interface Props {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  /**
   * Quyền gửi ở pha hiện tại, tính từ snapshot bằng `chatComposerState`.
   *
   * Khung này cố ý KHÔNG tự suy ra quyền: nó không biết pha, không biết ai là
   * bị cáo, và mỗi lần luật đổi thì một khung chat tự đoán luật là một chỗ nữa
   * phải sửa. Server vẫn là nơi quyết định cuối cùng - phần này chỉ để người
   * chơi khỏi gõ xong một câu rồi mới nhận về dòng chữ đỏ.
   */
  composer: ChatComposerState;
  /**
   * Dòng gợi ý dưới "Chưa có tin nhắn nào".
   *
   * Khung này sống ở CẢ ba giai đoạn - phòng chờ, giữa ván, và sau khi hết ván -
   * nên một câu cố định là một câu sai ở hai trong ba chỗ: bản trước mời "chào
   * cả phòng một câu trong lúc chờ đủ người" ngay giữa pha bỏ phiếu. Chỗ đặt
   * biết đang ở pha nào, còn khung thì không, nên câu chữ đi từ ngoài vào. Bỏ
   * trống thì rơi về một câu đúng ở mọi pha.
   */
  emptyHint?: string;
  /**
   * Kênh CÓ MẶT trong danh sách đang truyền vào.
   *
   * Từ hai kênh trở lên thì khung mọc thêm hàng tab lọc và mỗi bong bóng đeo
   * nhãn kênh: đó là trường hợp người xem đã chết, họ đọc được cả kênh làng,
   * hang Sói lẫn kênh người chết trong CÙNG một danh sách. Một kênh thì nhãn
   * chỉ là tiếng ồn - tiêu đề khung đã nói đúng tên nó.
   */
  channels?: ChatChannelId[];
  /** Mốc đổi pha để chèn vạch ngăn giữa lịch sử cũ và phần đang diễn ra. */
  markers?: PhaseMarker[];
  /**
   * Bản nháp do bên ngoài giữ.
   *
   * Trên điện thoại khung này sống trong một tấm trượt đóng mở được, và tấm
   * trượt đóng lại là component bị tháo. Giữ chữ đang gõ trong state nội bộ thì
   * mỗi lần liếc ra ngoài xem lưới người chơi là mất câu đang viết dở. Bỏ trống
   * cặp prop này thì khung tự giữ nháp như cũ.
   */
  draft?: string;
  onDraftChange?: (draft: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
  /**
   * Bảng biểu tượng vừa mở hay vừa đóng.
   *
   * Chỉ tấm trượt chat trên điện thoại cần biết: nó bắt Escape ở pha capture
   * để tự đóng, nên nếu không biết bảng đang mở thì một phím Escape sẽ đóng
   * luôn cả khung chat thay vì chỉ đóng bảng.
   */
  onEmojiOpenChange?: (open: boolean) => void;
  /**
   * Tiêu đề khung chat, chỉ dùng ở cột phải trên desktop.
   *
   * Trên điện thoại khung này sống trong tấm trượt vốn đã có thanh tiêu đề
   * riêng, nên bỏ trống prop này là khung không mọc thêm một cái đầu thứ hai
   * ngay dưới cái đầu kia.
   */
  heading?: ChatHeading;
}

/** Đúng bằng maxLength của ô nhập bên dưới - server cũng cắt ở mốc này. */
const MAX_MESSAGE_LENGTH = 300;

const ALL_CHANNELS = "all" as const;
type ChannelFilter = ChatChannelId | typeof ALL_CHANNELS;

export function ChatBox({
  messages,
  onSend,
  composer,
  emptyHint,
  channels,
  markers,
  draft,
  onDraftChange,
  inputRef,
  autoFocus,
  onEmojiOpenChange,
  heading,
}: Props) {
  const [ownText, setOwnText] = useState("");
  const text = draft ?? ownText;
  const setText = onDraftChange ?? setOwnText;
  const boxRef = useRef<HTMLDivElement>(null);
  const meId = getIdentity()?.playerId;
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [filter, setFilter] = useState<ChannelFilter>(ALL_CHANNELS);
  /*
   * Ref nội bộ, LUÔN có, bên cạnh cái tuỳ chọn do bên ngoài truyền vào.
   *
   * Chèn biểu tượng cần đọc vị trí con trỏ trên chính thẻ input, mà `inputRef`
   * chỉ có mặt khi khung này nằm trong tấm trượt điện thoại - ở cột phải trên
   * desktop nó là undefined. Không có ref riêng thì biểu tượng chỉ chèn được
   * vào cuối chuỗi, và chỉ trên một nửa số chỗ khung này xuất hiện.
   */
  const ownInputRef = useRef<HTMLInputElement>(null);
  const attachInput = useCallback(
    (el: HTMLInputElement | null) => {
      ownInputRef.current = el;
      if (inputRef) inputRef.current = el;
    },
    [inputRef],
  );

  const changeEmojiOpen = useCallback(
    (open: boolean) => {
      setEmojiOpen(open);
      onEmojiOpenChange?.(open);
    },
    [onEmojiOpenChange],
  );

  const tabs = channels ?? [];
  const multiChannel = tabs.length > 1;
  // Tab đang chọn biến mất khi luật đọc đổi (người chết vào GAME_OVER chẳng
  // hạn); rơi về "Tất cả" thay vì hiển thị một danh sách rỗng không lối ra.
  const activeFilter: ChannelFilter =
    filter !== ALL_CHANNELS && !tabs.includes(filter) ? ALL_CHANNELS : filter;

  const visible = useMemo(
    () =>
      activeFilter === ALL_CHANNELS
        ? messages
        : messages.filter((message) => message.channel === activeFilter),
    [messages, activeFilter],
  );
  const items = useMemo(() => buildChatTimeline(visible, markers ?? []), [visible, markers]);

  /*
   * Chỉ tự cuộn khi người đọc ĐANG ở đáy.
   *
   * Bản cũ cuộn xuống đáy mỗi lần danh sách dài ra. Trong pha biện hộ đó là
   * đúng lúc người chơi cuộn ngược lên đọc lại xem ai đã bỏ phiếu cho bị cáo -
   * và mỗi câu mới lại giật họ về đáy. Giờ ai đang đọc lịch sử thì được yên,
   * đổi lại có một nút "Tin nhắn mới" để quay xuống.
   */
  const stickRef = useRef(true);
  const [hasNew, setHasNew] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = boxRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    stickRef.current = true;
    setHasNew(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    stickRef.current = isNearBottom(el);
    if (stickRef.current) setHasNew(false);
  }, []);

  useEffect(() => {
    if (stickRef.current) scrollToBottom();
    else if (visible.length > 0) setHasNew(true);
  }, [visible.length, scrollToBottom]);

  // Đổi tab là một hành động CHỦ ĐỘNG: người chơi vừa chọn xem kênh nào thì
  // họ muốn thấy dòng mới nhất của kênh đó, không phải chỗ cuộn của kênh cũ.
  useEffect(() => {
    scrollToBottom();
  }, [activeFilter, scrollToBottom]);

  const submit = () => {
    // Cùng một luật với thuộc tính `disabled` của nút Gửi - Enter không đi qua
    // cái nút, nên hai đường phải hỏi chung một hàm. `composer.canSend` là vế
    // thứ hai: nó khoá cả hai đường trong pha biện hộ.
    if (!composer.canSend || !canSendMessage(text)) return;
    onSend(text.trim());
    setText("");
    // Gửi xong là hết câu: để bảng mở thì nó che mất chính dòng vừa gửi.
    changeEmojiOpen(false);
    scrollToBottom();
  };

  const pickEmoji = (emoji: string) => {
    const el = ownInputRef.current;
    const next = insertEmoji(
      text,
      emoji,
      el?.selectionStart ?? text.length,
      el?.selectionEnd ?? text.length,
      MAX_MESSAGE_LENGTH,
    );
    // null = đã chạm trần 300 ký tự. Im lặng bỏ qua, đúng như khi gõ thêm một
    // ký tự vào ô đã đầy.
    if (!next) return;
    setText(next.text);
    /*
     * Đặt lại con trỏ ở khung hình SAU khi React đã ghi value mới xuống DOM.
     * Gọi ngay ở đây thì setSelectionRange chạy trên chuỗi cũ, rồi React ghi
     * đè value và trình duyệt ném con trỏ về cuối - biểu tượng chèn giữa câu
     * đúng chỗ nhưng lần chèn tiếp theo lại nhảy xuống cuối.
     */
    requestAnimationFrame(() => {
      if (!el) return;
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  const destination = composer.channel ? CHAT_CHANNEL_META[composer.channel] : null;

  return (
    // Chiều cao do chỗ đặt quyết định, không tự đặt max-h: ở cột phụ trên desktop
    // khung này phải cao hết màn, còn trên điện thoại thì bị bó lại 18rem.
    // min-h-0 là bắt buộc, thiếu nó thì flex item không co được và phần tin nhắn
    // tràn ra ngoài thay vì cuộn.
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-night-600/60 bg-night-900/70">
      {/*
        * Tiêu đề nói đúng thứ ĐANG HIỂN THỊ bên dưới nó.
        *
        * Đây là lỗi cũ của cả màn hình: đầu khung in kênh mà người xem GỬI VÀO
        * ("Kênh người chết") rồi bên dưới liệt kê cả kênh làng lẫn hang Sói -
        * người chơi đọc ra là những người còn sống đang nhắn trong kênh người
        * chết. Kênh gửi giờ nằm ở thanh soạn dưới đáy, đúng chỗ nó có nghĩa.
        */}
      {heading && (
        <div className="shrink-0 border-b border-night-600/60 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-display text-base font-bold text-white">{heading.title}</h3>
            <p className="truncate text-[13px] text-mist-strong">{heading.subtitle}</p>
          </div>
        </div>
      )}

      {/*
        * Tab lọc chỉ mọc ra khi khung THẬT SỰ trộn nhiều kênh - tức là người
        * xem đã chết, hoặc ván đã kết thúc. Một tab đơn độc không lọc được gì.
        */}
      {multiChannel && (
        <div
          role="tablist"
          aria-label="Lọc theo kênh chat"
          className="flex shrink-0 flex-wrap gap-1 border-b border-night-600/60 px-2 py-1.5"
        >
          {([ALL_CHANNELS, ...tabs] as ChannelFilter[]).map((tab) => {
            const selected = tab === activeFilter;
            const label = tab === ALL_CHANNELS ? "Tất cả" : CHAT_CHANNEL_META[tab].label;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setFilter(tab)}
                className={`rounded-full border px-2.5 py-1 text-[13px] font-semibold transition ${
                  selected
                    ? "border-white/25 bg-white/[0.12] text-white"
                    : "border-white/[0.08] bg-transparent text-mist-strong hover:border-white/20 hover:text-white"
                }`}
              >
                {tab !== ALL_CHANNELS && (
                  <span aria-hidden="true" className="mr-1">
                    {CHAT_CHANNEL_META[tab].icon}
                  </span>
                )}
                {label}
              </button>
            );
          })}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/*
          * overscroll-contain: trên điện thoại khung này nằm trong một tấm trượt
          * đè lên trang phòng. Thiếu nó thì vuốt tới đáy danh sách rồi vuốt tiếp
          * sẽ "xuyên" xuống trang phía sau, kéo trang trôi đi trong khi mắt vẫn
          * đang ở khung chat - và lúc đóng tấm trượt thì trang đã ở chỗ khác.
          */}
        <div
          ref={boxRef}
          onScroll={handleScroll}
          className={`lobby-roster-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5 ${
            // Khung rỗng thì dồn nội dung vào GIỮA thay vì dán một dòng chữ xám ở
            // mép trên và bỏ trống 400px bên dưới - ở cột phải trên desktop đó là
            // khoảng trống lớn nhất của cả trang phòng chờ.
            items.length === 0 ? "grid place-content-center" : "space-y-1.5"
          }`}
        >
          {items.length === 0 && (
            <div className="px-4 py-6 text-center">
              {/*
                * /55 chứ không phải /35.
                *
                * Nét icon ở /35 trộn ra khoảng #3f4b61 trên nền #0b1120, tức là
                * tương phản 2.1:1 - dưới mức 3:1 cho hình đồ hoạ, và trên màn
                * hình chỉnh tối một chút thì nó biến mất hẳn: khung rỗng trông
                * như chỉ có hai dòng chữ. /55 đưa lên khoảng 3.5:1, bằng đúng
                * icon trong ô nhập ngay bên dưới, mà vẫn nhạt hơn hai dòng chữ
                * nên thứ tự đọc không đổi.
                */}
              <MessageCircleIcon className="mx-auto h-8 w-8 text-mist/55" />
              <p className="mt-2.5 text-sm font-semibold text-mist-bright">Chưa có tin nhắn nào</p>
              <p className="mt-1 text-[13px] leading-relaxed text-mist-strong">
                {emptyHint ?? "Hãy bắt đầu cuộc trò chuyện."}
              </p>
            </div>
          )}

          {items.map((item) => {
            if (item.kind === "divider") {
              /*
                * Vạch ngăn giữa lịch sử và phần đang diễn ra.
                *
                * Không có nó thì mấy câu cãi nhau từ pha thảo luận nằm sát ngay
                * trên lời biện hộ đầu tiên, và người mới liếc vào tưởng cả làng
                * vẫn đang nói trong lúc bị cáo tự bào chữa.
                */
              return (
                <div key={item.key} className="flex items-center gap-2 py-1.5" role="separator">
                  <span aria-hidden="true" className="h-px flex-1 bg-white/[0.09]" />
                  <span className="shrink-0 rounded-full border border-white/[0.09] bg-night-800/80 px-2.5 py-0.5 text-[12px] font-semibold text-mist-bright">
                    {item.label}
                  </span>
                  <span aria-hidden="true" className="h-px flex-1 bg-white/[0.09]" />
                </div>
              );
            }

            const message = item.message;
            const mine = message.playerId === meId;
            // Lời nhắn ẩn danh phải TRÔNG khác một câu chat thường, nếu không
            // người chơi sẽ tưởng có một người tên "Một linh hồn" trong phòng.
            const ghost = message.playerId === GHOST_AUTHOR_ID;
            const meta = channelMeta(message.channel);
            return (
              <div key={item.key} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[88%] rounded-xl border px-3 py-2 ${
                    ghost
                      ? "border-violet-500/30 bg-violet-900/25 italic"
                      : mine
                        ? "bg-indigo-500/15 border-indigo-500/25"
                        : CHANNEL_STYLE[message.channel] ?? DEFAULT_CHANNEL_STYLE
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                    {/*
                      * Tên người gửi và nội dung phải TÁCH được ra khỏi nhau.
                      *
                      * Bản cũ để tên ở trắng và nội dung ở mist/95 - gần như cùng
                      * một sắc, nên trong một khung dài mắt không tìm ra được mép
                      * trên của từng tin mà phải đọc tuần tự. Giờ tên là trắng
                      * đậm, nội dung là mist-strong (vẫn 10:1 trên nền bong bóng,
                      * trên ngưỡng AA), và khoảng cách giữa hai bậc đủ để lướt.
                      */}
                    <span
                      className={`text-[13px] font-bold ${
                        ghost ? "text-violet-200" : mine ? "text-indigo-200" : "text-white"
                      }`}
                    >
                      {message.playerName}
                    </span>
                    {multiChannel ? (
                      /*
                        * Khi khung trộn nhiều kênh thì nhãn phải là CHỮ, không
                        * phải một icon 12px. Người chết đọc kênh làng, hang Sói
                        * và kênh người chết trong cùng một dòng thời gian; phân
                        * biệt chúng bằng một hình nhỏ xíu là để người chơi tự
                        * đoán, mà đoán sai ở đây là đọc nhầm cả ván.
                        */
                      <span
                        className={`shrink-0 rounded border px-1.5 py-px text-[12px] font-semibold ${
                          CHANNEL_TAG_STYLE[message.channel] ?? CHANNEL_TAG_STYLE.lobby
                        }`}
                      >
                        <span aria-hidden="true" className="mr-1">
                          {ghost ? "👻" : meta.icon}
                        </span>
                        {meta.label}
                      </span>
                    ) : (
                      <span
                        role="img"
                        className={`text-xs leading-none ${
                          message.channel === "wolves" ? "text-blood-400" : "text-mist-strong"
                        }`}
                        title={meta.label}
                        aria-label={meta.label}
                      >
                        {ghost ? "👻" : meta.icon}
                      </span>
                    )}
                  </div>
                  {/* break-words: một chuỗi 300 ký tự không dấu cách sẽ đẩy toang cột phụ. */}
                  <p className="break-words text-sm leading-relaxed text-mist-strong">
                    {message.text}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/*
          * Nút quay về đáy, chỉ hiện khi có dòng mới mà người đọc đang ở trên.
          * Nổi trên danh sách chứ không chiếm chỗ: nó là một trạng thái thoáng
          * qua, và một hàng cao 32px nhấp nháy vào ra sẽ làm cả khung giật.
          */}
        {hasNew && (
          <button
            type="button"
            onClick={() => scrollToBottom("smooth")}
            className="absolute inset-x-0 bottom-2 mx-auto w-max rounded-full border border-white/15 bg-night-800/95 px-3 py-1.5 text-[13px] font-semibold text-mist-bright shadow-lg shadow-black/50 backdrop-blur transition hover:border-white/30 hover:text-white"
          >
            <span aria-hidden="true" className="mr-1">↓</span> Tin nhắn mới
          </button>
        )}
      </div>

      <div className="shrink-0 border-t border-night-600/60 p-2">
        {/*
          * Thanh soạn LUÔN nói tin nhắn sẽ đi đâu, hoặc vì sao không đi được
          * đâu cả. Đây là nửa còn lại của việc tách kênh: tiêu đề nói mình
          * đang ĐỌC gì, dòng này nói mình đang GỬI vào đâu.
          */}
        {composer.canSend && destination ? (
          <p className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[12px] text-mist-strong">
            <span aria-hidden="true">{destination.icon}</span>
            Gửi vào <b className="font-semibold text-mist-bright">{destination.longLabel}</b>
          </p>
        ) : (
          <p
            className="mb-1.5 flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-950/25 px-2 py-1.5 text-[13px] leading-snug text-amber-100"
            role="status"
          >
            <LockIcon className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{composer.reason}</span>
          </p>
        )}

        <div className="flex gap-2">
          {/*
            * Icon nằm chồng lên ô nhập chứ không đứng cạnh: đặt cạnh thì nó ăn
            * mất chiều ngang của ô, mà trên điện thoại ô này đã hẹp sẵn.
            * pointer-events-none để chạm vào icon vẫn là chạm vào ô nhập.
            */}
          <div className="relative min-w-0 flex-1">
            {composer.canSend ? (
              <MessageCircleIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-mist/55" />
            ) : (
              <LockIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-mist/55" />
            )}
            {/* pr-11 chừa chỗ cho nút biểu tượng nằm đè bên phải, y như pl-10
              * chừa chỗ cho bong bóng bên trái - thiếu nó thì chữ chui xuống dưới
              * nút đúng lúc câu vừa đủ dài. */}
            {/*
              * Placeholder sáng hơn mặc định của `.input`.
              *
              * `.input` đặt `placeholder:text-mist/55` cho cả trang, đo được
              * 3.36:1 trên nền ô nhập - dưới ngưỡng AA 4.5:1 cho chữ thường.
              * /75 đưa lên 5.09:1. Chỉ nâng ở ô chat chứ không sửa `.input`:
              * lớp đó còn dùng cho các ô số trong Cài đặt nâng cao và cho ô tải
              * ảnh, nên đổi nó là đổi cả những màn hình không nằm trong vòng này.
              * Chữ thật vẫn là trắng nguyên (15:1) nên không có nguy cơ nhầm
              * placeholder với nội dung đã nhập.
              */}
            <input
              className={`input placeholder:text-mist/75 ${composer.canSend ? "pl-10 pr-11" : "pl-10 pr-3"}`}
              ref={attachInput}
              autoFocus={autoFocus}
              aria-label="Nội dung tin nhắn"
              /*
               * `disabled` chứ không phải readOnly hay một lớp CSS mờ đi: ô bị
               * khoá phải rơi hẳn khỏi thứ tự Tab, nếu không người dùng bàn
               * phím vẫn nhảy vào được một ô mà mọi phím gõ đều vô nghĩa.
               */
              disabled={!composer.canSend}
              value={text}
              maxLength={MAX_MESSAGE_LENGTH}
              placeholder={composer.placeholder}
              onChange={(e) => setText(e.target.value)}
              /*
               * `e.repeat` chặn phím Enter bị giữ: nó bắn ra hàng chục lần
               * keydown mỗi giây, và tuy ô đã bị xoá sau lần gửi đầu, chặn ngay
               * ở đây rẻ hơn là dựa vào thứ tự cập nhật state.
               */
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.repeat) submit();
              }}
            />
            {composer.canSend && (
              <EmojiPicker
                open={emojiOpen}
                onOpenChange={changeEmojiOpen}
                onPick={pickEmoji}
                inputRef={ownInputRef}
              />
            )}
          </div>
          {/*
            * Nút Gửi lúc chưa gõ gì phải còn ĐỌC được, mà vẫn không mời bấm.
            *
            * `.btn` mặc định hạ opacity xuống 40%: nền đỏ nhạt đi thành hồng
            * xám và chữ "Gửi" gần như biến mất - trông như một nút đang hỏng chứ
            * không phải một nút chưa tới lượt. Nên các lớp dưới đây đổi hẳn sang
            * nền trung tính và giữ opacity 1, cùng cách `.btn-cta` và `.gate-cta`
            * đã xử lý.
            *
            * night-800 chứ không phải night-700. Đo trên nền khung chat: night-700
            * sáng hơn chính ô nhập bên cạnh (1.19:1), nên nó đọc ra như một khối
            * NỔI LÊN - tức là bấm được. night-800 nằm ngang mặt ô nhập (1.02:1)
            * nên cả cụm đọc ra là một hàng nhập liệu đang chờ chữ; vòng viền mảnh
            * giữ cho nó vẫn ra hình một cái nút chứ không thành một lỗ thủng.
            * Chữ ở `mist` vẫn 8.1:1 - đọc thoải mái, mà nhạt hơn hẳn chữ trắng
            * trên nền đỏ của trạng thái bấm được.
            *
            * Không cần chặn hover: `.btn-primary:hover` nằm ở tầng component còn
            * các lớp `disabled:` nằm ở tầng utility phía sau, nên utility thắng.
            * Đã kiểm bằng computed style khi con trỏ đang ở trên nút tắt.
            */}
          <button
            type="button"
            className="btn-primary shrink-0 disabled:bg-night-800 disabled:text-mist disabled:opacity-100 disabled:shadow-none disabled:ring-1 disabled:ring-inset disabled:ring-white/10"
            onClick={submit}
            disabled={!composer.canSend || !canSendMessage(text)}
          >
            Gửi
          </button>
        </div>
      </div>
    </div>
  );
}
