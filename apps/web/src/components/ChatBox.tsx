"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { GHOST_AUTHOR_ID, type ChatMessage } from "@masoi/shared";
import { getIdentity } from "@/lib/identity";
import { insertEmoji } from "@/lib/chat-emoji";
import { EmojiPicker } from "./EmojiPicker";

const CHANNEL_LABEL: Record<string, string> = {
  lobby: "Phòng",
  day: "Làng",
  wolves: "Sói",
  dead: "Người chết",
};

const CHANNEL_ICON: Record<string, string> = {
  lobby: "🏠",
  day: "☀️",
  wolves: "🐺",
  dead: "💀",
};

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

interface Props {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  placeholder?: string;
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
   * riêng, nên bỏ trống cặp prop này là khung không mọc thêm một cái đầu thứ
   * hai ngay dưới cái đầu kia.
   */
  title?: string;
  subtitle?: string;
}

/** Đúng bằng maxLength của ô nhập bên dưới - server cũng cắt ở mốc này. */
const MAX_MESSAGE_LENGTH = 300;

export function ChatBox({
  messages,
  onSend,
  placeholder,
  emptyHint,
  draft,
  onDraftChange,
  inputRef,
  autoFocus,
  onEmojiOpenChange,
  title,
  subtitle,
}: Props) {
  const [ownText, setOwnText] = useState("");
  const text = draft ?? ownText;
  const setText = onDraftChange ?? setOwnText;
  const boxRef = useRef<HTMLDivElement>(null);
  const meId = getIdentity()?.playerId;
  const [emojiOpen, setEmojiOpen] = useState(false);
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

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [messages.length]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
    // Gửi xong là hết câu: để bảng mở thì nó che mất chính dòng vừa gửi.
    changeEmojiOpen(false);
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

  return (
    // Chiều cao do chỗ đặt quyết định, không tự đặt max-h: ở cột phụ trên desktop
    // khung này phải cao hết màn, còn trên điện thoại thì bị bó lại 18rem.
    // min-h-0 là bắt buộc, thiếu nó thì flex item không co được và phần tin nhắn
    // tràn ra ngoài thay vì cuộn.
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-night-600/60 bg-night-900/70">
      {/*
        * Cột phải phải TỰ GIỚI THIỆU là khu chat.
        *
        * Trước đây thứ nằm trên cùng cột này là một thẻ thống kê phiếu, nên cả
        * cột đọc ra như một bảng số liệu có ô nhập chữ ở đáy. Dòng phụ nói KÊNH
        * đang gõ - thông tin an toàn quan trọng nhất trong khung này, vì người
        * chết đọc được cả kênh Sói lẫn kênh Làng - chứ không chép lại tiến độ
        * phiếu mà thanh pha đã in.
        */}
      {title && (
        <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-night-600/60 px-3 py-2">
          <h3 className="font-display text-base font-bold text-white">{title}</h3>
          {subtitle && <p className="truncate text-[13px] text-mist-strong">{subtitle}</p>}
        </div>
      )}
      {/*
        * overscroll-contain: trên điện thoại khung này nằm trong một tấm trượt
        * đè lên trang phòng. Thiếu nó thì vuốt tới đáy danh sách rồi vuốt tiếp
        * sẽ "xuyên" xuống trang phía sau, kéo trang trôi đi trong khi mắt vẫn
        * đang ở khung chat - và lúc đóng tấm trượt thì trang đã ở chỗ khác.
        */}
      <div
        ref={boxRef}
        className={`lobby-roster-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5 ${
          // Khung rỗng thì dồn nội dung vào GIỮA thay vì dán một dòng chữ xám ở
          // mép trên và bỏ trống 400px bên dưới - ở cột phải trên desktop đó là
          // khoảng trống lớn nhất của cả trang phòng chờ.
          messages.length === 0 ? "grid place-content-center" : "space-y-1.5"
        }`}
      >
        {messages.length === 0 && (
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
            <MessageCircleIcon
              className="mx-auto h-8 w-8 text-mist/55"
            />
            <p className="mt-2.5 text-sm font-semibold text-mist-bright">Chưa có tin nhắn nào</p>
            <p className="mt-1 text-[13px] leading-relaxed text-mist-strong">
              {emptyHint ?? "Hãy bắt đầu cuộc trò chuyện."}
            </p>
          </div>
        )}
        {messages.map((message) => {
          const mine = message.playerId === meId;
          // Lời nhắn ẩn danh phải TRÔNG khác một câu chat thường, nếu không
          // người chơi sẽ tưởng có một người tên "Một linh hồn" trong phòng.
          const ghost = message.playerId === GHOST_AUTHOR_ID;
          return (
            <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[88%] rounded-xl border px-3 py-2 ${
                  ghost
                    ? "border-violet-500/30 bg-violet-900/25 italic"
                    : mine
                      ? "bg-indigo-500/15 border-indigo-500/25"
                      : CHANNEL_STYLE[message.channel] ?? DEFAULT_CHANNEL_STYLE
                }`}
              >
                <div className="flex items-baseline gap-1.5">
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
                  <span
                    role="img"
                    className={`text-xs leading-none ${
                      message.channel === "wolves" ? "text-blood-400" : "text-mist-strong"
                    }`}
                    title={CHANNEL_LABEL[message.channel] ?? message.channel}
                    aria-label={CHANNEL_LABEL[message.channel] ?? message.channel}
                  >
                    {ghost ? "👻" : CHANNEL_ICON[message.channel] ?? "💬"}
                  </span>
                </div>
                {/* break-words: một chuỗi 300 ký tự không dấu cách sẽ đẩy toang cột phụ. */}
                <p className="break-words text-sm leading-relaxed text-mist-strong">{message.text}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 border-t border-night-600/60 p-2">
        {/*
          * Icon nằm chồng lên ô nhập chứ không đứng cạnh: đặt cạnh thì nó ăn
          * mất chiều ngang của ô, mà trên điện thoại ô này đã hẹp sẵn.
          * pointer-events-none để chạm vào icon vẫn là chạm vào ô nhập.
          */}
        <div className="relative min-w-0 flex-1">
          <MessageCircleIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-mist/55" />
          {/* pr-11 chừa chỗ cho nút biểu tượng nằm đè bên phải, y như pl-10
            * chừa chỗ cho bong bóng bên trái - thiếu nó thì chữ chui xuống dưới
            * nút đúng lúc câu vừa đủ dài. */}
          <input
            className="input pl-10 pr-11"
            ref={attachInput}
            autoFocus={autoFocus}
            aria-label="Nội dung tin nhắn"
            value={text}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder={placeholder ?? "Nhập tin nhắn..."}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <EmojiPicker
            open={emojiOpen}
            onOpenChange={changeEmojiOpen}
            onPick={pickEmoji}
            inputRef={ownInputRef}
          />
        </div>
        {/*
          * Nút Gửi lúc chưa gõ gì phải còn ĐỌC được.
          *
          * `.btn` mặc định hạ opacity xuống 40%: nền đỏ nhạt đi thành hồng
          * xám và chữ "Gửi" gần như biến mất - trông như một nút đang hỏng chứ
          * không phải một nút chưa tới lượt. Ba lớp disabled: dưới đây đổi hẳn
          * sang xám trung tính mà chữ vẫn rõ, cùng cách `.btn-cta` và
          * `.gate-cta` đã xử lý.
          */}
        <button
          className="btn-primary shrink-0 disabled:bg-night-700 disabled:text-mist-strong disabled:opacity-100 disabled:shadow-none"
          onClick={submit}
          disabled={!text.trim()}
        >
          Gửi
        </button>
      </div>
    </div>
  );
}
