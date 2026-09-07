"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CaseFile, CaseLastLetter, RoomSnapshot } from "@masoi/shared";
import { playbackMode, readPlaybackInputs } from "@/lib/cinematic-settings";
import { hasWebgl2 } from "@/lib/cinematic-webgl";
import { useModalFocus } from "@/lib/useModalFocus";
import {
  buildVillageMemory,
  villageLegend,
  type VillageLegendEntry,
  type VillageStep,
} from "@/lib/village-memory";
import {
  INTRO_POSITION,
  atFirstPosition,
  atLastPosition,
  autoplayEnabled,
  durationFor,
  isIntro,
  playbackTick,
  positionAfter,
  progressAnnouncement,
  progressLabel,
  rendererState,
  stepAt,
} from "@/lib/village-memory-playback";
/*
 * Bảng màu đến từ module RIÊNG, không từ `village-memory-webgl`.
 *
 * Trước đây hai hằng số này `import` thẳng từ file dựng cảnh, và một import
 * tĩnh là một cạnh trong đồ thị module: cả nghìn dòng dựng Three.js đi vào chunk
 * của component này, tức là vào lượt tải của cả những người rơi về bản 2D.
 * `buildVillageScene` giờ chỉ tới được qua `import()` động trong
 * `VillageMemoryCanvas`, và có test canh đúng điều đó.
 */
import { EFFECT_HEX, hexToCss } from "@/lib/village-memory-palette";
import { VillageMemoryCanvas } from "./VillageMemoryCanvas";
import { VillageRoster } from "./VillageRoster";

/**
 * Câu mở màn.
 *
 * Nói người xem SẮP thấy gì, không nói lại điều họ vừa đọc ở màn kết thúc ván.
 * Thanh tiêu đề ngay phía trên đã mang tên trải nghiệm, phe thắng và quy mô
 * trận, và nó nằm đó suốt cả trải nghiệm - nên cảnh mở đầu không in lại chúng
 * lần thứ hai, nó chỉ thêm phần còn thiếu.
 */
const INTRO_DESCRIPTION = "Nhìn lại những khoảnh khắc đã thay đổi số phận ngôi làng.";

