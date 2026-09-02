"use client";

import { useMemo, useState } from "react";
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

  function apply(outcome: ShareOutcome) {
    setStatus(describeShareOutcome(outcome));
    setShowManual(outcome.kind === "manual");
  }

  async function handleShare() {
    setBusy(true);
    setStatus(null);
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
  }

  async function handleCopy() {
    setStatus(null);
    try {
      if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
        apply({ kind: "manual" });
        return;
      }
      await navigator.clipboard.writeText(model.shareText);
      apply({ kind: "copied" });
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
          <CardPreview model={model} />
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
            * đường lui khi máy không chia sẻ được, nên chúng là chữ chứ không
            * phải nút đặc. Bản cũ cho cả ba cùng một cỡ và "Chia sẻ hồ sơ" còn
            * mang đúng màu đỏ của nút chơi lại.
            */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-secondary min-h-11 w-full"
              onClick={handleShare}
              disabled={busy}
            >
              {busy ? "Đang dựng ảnh…" : "Chia sẻ kết quả"}
            </button>
            <button className="btn-tertiary min-h-11" onClick={handleDownload} disabled={busy}>
              Tải ảnh
            </button>
            <button className="btn-tertiary min-h-11" onClick={handleCopy} disabled={busy}>
              Sao chép tóm tắt
            </button>
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
    </section>
  );
}

/**
 * Bản xem trước của thẻ chia sẻ.
 *
 * Đọc CÙNG `model` với `paintCaseCard`, nên nội dung không thể lệch khỏi ảnh
 * xuất ra - đó là toàn bộ lý do model tồn tại. Tỷ lệ 9:16 và khung giới hạn
 * theo `max-w`, nên trên điện thoại nó không bao giờ vượt khỏi màn hình.
 */
function CardPreview({ model }: { model: CaseCardModel }) {
  const wolvesWin = model.winner === "wolves";
  const accent = wolvesWin ? "text-blood-400" : "text-emerald-300";

  return (
    <div
      className="flex w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-night-950"
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
  );
}
