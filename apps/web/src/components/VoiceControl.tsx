"use client";

import { useMemo } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { useVoiceContext } from "@/components/VoiceProvider";
import type { VoiceUi } from "@/lib/voice-state";

/**
 * Dock voice chat. Chỉ hiển thị - trạng thái do `VoiceProvider` giữ.
 *
 * Được vẽ HAI LẦN trong một trang: bản `dock` nổi ở đáy cho điện thoại, bản
 * `panel` nằm trong cột điều khiển bên phải cho desktop. Cả hai đọc cùng một
 * context, nên vẫn chỉ có MỘT kết nối LiveKit - hai kết nối cùng một danh tính
 * sẽ thay nhau đá nhau. Có test khoá đúng điều đó.
 *
 * Hình mẫu là thanh voice của Discord, vì nó giải quyết đúng bài toán ở đây:
 * control quan trọng nhất phòng phải luôn trong tầm ngón cái và nói được trạng
 * thái của mình mà không cần đọc chữ. Nhưng chỉ mượn CẤU TRÚC - màu vẫn là
 * bảng màu đêm của game, và emerald "đang nói" là màu sẵn có ở lưới người chơi.
 */

type Variant = "dock" | "panel";

/** Nút mic tắt phải nhận ra được mà không cần đọc chữ: gạch chéo, không chỉ đổi màu. */
function MicIcon({ slashed }: { slashed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
      <path
        d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z"
        fill="currentColor"
        opacity={slashed ? 0.55 : 1}
      />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {slashed && (
        <path
          data-mic-slash=""
          d="M4 3.5 20 20.5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

type Tone = "live" | "warn" | "muted" | "bad";

interface Status {
  label: string;
  tone: Tone;
}

/**
 * Một câu ngắn cho biết kênh thoại đang ở đâu.
 *
 * `reconnecting` được hỏi TRƯỚC `mode` vì nó chồng lên hai mode khác nhau -
 * đang xin token lại, và LiveKit tự vá đường truyền giữa lúc đang nói. Người
 * chơi cần biết cùng một điều trong cả hai: tiếng đang không đi tới đâu cả.
 */
function statusOf(ui: VoiceUi): Status {
  if (ui.mode === "duplicate") return { label: "Đang dùng ở tab khác", tone: "bad" };
  if (ui.mode === "error") return { label: "Mất kết nối thoại", tone: "bad" };
  if (ui.reconnecting) return { label: "Đang kết nối lại", tone: "warn" };
  if (ui.mode === "connecting") return { label: "Đang kết nối", tone: "warn" };
  if (ui.mode === "unblock-audio") return { label: "Chạm để nghe", tone: "warn" };
  if (ui.mode === "join") return { label: "Chưa vào kênh thoại", tone: "muted" };
  if (ui.mode === "listen") return { label: "Chỉ nghe", tone: "muted" };
  return { label: "Đã kết nối", tone: "live" };
}

const DOT: Record<Tone, string> = {
  live: "bg-emerald-400",
  warn: "bg-amber-400 animate-pulse",
  muted: "bg-mist/45",
  bad: "bg-blood-500",
};

const CHIP: Record<Tone, string> = {
  live: "border-emerald-400/30 text-mist-strong",
  warn: "border-amber-400/40 text-amber-100",
  muted: "border-night-600 text-mist",
  bad: "border-blood-500/50 text-blood-400",
};

function StatusChip({ status, hint }: { status: Status; hint: string | null }) {
  return (
    <div
      // Người dùng trình đọc màn hình phải biết kênh thoại vừa rớt mà không
      // phải đi tìm - nhưng `polite` để nó không cắt ngang lời ai đang nói.
      aria-live="polite"
      className={`inline-flex max-w-[15rem] items-center gap-2 rounded-full border bg-night-900/90 px-3 py-1.5 text-xs backdrop-blur ${CHIP[status.tone]}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[status.tone]}`} aria-hidden="true" />
      <span className="truncate">{status.label}</span>
      {hint && <span className="sr-only">. {hint}</span>}
    </div>
  );
}

/** Nút tròn phụ: ngắt kênh, đổi chế độ bấm. Cùng kích thước ở cả hai biến thể. */
function GhostButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-9 items-center justify-center rounded-full border border-night-600 bg-night-800/90 px-3 text-xs font-medium text-mist backdrop-blur transition hover:border-night-600 hover:text-mist-bright"
    >
      {children}
    </button>
  );
}

export function VoiceControl({
  snapshot,
  variant = "panel",
}: {
  snapshot: RoomSnapshot | null;
  variant?: Variant;
}) {
  const voice = useVoiceContext();
  const ui: VoiceUi = voice?.ui ?? { visible: false, mode: "join", reconnecting: false };
  const micOpen = voice?.micOpen ?? false;
  const micError = voice?.micError ?? null;
  const micMode = voice?.micMode ?? "ptt";
  const noop = () => undefined;
  const toggleMic = voice?.toggleMic ?? noop;
  const setMicMode = voice?.setMicMode ?? noop;
  const activate = voice?.activate ?? noop;
  const leave = voice?.leave ?? noop;
  const holdStart = voice?.holdStart ?? noop;
  const holdEnd = voice?.holdEnd ?? noop;

  const hint = useMemo(() => {
    /*
     * Lỗi mic đứng TRƯỚC mọi gợi ý khác, vì nó là thứ duy nhất ở đây đang chờ
     * người dùng làm gì đó. Kể từ khi vòng retry bị bỏ, mic không tự thử lại
     * nữa - dock im lặng nghĩa là người chơi ngồi trước một nút mic không chịu
     * bật mà không biết vì sao.
     */
    if (micError) return micError;
    switch (ui.mode) {
      case "listen":
        return snapshot?.you?.alive === false
          ? "Bạn đã chết - chỉ nghe được, người sống không nghe thấy bạn"
          : "Lượt này bạn không được nói";
      case "duplicate":
        return "Kênh thoại đã chuyển sang tab khác của bạn";
      case "error":
        return "Không giữ được kênh thoại. Ván vẫn chạy bình thường bằng chat.";
      default:
        return null;
    }
  }, [micError, ui.mode, snapshot?.you?.alive]);

  if (!snapshot || !ui.visible) return null;

  const status = micError ? { label: "Mic đang lỗi", tone: "bad" as const } : statusOf(ui);
  const isDock = variant === "dock";

  /**
   * Bốn mode dưới đây không có mic để bấm - chỉ có một lời mời bấm.
   *
   * Gộp chúng vào một nhánh thay vì bốn khối rời: chúng khác nhau đúng một câu
   * chữ, và tách ra là bốn chỗ để quên đồng bộ hình dáng nút.
   */
  const prompt =
    ui.mode === "join"
      ? { text: "Vào kênh thoại", onClick: activate }
      : ui.mode === "unblock-audio"
        ? { text: "Chạm để nghe", onClick: activate }
        : ui.mode === "duplicate"
          ? { text: "Dùng kênh thoại ở tab này", onClick: activate }
          : ui.mode === "error"
            ? { text: "Thử kết nối lại", onClick: activate }
            : null;

  // Đỏ + gạch chéo là "đang tắt", theo đúng quy ước mà ai dùng app thoại nào
  // cũng đã đọc được sẵn. Sáng đặc là "đang phát".
  const micTone = micOpen
    ? "bg-emerald-400 text-night-950 ring-2 ring-emerald-300/40 shadow-lg shadow-emerald-500/20"
    : "border border-blood-500/60 bg-blood-500/15 text-blood-400";
  const micSize = isDock ? "h-14 w-14" : "h-12 w-12";
  const micLabel = micOpen
    ? micMode === "ptt"
      ? "Mic đang bật, thả ra để tắt"
      : "Mic đang bật, chạm để tắt"
    : micMode === "ptt"
      ? "Mic đang tắt, giữ để nói"
      : "Mic đang tắt, chạm để bật";

  const micButton =
    ui.mode === "talk" ? (
      <button
        type="button"
        aria-label={micLabel}
        aria-pressed={micOpen}
        title={micLabel}
        className={`inline-flex ${micSize} shrink-0 items-center justify-center rounded-full transition ${micTone}`}
        {...(micMode === "ptt"
          ? {
              // pointer* bắt được cả chuột lẫn cảm ứng bằng một đường. Thiếu
              // pointercancel/leave là mic kẹt mở khi trình duyệt cướp con trỏ.
              onPointerDown: holdStart,
              onPointerUp: holdEnd,
              onPointerCancel: holdEnd,
              onPointerLeave: holdEnd,
              onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
            }
          : // Chạm bật/tắt dùng onClick: một cú chạm là một lần lật, không phụ
            // thuộc ngón tay có xê dịch hay không.
            { onClick: toggleMic })}
      >
        <MicIcon slashed={!micOpen} />
      </button>
    ) : null;

  const modeSwitch =
    ui.mode === "talk" ? (
      <GhostButton
        label={
          micMode === "ptt" ? "Chuyển sang chạm bật/tắt mic" : "Chuyển sang giữ nút để nói"
        }
        onClick={() => setMicMode(micMode === "ptt" ? "toggle" : "ptt")}
      >
        {micMode === "ptt" ? "Giữ" : "Chạm"}
      </GhostButton>
    ) : null;

  // Ngắt chỉ có nghĩa khi còn thứ để ngắt. Ở `join`/`error` thì nó là một nút
  // không làm gì, và một nút không làm gì cạnh nút quan trọng nhất là một cái bẫy.
  const leaveButton =
    ui.mode === "talk" || ui.mode === "listen" ? (
      <GhostButton label="Ngắt kênh thoại" onClick={leave}>
        Ngắt
      </GhostButton>
    ) : null;

  if (isDock) {
    /*
     * Chip trạng thái KHÔNG hiện khi nó chỉ nhắc lại cái nút ngay dưới nó.
     *
     * Ở `join` chip nói "Chưa vào kênh thoại" và nút nói "Vào kênh thoại"; ở
     * `unblock-audio` cả hai cùng nói "Chạm để nghe". Trên điện thoại hai thứ
     * đó xếp chồng ngay trên nút Bắt đầu, và chụp lại trên iPhone thì cụm nổi
     * ở đáy cao gần bằng nửa màn hình, che luôn "Thêm bot để chơi thử". Bỏ chip
     * đi thì dock còn đúng một hàng. `duplicate` và `error` vẫn giữ chip: ở đó
     * chip nói CHUYỆN GÌ đã xảy ra, còn nút nói cách thoát ra.
     */
    const chipRedundant =
      !micError && prompt !== null && (ui.mode === "join" || ui.mode === "unblock-audio");
    /*
     * Đỏ chỉ dành cho lúc kênh thoại HỎNG.
     *
     * Bản cũ tô đỏ cả lời mời "Vào kênh thoại" - trong app này đỏ là màu của
     * CTA và của cảnh báo, nên một nút đỏ rực ở góc phải nổi hơn cả nút Bắt
     * đầu đang xám, và người chơi đọc nó như một việc đang gấp. Lời mời bình
     * thường dùng đúng hình của nút Chat ở góc đối diện.
     */
    const promptTone =
      ui.mode === "duplicate" || ui.mode === "error"
        ? "bg-blood-500 text-white hover:bg-blood-400"
        : "border border-night-600 bg-night-800/95 text-mist backdrop-blur hover:border-mist/40 hover:text-white";
    return (
      <div
        data-voice-dock=""
        /* Nút chat nổi ở `bottom-4 left-4`, nên dock ngồi phía đối diện và xếp
         * DỌC: chồng chip trạng thái lên trên hàng nút giữ cho hàng dưới hẹp,
         * đủ để ở 320px nó không bao giờ chạm vào nút chat. Trang đã chừa
         * `pb-28` nên không đè lên nút cuối trang. */
        className="fixed bottom-4 right-4 z-40 mb-[env(safe-area-inset-bottom)] flex flex-col items-end gap-2 lg:hidden"
      >
        {!chipRedundant && <StatusChip status={status} hint={micError ? null : hint} />}
        {micError && (
          <p className="max-w-[15rem] rounded-xl border border-blood-500/40 bg-night-900/95 px-3 py-2 text-right text-[11px] leading-snug text-blood-400 backdrop-blur">
            {micError}
          </p>
        )}
        <div className="flex items-center gap-2">
          {modeSwitch}
          {leaveButton}
          {micButton}
          {prompt && (
            <button
              type="button"
              onClick={prompt.onClick}
              className={`inline-flex h-12 items-center gap-1.5 rounded-full px-4 text-sm font-semibold shadow-lg shadow-black/40 transition ${promptTone}`}
            >
              {/* `MicIcon` ngay trên file này, không phải emoji cái micro như trước:
                * nút mic thật ở ngay cạnh đã dùng hình đó, nên hai thứ nói về
                * cùng một cái mic mà vẽ bằng hai bộ nét khác nhau. Emoji cũng
                * không nhận `currentColor` nên nó không đổi màu theo
                * `promptTone`. */}
              <MicIcon slashed={false} />
              {prompt.text}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <StatusChip status={status} hint={null} />
        {leaveButton}
      </div>

      {ui.mode === "talk" && (
        <div className="flex items-center gap-3">
          {micButton}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-mist-strong">
              {micOpen ? "Đang nói" : micMode === "ptt" ? "Giữ để nói" : "Mic đang tắt"}
            </p>
            <p className="truncate text-xs text-mist/85">
              {micMode === "ptt" ? "Giữ nút mic để phát" : "Chạm nút mic để bật/tắt"}
            </p>
          </div>
          {modeSwitch}
        </div>
      )}

      {prompt && (
        <button type="button" className="btn-primary w-full gap-1.5" onClick={prompt.onClick}>
          {/* Cùng lý do với bản ở dock ngay trên: một bộ nét cho cả web. */}
          <MicIcon slashed={false} />
          {prompt.text}
        </button>
      )}

      {hint && (
        <p className={`text-xs ${micError ? "text-blood-400" : "text-mist/85"}`}>{hint}</p>
      )}
    </div>
  );
}