interface Props {
  snapshot: RoomSnapshot;
  file: CaseFile;
  /** Nút đã mở dialog. Focus quay về đúng nó lúc đóng. */
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

/**
 * "Hồi ức Ngôi Làng" - dialog toàn màn hình ở GAME_OVER.
 *
 * Chỉ được dựng SAU một cú bấm (`GameOverView` nạp nó bằng `next/dynamic`), nên
 * cả component này lẫn `three` đều không có mặt trong luồng chơi bình thường.
 *
 * Chia việc rạch ròi với hai module bên dưới: model (`village-memory`) quyết
 * định có gì để xem, `VillageMemoryCanvas` lo vòng đời GPU, còn ở đây là
 * accessible dialog, trạng thái phát và toàn bộ CHỮ.
 *
 * Mọi chữ - tên, vai, phe, tiêu đề bước, mô tả, nội dung thư - đều nằm trong
 * DOM chứ không dựng bằng 3D text. Không phải để tiện: một dòng chữ trong
 * canvas thì trình đọc màn hình không thấy, không chọn được, không phóng to
 * theo cỡ chữ hệ thống, và tiếng Việt có dấu là chỗ font dự phòng vỡ trước
 * nhất. Đó cũng là lý do lớp phủ này vẫn đủ dùng khi bản 3D không dựng được.
 */
export function VillageMemoryExperience({ snapshot, file, triggerRef, onClose }: Props) {
  const model = useMemo(() => buildVillageMemory(snapshot, file), [snapshot, file]);

  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /*
   * Đọc thiết lập MỘT LẦN lúc mở.
   *
   * Cùng thang đo với chuyển cảnh trong ván: `playbackMode` đã cân cả cờ hệ
   * thống `prefers-reduced-motion` lẫn công tắc "Giảm chuyển cảnh" trong game,
   * và nó ghi rõ vì sao hai thứ đó không gộp được. Đọc lại từ đầu ở đây sẽ tạo
   * ra một bản sao thứ hai của cùng một luật.
   */
  const [reduced] = useState(() => playbackMode(readPlaybackInputs()) === "none");
  /*
   * Khả năng dựng 3D cũng hỏi một lần.
   *
   * KHÔNG dùng `canUseWebgl` như cảnh chuyển pha: hàm đó từ chối cả khi người
   * dùng bật Save-Data hay giảm chuyển động, đúng cho một cảnh TỰ ĐỘNG chạy.
   * Ở đây người xem vừa bấm một cái nút ghi rõ "3D", nên từ chối họ vì một
   * thiết lập băng thông là trả lời sai câu hỏi họ vừa hỏi. Giảm chuyển động
   * thì vẫn dựng, chỉ là camera không lia - xem `cameraGlide`.
   */
  const [webgl2] = useState(() => hasWebgl2());
  const [failed, setFailed] = useState(false);

  const steps = model?.steps ?? [];
  /*
   * Vị trí, không phải chỉ số bước: `INTRO_POSITION` là cảnh toàn cảnh mở màn.
   *
   * Bản đầu khởi tạo `0`, nên bước ngoặt đầu tiên đập thẳng vào mặt người vừa
   * bấm nút - `VillageMemoryCanvas` và bản dựng cảnh đều đã nhận `step === null`
   * cho cảnh toàn cảnh, nhưng không có đường nào đi tới trạng thái đó. Mọi câu
   * hỏi về con số `-1` đều nằm trong `village-memory-playback`; ở đây chỉ gọi
   * tên chúng.
   */
  const [position, setPosition] = useState(INTRO_POSITION);
  const [playing, setPlaying] = useState(() => autoplayEnabled(reduced) && steps.length > 0);

  const mode = rendererState({ open: true, webgl2, failed, contextLost: false });
  const step: VillageStep | null = stepAt(steps, position);
  const intro = isIntro(position);

  useModalFocus({
    active: true,
    roots: [panelRef],
    initialFocus: closeRef,
    restoreTo: triggerRef,
    onEscape: onClose,
  });

  const onFail = useCallback(() => setFailed(true), []);

  // Tự phát. `setTimeout` chứ không phải một vòng `rAF`: nhịp ở đây là NĂM GIÂY,
  // và một bộ đếm chạy 60 lần mỗi giây để chờ một mốc năm giây là lãng phí
  // thuần tuý - kể cả khi bản 2D đang chạy và không có vòng vẽ nào cả.
  useEffect(() => {
    if (!playing || steps.length === 0) return;
    const timer = setTimeout(() => {
      const next = playbackTick({ position, playing }, steps.length);
      setPosition(next.position);
      setPlaying(next.playing);
      // Cảnh mở đầu giữ màn hình ngắn hơn một bước ngoặt - nó không kể chuyện
      // gì, nó chỉ đặt người xem xuống trước ngôi làng.
    }, durationFor(position));
    return () => clearTimeout(timer);
  }, [playing, position, steps.length]);

  // Tab bị ẩn thì tạm dừng luôn phần phát, không chỉ vòng vẽ: quay lại sau ba
  // phút mà thấy replay đã chạy hết và dừng ở cảnh cuối là mất trắng nội dung.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const goto = useCallback(
    (delta: number) => {
      // Bấm tay là một ý định điều khiển: dừng tự phát chứ không tranh nhau với
      // bộ đếm rồi nhảy hai bước một lúc.
      setPlaying(false);
      setPosition((current) => positionAfter(current, steps.length, delta));
    },
    [steps.length],
  );

  if (!model || steps.length === 0) return null;

  const accent = hexToCss(EFFECT_HEX[step?.effect ?? "GENERIC"]);
  const atStart = atFirstPosition(position);
  const atEnd = atLastPosition(position, steps.length);
  // MỘT bảng nhà cho cả hai chế độ hiển thị - xem `villageLegend`.
  const legend = villageLegend(model.houses, step);
  // Thư không ghép chắc chắn được vào bước nào thì hiện ở PHẦN KẾT - đúng một
  // lần, ở cảnh cuối, chứ không lặp lại dưới mọi bước.
  const letters: CaseLastLetter[] = atEnd
    ? [...(step?.letters ?? []), ...model.epilogueLetters]
    : (step?.letters ?? []);

