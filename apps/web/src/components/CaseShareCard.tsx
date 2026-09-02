"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CaseFile } from "@masoi/shared";
import { buildCaseCardModel, type CaseCardModel } from "@/lib/case-card";
import { CARD_HEIGHT, CARD_WIDTH, paintCaseCard, type CardFonts } from "@/lib/case-canvas";
import {
  classifyShareError,
  describeShareOutcome,
  pickShareStrategy,
  shareCapabilities,
  type ShareOutcome,
} from "@/lib/case-share";
import { useModalFocus } from "@/lib/useModalFocus";

/**
 * Font cho canvas.
 *
 * `next/font` sinh ra tên họ font đã băm, nên không đoán được lúc viết code -
 * phải đọc đúng biến CSS mà layout đã gán. Luôn kèm font dự phòng: canvas không
 * báo lỗi khi tên font sai, nó chỉ lặng lẽ vẽ bằng font mặc định.
 */
function resolveFonts(): CardFonts {
  const fallback = { display: "Georgia, serif", sans: "system-ui, sans-serif" };
  if (typeof window === "undefined") return fallback;
  try {
    const style = getComputedStyle(document.documentElement);
    const display = style.getPropertyValue("--font-display").trim();
    const sans = style.getPropertyValue("--font-sans").trim();
    return {
      display: display ? `${display}, ${fallback.display}` : fallback.display,
      sans: sans ? `${sans}, ${fallback.sans}` : fallback.sans,
    };
  } catch {
    return fallback;
  }
}

/*
 * Icon vẽ tay theo lưới Lucide 24 / stroke 2 - cùng cách `MessageCircleIcon`
 * của ChatBox làm. Cả web chỉ cần đúng ba hình này, và kéo về một bộ icon cho
 * ba thẻ <svg> thì phần tải về đắt hơn phần dùng.
 *
 * `aria-hidden` ở mọi hình: nhãn nút đã nói đủ, để trình đọc màn hình đọc thêm
 * một cái tên hình là đọc hai lần cùng một điều.
 */
function Glyph({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? "h-4 w-4 shrink-0"}
    >
      {children}
    </svg>
  );
}

function DownloadIcon() {
  return (
    <Glyph>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </Glyph>
  );
}

function CopyIcon() {
  return (
    <Glyph>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Glyph>
  );
}

function CheckIcon() {
  return (
    <Glyph>
      <path d="M20 6 9 17l-5-5" />
    </Glyph>
  );
}

function ExpandIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </Glyph>
  );
}

function CloseIcon() {
  return (
    <Glyph>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </Glyph>
  );
}

/** Vẽ thẻ ra PNG. Trả `null` khi trình duyệt không dựng được ảnh - không ném. */
async function renderPng(model: CaseCardModel): Promise<File | null> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Vẽ trước khi font tải xong thì được một tấm ảnh bằng font dự phòng, và
    // tiếng Việt có dấu là chỗ lộ ra rõ nhất.
    if (typeof document.fonts?.ready?.then === "function") await document.fonts.ready;

    paintCaseCard(ctx, model, resolveFonts());

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/png");
    });
    if (!blob) return null;
    return new File([blob], `ho-so-vu-an-${model.caseId}.png`, { type: "image/png" });
  } catch {
    // Safari cũ và máy hết bộ nhớ đều rơi vào đây. Mất ảnh không được làm mất
    // luôn đường chia sẻ, nên chỉ trả null và để chỗ gọi tụt xuống nhánh text.
    return null;
  }
}