  return createPortal(
    <div className="fixed inset-0 z-50 h-[100dvh] bg-night-950">
      {/*
        * flex-col + min-h-0 là điều kiện để bản mobile không vỡ: khung 3D được
        * phép CO LẠI, còn thanh tiêu đề và tấm chú thích thì `shrink-0`. Thiếu
        * `min-h-0` thì canvas giữ nguyên chiều cao nội dung và đẩy hết nút điều
        * khiển ra ngoài màn hình 390x844.
        *
        * `dvh` chứ không phải `vh`: trên trình duyệt di động `vh` đo theo khung
        * nhìn LỚN NHẤT - tức là lúc thanh địa chỉ đã trượt đi - nên một dialog
        * cao `100vh` thò xuống dưới thanh địa chỉ đúng bằng chiều cao của nó, và
        * thứ bị đẩy ra ngoài là hàng nút ở đáy.
        */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="village-memory-title"
        className="flex h-full w-full flex-col"
        /*
         * Vùng an toàn nằm ở LỚP TRONG, không phải lớp `bg-night-950` bên ngoài.
         *
         * Từ khi layout khai `viewport-fit=cover`, `env(safe-area-inset-*)` đổi
         * từ 0 sang giá trị thật. Đó chính là thứ ta muốn cho cái nền: nó phải
         * tràn lên dưới tai thỏ, nếu không thì đỉnh màn hình là một dải trắng
         * cắt ngang một khung cảnh ban đêm. Nhưng NỘI DUNG thì không: thanh
         * tiêu đề chỉ có `py-3`, mỏng hơn hẳn thanh trạng thái, nên nút "Đóng"
         * sẽ nằm lọt dưới đó và không bấm được.
         *
         * Cả bốn cạnh chứ không riêng trên-dưới: hàng nút điều khiển có biến
         * thể `phone-landscape:`, tức là màn này được dùng khi cầm máy ngang -
         * và ở tư thế đó tai thỏ nằm ở CẠNH BÊN, đúng chỗ ba nút phát/tua.
         */
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.08] px-4 py-3 sm:px-6">
          <div className="min-w-0">
            {/*
              * `truncate` trên chính tiêu đề, không chỉ trên dòng phụ.
              *
              * Ở cỡ chữ bình thường nó không đổi gì cả - "Hồi ức Ngôi Làng" vừa
              * một dòng. Nhưng khi người dùng phóng cỡ chữ lên 200% trên màn
              * 320px, cột chữ này chỉ còn hơn trăm pixel bề ngang và bốn chữ ấy
              * xuống thành BỐN DÒNG: thanh tiêu đề phình lên 293px, tức hơn nửa
              * màn hình, và thứ bị đẩy ra ngoài đáy là hàng nút điều khiển. Cắt
              * bớt một cái tên mà giữ được nút bấm là một đánh đổi dễ.
              */}
            <h2
              id="village-memory-title"
              className="truncate font-display text-lg font-bold text-white sm:text-xl"
            >
              {model.title}
            </h2>
            <p className="truncate text-[13px] text-mist-strong">
              {model.winnerLabel} · {model.subtitle}
            </p>
          </div>
          <button ref={closeRef} className="btn-secondary min-h-11 shrink-0 px-4" onClick={onClose}>
            Đóng
          </button>
        </header>

      {/*
        * Điện thoại NẰM NGANG đổi sang hai cột.
        *
        * Ở 844x390, một cột dọc để lại cho khung 3D chừng 150px chiều cao sau
        * khi trừ thanh tiêu đề và tấm chú thích - và một ngôi làng đóng khung
        * trong một dải cao 150px thì nhỏ tới mức không xem được. Xoay bố cục
        * thành hai cột trả lại cho nó cả chiều cao màn hình.
        *
        * Điều kiện có CẢ chiều cao chứ không chỉ `orientation`: desktop 1440x900
        * cũng là khung ngang, và ở đó một cột dọc mới là bố cục đúng.
        */}
        <div className="flex min-h-0 flex-1 flex-col phone-landscape:flex-row">
        <div className="relative min-h-0 flex-1">
          {mode === "webgl" ? (
            <VillageMemoryCanvas model={model} step={step} reduced={reduced} onFail={onFail} />
          ) : (
            /*
             * Bản dự phòng 2D: bảng nhà CHÍNH LÀ ngôi làng, nên nó chiếm cả
             * khung. Không có màn đen, và không có một bảng thứ hai được viết
             * riêng cho đường này - cùng `VillageRoster`, chỉ khác bố cục.
             */
            <div className="h-full overflow-y-auto px-4 py-4 sm:px-6">
              <VillageRoster entries={legend} accent={accent} layout="wide" />
            </div>
          )}
        </div>

        <StepPanel
          accent={accent}
          step={step}
          intro={intro}
          introDescription={INTRO_DESCRIPTION}
          letters={letters}
          progress={progressLabel(position, steps.length)}
          progressLabelText={progressAnnouncement(position, steps.length)}
          playing={playing}
          atStart={atStart}
          atEnd={atEnd}
          onPrev={() => goto(-1)}
          onNext={() => goto(1)}
          onToggle={() => setPlaying((value) => !value)}
          /*
           * Khi 3D đang chạy, bảng nhà là lớp thông tin DUY NHẤT nói được nhà
           * nào của ai: mô hình không dựng chữ, và mấy vòng màu dưới chân nhà
           * thì người mù màu không đọc được. Ở đường 2D bảng đã nằm trên kia
           * rồi nên không lặp lại.
           */
          roster={
            mode === "webgl" ? (
              <VillageRoster entries={legend} accent={accent} layout="compact" />
            ) : null
          }
        />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Tấm chú thích và bộ điều khiển.
 *
 * DÙNG CHUNG cho cả bản 3D lẫn bản 2D - đó là điều làm đường lui trở thành một
 * đường lui thật chứ không phải một màn hình lỗi có nút đóng.
 *
 * `aria-live="polite"`: bước tự đổi sau mỗi năm giây, và người dùng trình đọc
 * màn hình phải nghe được nội dung mới mà không phải đi tìm.
 */
function StepPanel({
  accent,
  step,
  intro,
  introDescription,
  letters,
  progress,
  progressLabelText,
  playing,
  atStart,
  atEnd,
  roster,
  onPrev,
  onNext,
  onToggle,
}: {
  accent: string;
  step: VillageStep | null;
  intro: boolean;
  introDescription: string;
  letters: CaseLastLetter[];
  progress: string;
  /** Cùng nội dung với `progress`, viết thành câu cho trình đọc màn hình. */
  progressLabelText: string;
  playing: boolean;
  atStart: boolean;
  atEnd: boolean;
  /** Bảng nhà, chỉ khi bản 3D đang chạy - xem chỗ gọi. */
  roster: React.ReactNode;
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
}) {
  return (
    /*
     * MỘT trần chiều cao cho cả tấm, và nó nằm ở VÙNG CUỘN chứ không ở tấm.
     *
     * Bản đầu giới hạn riêng vùng lời kể (`max-h-[38vh]`), riêng bảng nhà
     * (`max-h-36`), rồi để hàng nút tự lo. Ba trần riêng CỘNG LẠI không có trần
     * nào: một lá thư dài cộng mười lăm căn nhà cộng hàng nút vẫn vượt quá màn
     * hình 390x844, và thứ trôi ra ngoài đáy là hàng nút.
     *
     * Nhưng đặt trần lên chính tấm này cũng sai, và sai ở đúng cái ca khó nhất:
     * màn 320x568 với cỡ chữ 200%. Ở đó ba cái nút xuống hàng thành ba dòng cao
     * 272px - cao hơn cả trần 46dvh - và vì chúng `shrink-0` nên chúng không co
     * lại mà TRÀN ra ngoài đáy tấm, tức là ra ngoài màn hình. Đúng thứ mà trần
     * kia được đặt ra để chặn.
     *
     * Đặt trần lên vùng cuộn thì thứ tự ưu tiên trở nên đúng: hàng nút lấy đủ
     * chiều cao nó cần, phần chữ lấy phần còn lại nhưng không quá `40dvh`, và
     * khung 3D nhận những gì còn thừa.
     *
     * Và tấm này KHÔNG `shrink-0`. Đó là nửa còn lại của cùng một chuyện: ở
     * 320x568 với cỡ chữ 200%, chỗ trống sau thanh tiêu đề còn ít hơn cả chiều
     * cao của nội dung tấm, nên một tấm không co được sẽ đẩy phần thừa - tức là
     * hàng nút - ra ngoài đáy màn hình. Cho nó co lại thì phần bị ép là VÙNG
     * CUỘN, vì hàng nút bên trong mới là thứ `shrink-0`. Chật tới đâu thì hàng
     * nút vẫn ở trong khung.
     *
     * `dvh` vì thanh địa chỉ trên di động trượt được; xem chú thích ở gốc dialog.
     */
    <div className="flex min-h-0 flex-col border-t border-white/[0.08] bg-night-950/80 px-4 pb-3 pt-3 sm:px-6 phone-landscape:h-full phone-landscape:px-3 phone-landscape:w-[42%] phone-landscape:max-w-[380px] phone-landscape:shrink-0 phone-landscape:border-l phone-landscape:border-t-0">
      {/* Lời kể, thư và bảng nhà chung MỘT vùng cuộn: hai vùng cuộn lồng nhau
        * trên điện thoại là một cái bẫy - ngón tay không biết mình đang cuộn cái
        * nào. `break-words` lo phần không tràn ngang. */}
      <div className="min-h-0 max-h-[40dvh] flex-1 overflow-y-auto phone-landscape:max-h-none">
        <div aria-live="polite">
          {intro && (
            <>
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-night-950"
                  style={{ backgroundColor: accent }}
                >
                  Mở đầu
                </span>
                <span className="font-display text-base font-bold text-white sm:text-lg">
                  Toàn cảnh ngôi làng
                </span>
              </p>
              <p className="mt-1 text-sm leading-relaxed text-mist-strong">{introDescription}</p>
            </>
          )}

          {step && (
            <>
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-night-950"
                  style={{ backgroundColor: accent }}
                >
                  {step.momentLabel}
                </span>
                <span className="font-display text-base font-bold text-white sm:text-lg">
                  {step.title}
                </span>
              </p>
              <p className="mt-1 break-words text-sm leading-relaxed text-mist-strong">
                {step.description}
              </p>
            </>
          )}

          {letters.length > 0 && (
            <ul className="mt-2.5 space-y-2">
              {letters.map((letter, position) => (
                <li
                  key={`${letter.authorId}-${position}`}
                  className="rounded-lg border border-amber-500/25 bg-amber-950/15 px-3 py-2"
                >
                  <p className="text-[13px] font-bold text-amber-200">
                    Phong thư sau cùng của {letter.authorName}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-mist-strong">
                    {letter.text}
                  </p>
                  <p className="mt-0.5 text-[11px] text-mist/85">
                    Niêm phong ở vòng {letter.sealedRound}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {roster}
      </div>

      {/*
        * Hàng điều khiển `shrink-0` và nằm NGOÀI vùng cuộn ở trên: nút
        * Trước / Tiếp / Tạm dừng phải ở nguyên một chỗ, không trôi theo nội
        * dung và không bị một lá thư dài hay mười lăm căn nhà đẩy ra khỏi màn -
        * kể cả khi người dùng phóng cỡ chữ lên 200%.
        */}
      <div className="mt-3 flex shrink-0 flex-wrap items-center justify-center gap-2">
        {/*
          * Ở điện thoại NẰM NGANG, ba cái nút bỏ phần chữ và chỉ còn ký hiệu.
          *
          * Không phải để cho gọn: ở 844x390 với cỡ chữ 200%, cột phải chỉ cao
          * 251px trong khi ba cái nút có chữ xuống thành ba hàng 80px - cộng cả
          * lề là 344px, và cái nút bị đẩy ra ngoài đáy là "Tiếp". Bỏ chữ thì cả
          * ba nằm gọn một hàng, và hàng ấy vừa khung.
          *
          * `aria-label` có ở CẢ HAI chế độ, và luôn CHỨA đúng chữ đang hiện -
          * "Trước" nằm trong "Bước trước" - nên khi chữ còn hiện thì tên gọi
          * được với tên nhìn thấy vẫn khớp nhau. Khi chữ bị ẩn, nó là thứ duy
          * nhất còn nói được cái nút này làm gì, cho cả trình đọc màn hình lẫn
          * điều khiển bằng giọng nói.
          *
          * Vùng bấm giữ 44x44 bằng PIXEL cố định, không phải `min-h-11` theo
          * `rem`. Chuẩn kích thước đích đo bằng CSS pixel, nên một cái nút phình
          * lên 88x88 ở cỡ chữ 200% không an toàn hơn chút nào - nó chỉ chiếm mất
          * chỗ, đẩy hàng nút thành hai dòng và bóp vùng lời kể xuống còn 0px.
          */}
        <button
          className="btn-ghost px-4 phone-landscape:min-h-[44px] phone-landscape:min-w-[44px] phone-landscape:px-2"
          aria-label="Bước trước"
          onClick={onPrev}
          disabled={atStart}
        >
          <span aria-hidden="true">←</span>
          <span className="phone-landscape:hidden">Trước</span>
        </button>
        <button
          className="btn-ghost px-4 phone-landscape:min-h-[44px] phone-landscape:min-w-[44px] phone-landscape:px-2"
          aria-label={playing ? "Tạm dừng" : "Phát"}
          onClick={onToggle}
        >
          <span aria-hidden="true">{playing ? "⏸" : "▶"}</span>
          <span className="phone-landscape:hidden">{playing ? "Tạm dừng" : "Phát"}</span>
        </button>
        <button
          className="btn-ghost px-4 phone-landscape:min-h-[44px] phone-landscape:min-w-[44px] phone-landscape:px-2"
          aria-label="Bước tiếp theo"
          onClick={onNext}
          disabled={atEnd}
        >
          <span className="phone-landscape:hidden">Tiếp</span>
          <span aria-hidden="true">→</span>
        </button>
        {/* Nhãn nhìn thấy giữ vẻ gọn ("2/5", "Mở đầu"); `aria-label` nói thành
          * câu, vì "2/5" đọc lên là "hai gạch chéo năm". */}
        <p className="ml-1 text-sm tabular-nums text-mist-strong" aria-label={progressLabelText}>
          {progress}
        </p>
      </div>
    </div>
  );
}