export function CaseShareCard({ file, shareOrigin }: { file: CaseFile; shareOrigin: string }) {
  const model = useMemo(() => buildCaseCardModel(file, { shareOrigin }), [file, shareOrigin]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  /*
   * Xác nhận ngắn ngay TRÊN nút vừa bấm.
   *
   * Dòng trạng thái bên dưới là chỗ trình đọc màn hình nghe được, nhưng bằng
   * mắt nó ở cách nút một quãng và dễ trôi khỏi tầm nhìn trên điện thoại: bấm
   * "Sao chép tóm tắt" xong, thứ duy nhất người dùng nhìn là chính cái nút đó,
   * và nếu nó không đổi gì thì không có gì nói rằng máy đã nhận lệnh. Vì vậy
   * nhãn nút đổi thành "Đã sao chép" một nhịp ngắn rồi trả về như cũ.
   *
   * Hẹn giờ giữ trong ref và dọn khi tháo component: người chơi bấm "Về phòng
   * chờ" ngay sau khi chép thì cả màn này biến mất trước lúc timer nổ.
   */
  const [done, setDone] = useState<"copy" | "download" | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * Xem ảnh lớn.
   *
   * Bản xem trước rộng 256px, mà thẻ thật là 1080x1920: chữ trong đó co xuống
   * quanh 8px và không ai đọc nổi điểm ngoặt nào trước khi bấm gửi đi. Lớp phủ
   * vẽ ĐÚNG tấm ảnh sẽ được chia sẻ, ở cỡ lớn nhất mà khung nhìn chịu được.
   */
  const [zoomed, setZoomed] = useState(false);
  const previewRef = useRef<HTMLButtonElement>(null);

  useEffect(
    () => () => {
      if (doneTimer.current !== null) clearTimeout(doneTimer.current);
    },
    [],
  );

  function flashDone(which: "copy" | "download") {
    if (doneTimer.current !== null) clearTimeout(doneTimer.current);
    setDone(which);
    doneTimer.current = setTimeout(() => setDone(null), 2200);
  }

  function apply(outcome: ShareOutcome) {
    setStatus(describeShareOutcome(outcome));
    setShowManual(outcome.kind === "manual");
  }

  async function handleShare() {
    setBusy(true);
    setStatus(null);
    setDone(null);
    const image = await renderPng(model);
    const capabilities = shareCapabilities(typeof navigator === "undefined" ? undefined : navigator, image);
    const strategy = pickShareStrategy(capabilities);

    let outcome: ShareOutcome;
    try {
      if (strategy === "files" && image) {
        await navigator.share({ files: [image], title: model.shareTitle, text: model.shareText });
        outcome = { kind: "shared" };
      } else if (strategy === "text") {
        await navigator.share({ title: model.shareTitle, text: model.shareText, url: model.url });
        outcome = { kind: "shared" };
      } else if (strategy === "clipboard") {
        await navigator.clipboard.writeText(model.shareText);
        outcome = { kind: "copied" };
      } else {
        outcome = { kind: "manual" };
      }
    } catch (error) {
      outcome = classifyShareError(error);
    }

    setBusy(false);
    apply(outcome);
  }

  async function handleDownload() {
    setBusy(true);
    setStatus(null);
    setDone(null);
    const image = await renderPng(model);
    setBusy(false);
    if (!image) {
      apply({ kind: "error", message: "Không tạo được ảnh trên trình duyệt này. Bạn vẫn sao chép được tóm tắt." });
      return;
    }
    const url = URL.createObjectURL(image);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = image.name;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Đã tải ảnh hồ sơ về máy.");
    flashDone("download");
  }

  async function handleCopy() {
    setStatus(null);
    setDone(null);
    try {
      if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
        apply({ kind: "manual" });
        return;
      }
      await navigator.clipboard.writeText(model.shareText);
      apply({ kind: "copied" });
      flashDone("copy");
    } catch {
      apply({ kind: "manual" });
    }
  }

  return (
    <section className="card" aria-labelledby="case-share-heading">
      {/*
        * Hai cột dựng bằng flex-wrap chứ KHÔNG bằng breakpoint màn hình.
        *
        * Thẻ này sống trong cột giữa của bàn chơi, và bề rộng cột đó không đi
        * theo bề rộng viewport: ở lg cột chỉ còn ~460px trong khi ở md (một
        * cột) nó rộng hơn 700px. Một `sm:flex-row` sẽ bật hai cột đúng vào lúc
        * chật nhất. Với `flex-wrap` + basis cố định, hai cột chỉ đứng cạnh nhau
        * khi CHỖ THẬT SỰ CÒN, và tự xuống dòng khi không.
        *
        * Bản cũ để bản xem trước 9:16 nằm giữa một thẻ toàn chiều ngang, nên
        * trên desktop hai bên nó là hai mảng trống bằng cả bề rộng tấm ảnh.
        */}
      <div className="flex flex-wrap items-start justify-center gap-4">
        <div className="w-[256px] max-w-full shrink-0">
          <CardPreview model={model} triggerRef={previewRef} onOpen={() => setZoomed(true)} />
        </div>

        <div className="min-w-[14rem] flex-1 space-y-3 self-center">
          <div>
            <h3 id="case-share-heading" className="font-display text-lg font-bold text-white">
              Chia sẻ kết quả
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-mist-strong">
              Ảnh hồ sơ {model.caseId} kèm những điểm ngoặt của ván, sẵn sàng đăng lên nhóm chat.
            </p>
          </div>

          {/*
            * Ba nút, ba hạng. Chia sẻ là hành động hạng hai của cả màn - hạng
            * nhất là nút về phòng chờ ở trên - còn tải ảnh và sao chép chỉ là
            * đường lui khi máy không chia sẻ được. Bản cũ cho cả ba cùng một cỡ
            * và "Chia sẻ hồ sơ" còn mang đúng màu đỏ của nút chơi lại.
            *
            * Hai đường lui KHÔNG còn là `.btn-tertiary` nữa. Hạng ba đúng nghĩa
            * ở chỗ khác - "Rời phòng", "Xem chi tiết kỹ thuật" - nhưng ở đây
            * chúng nằm ngay dưới một đoạn chữ `text-mist-strong` cùng cỡ, nên
            * một dòng chữ nhạt không viền không nền đọc ra như phần đuôi của
            * đoạn văn chứ không như thứ bấm được. `.btn-ghost` cho chúng một
            * viền mảnh và một vùng bấm 40px thấy được, mà vẫn nhẹ hơn hẳn nút
            * "Chia sẻ kết quả" nền đặc ngay trên.
            *
            * Hai nút chia hàng theo ĐỘ DÀI NHÃN, không chia đôi: "Sao chép tóm
            * tắt" dài gấp đôi "Tải ảnh", nên chia đều thì ở khung 390px nhãn dài
            * gãy làm hai dòng trong khi nút bên cạnh còn thừa chỗ. Cơ sở rộng
            * hơn cho nút dài, và cả hai vẫn tự xuống dòng thành hai hàng khi cột
            * hẹp hơn tổng cơ sở - vùng chạm không bao giờ bị bóp lại.
            */}
          <div className="space-y-2">
            <button
              className="btn-secondary min-h-11 w-full"
              onClick={handleShare}
              disabled={busy}
            >
              {busy ? "Đang dựng ảnh…" : "Chia sẻ kết quả"}
            </button>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-ghost flex-1 basis-28"
                onClick={handleDownload}
                disabled={busy}
              >
                {done === "download" ? <CheckIcon /> : <DownloadIcon />}
                {done === "download" ? "Đã tải ảnh" : "Tải ảnh"}
              </button>
              <button className="btn-ghost flex-[2] basis-44" onClick={handleCopy} disabled={busy}>
                {done === "copy" ? <CheckIcon /> : <CopyIcon />}
                {done === "copy" ? "Đã sao chép" : "Sao chép tóm tắt"}
              </button>
            </div>
          </div>

          {status && (
            <p className="text-sm text-mist-strong" role="status" aria-live="polite">
              {status}
            </p>
          )}

          {showManual && (
            <textarea
              className="input h-32 font-mono text-[13px]"
              readOnly
              value={model.shareText}
              aria-label="Tóm tắt hồ sơ để sao chép thủ công"
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
        </div>
      </div>

      {zoomed && (
        <CardZoom model={model} triggerRef={previewRef} onClose={() => setZoomed(false)} />
      )}
    </section>
  );
}

/**
 * Lớp phủ xem ảnh lớn.
 *
 * Vẽ bằng CHÍNH `paintCaseCard` chứ không phóng to bản xem trước: mọi cỡ chữ
 * trong bản xem trước đều là hằng số px cho khung 256, nên kéo nó ra 480 thì
 * chữ vẫn nhỏ y như cũ, chỉ có khoảng trắng là to lên. Canvas thì vẽ lại ở
 * 1080x1920 rồi để trình duyệt thu về vừa khung nhìn - đó cũng đúng là tấm ảnh
 * mà nút "Tải ảnh" và "Chia sẻ kết quả" gửi đi, nên không có gì lệch được.
 *
 * Không dựng blob hay object URL: một `<canvas>` vẽ thẳng không có gì để rò rỉ
 * và không có nhánh lỗi nào để xử lý.
 *
 * `useModalFocus` lo Escape, bẫy Tab, `inert` phần trang phía sau và trả focus
 * về đúng bản xem trước - cùng cơ chế mà lớp phủ mã QR đang dùng.
 *
 * PHẢI đi qua portal ra `document.body`. Thẻ chia sẻ là một `.card`, và `.card`
 * có `backdrop-blur` - một phần tử có `backdrop-filter` trở thành khối chứa của
 * mọi con cháu `position: fixed` bên trong nó. Để lớp phủ nằm tại chỗ thì
 * `inset-0` của nó là mép THẺ chứ không phải mép màn hình: nền mờ chỉ phủ đúng
 * cái thẻ, ảnh bị kẹp trong bề ngang cột, và nút Đóng rơi ra ngoài khung nhìn.
 * Cùng lý do đó, cột giữa `overflow-y-auto` cũng sẽ cắt cụt lớp phủ.
 *
 * Đọc thẳng `document.body` mà không rào bằng cờ "đã mount": component này chỉ
 * được dựng sau một cú bấm, nên nó không bao giờ có mặt trong lần render trên
 * máy chủ. Rào bằng một cờ bật ở effect còn HỎNG hơn - lần render đầu trả về
 * `null` thì `panelRef` còn rỗng, `useModalFocus` (chỉ chạy lại theo `active`)
 * thấy vùng bẫy rỗng rồi thoát, và lớp phủ mở ra không có bẫy Tab, không có
 * Escape, không có `inert`.
 */
function CardZoom({
  model,
  triggerRef,
  onClose,
}: {
  model: CaseCardModel;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useModalFocus({
    active: true,
    roots: [panelRef],
    initialFocus: closeRef,
    restoreTo: triggerRef,
    onEscape: onClose,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let cancelled = false;
    const paint = () => {
      if (cancelled) return;
      paintCaseCard(ctx, model, resolveFonts());
    };

    // Vẽ ngay một lần để lớp phủ không mở ra trên một ô đen, rồi vẽ lại khi font
    // đã sẵn sàng - tiếng Việt có dấu là chỗ font dự phòng lộ ra rõ nhất.
    paint();
    if (typeof document.fonts?.ready?.then === "function") {
      document.fonts.ready.then(paint).catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [model]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/85 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="flex max-h-full min-h-0 flex-col items-center gap-3"
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-zoom-title"
      >
        <h2 id="case-zoom-title" className="sr-only">
          Ảnh hồ sơ vụ án {model.caseId}
        </h2>

        {/*
          * Ảnh co theo CẢ HAI cạnh, và cạnh nào chật trước thì cạnh đó thắng.
          *
          * Thẻ là 9:16 - cao gần gấp đôi bề ngang - nên ở desktop 1440x900 cạnh
          * chật là chiều CAO, còn ở điện thoại 390 thì lại là chiều ngang. Một
          * `max-w-full` đơn độc để tấm ảnh cao 1920px tràn qua đáy màn hình,
          * còn một `max-h` đơn độc thì ở màn hẹp nó thò ra hai bên.
          *
          * `min-h-0` ở đây là điều kiện để `max-h-full` có nghĩa: mặc định một
          * món trong flex column không co xuống dưới kích thước nội dung của
          * chính nó, nên thiếu nó thì canvas vẫn giữ nguyên 1920px và đẩy nút
          * Đóng ra khỏi khung nhìn. Nút Đóng thì `shrink-0` để phần phải nhường
          * chỗ luôn là tấm ảnh.
          *
          * `object-contain` giữ tỷ lệ khi ô co lại - canvas là phần tử thay thế,
          * và không có nó thì nội dung vẽ bị kéo méo thay vì thu nhỏ.
          */}
        <canvas
          ref={canvasRef}
          width={CARD_WIDTH}
          height={CARD_HEIGHT}
          role="img"
          aria-label={`Ảnh hồ sơ vụ án ${model.caseId}: ${model.headline}, ${model.subline}`}
          className="min-h-0 max-h-full w-auto max-w-full rounded-xl border border-white/10 object-contain shadow-2xl"
        />

        <button ref={closeRef} className="btn-secondary min-h-11 shrink-0 px-5" onClick={onClose}>
          <CloseIcon />
          Đóng
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Bản xem trước của thẻ chia sẻ.
 *
 * Đọc CÙNG `model` với `paintCaseCard`, nên nội dung không thể lệch khỏi ảnh
 * xuất ra - đó là toàn bộ lý do model tồn tại. Tỷ lệ 9:16 và khung giới hạn
 * theo `max-w`, nên trên điện thoại nó không bao giờ vượt khỏi màn hình.
 *
 * Cả tấm là một cái NÚT, không phải một hình trang trí có thêm nút phóng to
 * lẩn trong góc: ở 256px thì chỗ duy nhất người dùng chỉ vào là chính tấm ảnh,
 * và một vùng bấm 256x455 thì không thể trượt tay. Bên trong nút là chữ thuần
 * và `<div>`, không có phần tử bấm được nào khác, nên không có nút lồng nút.
 *
 * Trình đọc màn hình chỉ nghe NHÃN của nút - toàn bộ ruột thẻ vẫn `aria-hidden`
 * như cũ, vì mọi câu trong đó đã được đọc một lần ở hồ sơ vụ án phía trên.
 */
function CardPreview({
  model,
  triggerRef,
  onOpen,
}: {
  model: CaseCardModel;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
}) {
  const wolvesWin = model.winner === "wolves";
  const accent = wolvesWin ? "text-blood-400" : "text-emerald-300";

  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={onOpen}
      // Nhãn nói rõ bấm vào thì ĐƯỢC GÌ. "Xem trước" là mô tả cái đang thấy,
      // không phải lời hứa của một hành động.
      aria-label={`Xem ảnh lớn hồ sơ vụ án ${model.caseId}`}
      className="group block w-full cursor-zoom-in text-left"
    >
      <div
        className="flex w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-night-950 transition group-hover:border-white/30 group-focus-visible:border-white/30"
        style={{ aspectRatio: "9 / 16" }}
        // Ảnh xuất ra mang đúng nội dung này, nên trình đọc màn hình không cần
        // đọc lại toàn bộ thẻ một lần thứ hai.
        aria-hidden="true"
      >
      <div
        className="flex-1 overflow-hidden px-4 pt-5"
        style={{
          background: wolvesWin
            ? "radial-gradient(340px 200px at 50% 12%, rgba(220, 38, 64, 0.30), transparent 70%)"
            : "radial-gradient(340px 200px at 50% 12%, rgba(52, 178, 140, 0.26), transparent 70%)",
        }}
      >
        <p className="text-center text-[8px] font-semibold uppercase tracking-[0.3em] text-mist/70">
          Hồ sơ vụ án
        </p>
        <p className={`text-center text-[13px] font-bold ${accent}`}>{model.caseId}</p>
        <p className="mt-2 text-center font-display text-[20px] font-extrabold leading-tight text-white">
          {model.headline}
        </p>
        <p className="text-center text-[9px] text-mist/70">{model.subline}</p>
        <div className={`mx-auto mt-2 h-px w-12 ${wolvesWin ? "bg-blood-500" : "bg-emerald-500"}`} />

        <ul className="mt-3 space-y-2">
          {model.lines.map((line, index) => (
            <li key={`${line.moment}-${index}`}>
              <p className={`text-[7px] font-bold uppercase tracking-widest ${accent}`}>
                {line.moment}
              </p>
              <p className="font-display text-[11px] font-bold leading-snug text-white">
                {line.title}
              </p>
              <p className="break-words text-[8px] leading-snug text-mist/75">{line.text}</p>
            </li>
          ))}
        </ul>
      </div>

        <div className="bg-night-800 px-4 py-2.5 text-center">
          <p className="font-display text-[11px] font-bold text-white">{model.cta}</p>
          <p className="break-all text-[8px] text-mist/70">{model.url}</p>
        </div>
      </div>

      {/*
        * Nhãn "Xem ảnh lớn" nằm DƯỚI tấm thẻ, không đè lên nó.
        *
        * Một dải nhãn phủ lên đáy ảnh che mất đúng chân thẻ - chỗ có lời mời và
        * địa chỉ trang - và bản xem trước thì sinh ra để cho thấy TOÀN BỘ tấm
        * ảnh sắp gửi đi. Ở đây nó là một dòng chú thích, không lấy đi pixel nào
        * của nội dung.
        *
        * Luôn hiện, không đợi rê chuột: trên điện thoại không có trạng thái
        * hover nào để chờ, và một tấm ảnh im lặng thì không có gì nói rằng nó
        * bấm được. Rê chuột chỉ làm nó sáng thêm.
        */}
      <span
        aria-hidden="true"
        className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-mist-strong transition group-hover:text-white"
      >
        <ExpandIcon className="h-3.5 w-3.5 shrink-0" />
        Xem ảnh lớn
      </span>
    </button>
  );
}
