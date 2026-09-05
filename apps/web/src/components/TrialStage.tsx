"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { assignAvatars, breathOffsetFor, tintFor } from "@/lib/avatar";
import { sheetFor } from "@/lib/character-art";
import { playbackMode, readNetworkHints, readPlaybackInputs } from "@/lib/cinematic-settings";
import { hasWebgl2 } from "@/lib/cinematic-webgl";
import {
  accusedPortrait,
  actLabel,
  scaleTilt,
  tallyAnnouncement,
  verdictLabel,
  type TrialStageBeat,
  type TrialStageView,
} from "@/lib/live-trial";
import { rendererState } from "@/lib/village-memory-playback";
import { CharacterPortrait } from "./CharacterPortrait";
import { WeightDecidedNote } from "./WeightDecidedNote";
import { TrialStageCanvas } from "./TrialStageCanvas";
import { useSpeakers } from "./VoiceProvider";

/**
 * "Phiên toà sống" - lớp NHÌN THẤY.
 *
 * Nằm ngay trên nội dung pha trong cột giữa, KHÔNG phải một lớp phủ toàn màn:
 * chat, voice và hai cái nút Treo/Tha vẫn ở nguyên chỗ cũ và vẫn bấm được suốt
 * cả phần diễn. Đó là ranh giới của cả tính năng - nó thêm một sân khấu vào
 * phiên toà, nó không thay phiên toà bằng một đoạn phim.
 *
 * Ba lớp, và thứ tự này là thứ tự ưu tiên khi màn hình chật:
 *
 *   1. CHỮ. Chặng, tên bị cáo, quyền nói, hai con số, ngưỡng kết án, phán
 *      quyết - tất cả đều là DOM, không một chữ nào vẽ trong WebGL. Đây là lớp
 *      duy nhất bắt buộc phải có.
 *   2. Nền sân khấu bằng CSS. Luôn dựng được, kể cả trên máy không có WebGL2.
 *   3. Cảnh 3D. Chỉ khi máy dựng được, và nó chỉ thay chỗ của lớp 2.
 *
 * Vì vậy "không có WebGL" không bao giờ ra một màn đen: nó ra đúng lớp 1 cộng
 * lớp 2, và không thiếu một thông tin nào.
 */

/**
 * Dưới ngưỡng này thì bỏ hẳn khung sân khấu.
 *
 * Điện thoại nằm ngang (844x390) và những màn rất thấp khác: sau thanh pha và
 * khối chữ, phần còn lại cho một khung 3D chỉ chừng trăm pixel - vừa không xem
 * được gì, vừa đẩy hai cái nút quyết định xuống dưới đáy màn. Thứ tự ưu tiên ở
 * đó rất rõ: người chơi phải bấm được nút trước đã.
 *
 * Kiểm bằng `matchMedia` chứ không phải một lớp CSS `hidden`: ẩn bằng CSS thì
 * renderer vẫn dựng, vẫn vẽ, vẫn giữ context - chỉ là vẽ vào một ô không ai
 * thấy.
 */
const SHORT_VIEWPORT = "(max-height: 620px)";

/** Vùng aria-live không được đọc theo từng lá phiếu. Xem `useThrottled`. */
const ANNOUNCE_THROTTLE_MS = 2200;

interface Props {
  view: TrialStageView;
  beats: TrialStageBeat[];
  /** Số thứ tự lô nhịp diễn - xem `useLiveTrial`. */
  beatsId: number;
  /**
   * Báo lô đó đã có bên chịu trách nhiệm.
   *
   * Đúng HAI đường được phép gọi, và không có đường thứ ba:
   *
   *   1. `TrialStageCanvas` gọi ngay khi người điều phối cầm lô - dù nó diễn
   *      luôn hay còn giữ chờ `three` tải xong.
   *   2. Chính component này gọi khi đã QUYẾT ĐỊNH không có 3D (máy không dựng
   *      được, đã hỏng, hay màn quá thấp nên bỏ hẳn khung): bản 2D không có
   *      hiệu ứng nào để chạy, nên lô bị bỏ theo chính sách - giữ lại thì nó sẽ
   *      nổ ra ở lần đầu tiên máy dựng được 3D, kể một chuyện đã xong từ lâu.
   *
   * Lúc CHƯA dò xong khả năng hiển thị thì không ai gọi cả. Bản đầu gọi ở đây
   * vô điều kiện, và vì `webgl2` khởi tạo là `false` nên lượt commit đầu tiên
   * luôn trông như "đã quyết định dùng 2D" - lô bị đánh dấu đã nhận trước khi
   * canvas kịp tồn tại, và màn mở đầu không bao giờ tới được cảnh 3D.
   */
  onBeatsConsumed: (id: number) => void;
  snapshot: RoomSnapshot;
}

export function TrialStage({ view, beats, beatsId, onBeatsConsumed, snapshot }: Props) {
  const roster = snapshot.players.map((player) => player.id).join(",");
  const avatars = useMemo(() => assignAvatars(roster ? roster.split(",") : []), [roster]);
  /*
   * Ảnh người chơi tự tải lên đi trước hình gán theo bảng - cùng luật với ô
   * người chơi và cột Người chơi. Bản đầu chỉ tra bảng, nên người có ảnh riêng
   * lên bục mang mặt của một nhân vật lạ, ngay cạnh cột đang hiện đúng ảnh họ.
   */
  const accusedAvatarUrl =
    snapshot.players.find((player) => player.id === view.accusedId)?.avatarUrl ?? null;
  const accusedAvatar = accusedAvatarUrl ?? avatars[view.accusedId];

  /*
   * Ba cờ dưới đây đọc SAU khi hydrate, không phải trong lúc render.
   *
   * `localStorage`, `matchMedia` và context WebGL đều không tồn tại ở server;
   * đọc thẳng trong render thì cây DOM hai bên lệch nhau. Khởi tạo bằng giá trị
   * an toàn nhất (không giảm chuyển động, chưa có 3D, chưa biết màn cao thấp)
   * nên khoảnh khắc trước khi effect chạy cùng lắm là thiếu cảnh 3D một nhịp.
   */
  const [reduced, setReduced] = useState(false);
  const [webgl2, setWebgl2] = useState(false);
  const [short, setShort] = useState(false);
  const [failed, setFailed] = useState(false);
  /*
   * Đã dò xong khả năng hiển thị chưa.
   *
   * TÁCH HẲN khỏi `webgl2`, vì `false` của `webgl2` mang hai nghĩa hoàn toàn
   * khác nhau: "đã hỏ�i và máy không dựng được" và "chưa hỏi lần nào". Gộp lại
   * thì lượt render đầu tiên - lượt luôn có `webgl2 === false` - bị đọc thành
   * một quyết định cuối cùng, và mọi thứ phụ thuộc quyết định ấy đều chạy sớm
   * một nhịp.
   */
  const [probed, setProbed] = useState(false);

  useEffect(() => {
    const apply = () => setReduced(playbackMode(readPlaybackInputs()) === "none");
    apply();
    /*
     * Save-Data thì KHÔNG dựng 3D.
     *
     * Cảnh này không tải file nào, nhưng `three` là một chunk gần 600KB - và
     * người bật cờ đó đang nói đúng một câu: đừng tải hộ tôi. Cả phần chữ vẫn
     * còn nguyên, nên họ không mất thông tin nào.
     */
    setWebgl2(hasWebgl2() && !readNetworkHints().saveData);
    // Bật TRƯỚC lối thoát sớm bên dưới: một trình duyệt không có `matchMedia`
    // vẫn là một trình duyệt đã được hỏi xong.
    setProbed(true);

    if (typeof window.matchMedia !== "function") return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const height = window.matchMedia(SHORT_VIEWPORT);
    const syncHeight = () => setShort(height.matches);
    syncHeight();
    motion.addEventListener("change", apply);
    height.addEventListener("change", syncHeight);
    // Công tắc "Giảm chuyển cảnh" nằm ở component khác; `storage` của trình
    // duyệt chỉ bắn sang tab khác nên nó tự gọi một tiếng qua sự kiện này.
    window.addEventListener("masoi:cinematic-settings", apply);
    return () => {
      motion.removeEventListener("change", apply);
      height.removeEventListener("change", syncHeight);
      window.removeEventListener("masoi:cinematic-settings", apply);
    };
  }, []);

  /*
   * `useCallback` với deps rỗng, KHÔNG phải arrow inline.
   *
   * `TrialStageCanvas` đặt `onFail` trong deps của effect dựng scene, mà
   * component này render lại theo TỪNG snapshot - một arrow inline sẽ khiến
   * renderer bị tháo và dựng lại ở mỗi lá phiếu.
   */
  const onFail = useCallback(() => setFailed(true), []);

  /*
   * Model dựng cảnh chỉ đổi khi SĨ SỐ PHÒNG hoặc BỊ CÁO đổi.
   *
   * Cũng là deps của effect dựng scene. Một object mới ở mỗi snapshot là một
   * renderer mới ở mỗi snapshot, nên nó phải đi qua `useMemo` - và giá trị bên
   * trong cố ý là thứ duy nhất trong cả tính năng có quyền dựng lại cảnh.
   *
   * Bị cáo đổi nghĩa là một phiên toà KHÁC, và một phiên toà khác vốn đã dựng
   * lại cảnh từ trước - nên thêm nó vào đây không mở thêm đường dựng lại nào.
   *
   * Chân dung bị cáo: chính bức ảnh mà lớp chân dung 2D đang dùng - ảnh tự tải
   * hay sheet của nhân vật - nên không tốn thêm một byte nào: tới lúc phiên toà
   * mở, ảnh này đã nằm trong cache của trình duyệt vì ô người chơi vừa vẽ nó
   * suốt cả pha ngày. (Với ảnh tự tải, cache chỉ dùng lại được khi bucket trả
   * CORS - xem README; không có CORS thì WebGL từ chối ảnh và bục giữ khối đầu
   * trơn, trong khi ảnh 2D bên dưới vẫn hiện.)
   *
   * KHÔNG cần kiểm Save-Data ở đây: `hasWebgl2() && !readNetworkHints().saveData`
   * đã tắt hẳn sân khấu 3D từ trước, nên không có sân khấu thì cũng không có
   * chân dung để tải.
   *
   * `avatars` đã memo theo `roster`, còn `accusedId` cố định suốt một phiên -
   * nên `model` vẫn giữ được ràng buộc ỔN ĐỊNH của nó. `accusedAvatarUrl` là
   * một chuỗi và chỉ đổi khi bị cáo đổi ảnh GIỮA phiên toà của chính mình -
   * hiếm tới mức một lần dựng lại cảnh ở đó là cái giá chấp nhận được, còn hơn
   * để bục hiện một bức ảnh người ta vừa xoá.
   */
  const model = useMemo(() => {
    const portrait = accusedPortrait(
      accusedAvatarUrl,
      sheetFor(avatars[view.accusedId] ?? "")?.src ?? null,
    );
    return {
      audience: view.audience,
      portrait: portrait?.url ?? null,
      portraitKind: portrait?.kind,
    };
  }, [view.audience, avatars, view.accusedId, accusedAvatarUrl]);
  const sceneState = useMemo(
    () => ({
      act: view.act,
      tilt: scaleTilt(view.guilty, view.innocent),
      verdict: view.verdict,
    }),
    [view.act, view.guilty, view.innocent, view.verdict],
  );

  const mode = rendererState({ open: !short, webgl2, failed, contextLost: false });
  /*
   * Ba trạng thái, không phải hai.
   *
   *   "unknown" - chưa dò xong. CHƯA AI có thể nhận lô, nên không ai được
   *               tuyên bố đã nhận. Đây là trạng thái mà bản đầu không có, và
   *               thiếu nó thì lượt commit đầu tiên bị đọc nhầm thành "đã chốt
   *               dùng bản 2D".
   *   "webgl"   - sẽ có canvas. Canvas (qua người điều phối) là bên nhận lô,
   *               kể cả khi `three` còn đang tải: giữ chờ cũng là nhận trách
   *               nhiệm.
   *   "flat"    - đã chốt không diễn 3D. Bản 2D không có hiệu ứng nào để chạy,
   *               nên lô bị BỎ theo chính sách, ngay và dứt khoát.
   */
  const visual: "unknown" | "webgl" | "flat" = !probed
    ? "unknown"
    : mode === "webgl"
      ? "webgl"
      : "flat";

  /*
   * Chỉ bỏ lô ở nhánh 2D. Nhánh 3D do canvas tự báo - xem `onBeatsTaken`.
   *
   * `visual` nằm trong deps: khi máy vừa dò xong và rơi về 2D, effect này chạy
   * lại và bỏ lô ngay lượt đó, không để nó nằm chờ một canvas sẽ không bao giờ
   * xuất hiện.
   */
  useEffect(() => {
    if (visual !== "flat" || beats.length === 0) return;
    onBeatsConsumed(beatsId);
  }, [visual, beats, beatsId, onBeatsConsumed]);

  const speaking = useSpeakers().has(view.accusedId);
  const announcement = useThrottled(tallyAnnouncement(view), ANNOUNCE_THROTTLE_MS);

  return (
    /*
     * `flex flex-col` và KHÔNG `overflow-hidden` ở đây, và đó là cả lần sửa.
     *
     * Bản đầu để `overflow-hidden` trên chính thẻ này. Nhìn thì vô hại - nó chỉ
     * cắt góc cho khung 3D - nhưng theo luật flexbox, một phần tử có `overflow`
     * khác `visible` thì kích thước tối thiểu TỰ ĐỘNG của nó tụt xuống 0. Cột
     * giữa của phòng chơi từ `lg` trở lên là một flex column cao đúng bằng
     * khung nhìn, nên nó được phép bóp thẻ này xuống bao nhiêu cũng được - và
     * `overflow-hidden` cắt gọn phần thừa. Ở 1440x900 giữa vòng bỏ phiếu xác
     * nhận, thẻ cần 388px nhưng chỉ được 305px: hai con số Treo/Tha và dòng
     * ngưỡng kết án biến mất, mà cột thì KHÔNG có thanh cuộn nào để tìm lại
     * chúng - thẻ đã co lại vừa khít nên chẳng có gì tràn ra để mà cuộn.
     *
     * Bỏ `overflow-hidden` ở thẻ và chuyển nó xuống đúng chỗ cần nó (khung 3D)
     * thì kích thước tối thiểu của thẻ trở lại là min-content, và thứ tự nhường
     * chỗ thành đúng thứ tự ưu tiên:
     *
     *   1. Khung 3D co lại trước - nó là phần trang trí duy nhất ở đây.
     *   2. Hết chỗ co thì cột giữa cuộn, vì thẻ không còn co được nữa.
     *   3. Khối chữ (`shrink-0`) không bao giờ bị cắt một dòng nào.
     */
    <section className="card flex flex-col p-0" aria-label="Sân khấu phiên toà">
      {!short && (
        /*
         * Chiều cao bằng `clamp`, không bằng tỉ lệ khung hình.
         *
         * Một khung `aspect-video` trong cột giữa 1024px sẽ cao 576px và đẩy
         * mọi thứ khác xuống dưới màn hình. Cái cần chặn ở đây là CHIỀU CAO, và
         * camera thì tự lo phần khung hình qua `ResizeObserver`.
         *
         * Dưới `sm` khung THẤP HƠN HẲN, và đó là chỗ đắt nhất của cả bố cục:
         * trên một màn 390x844, mỗi pixel sân khấu ăn thêm là một pixel đẩy hai
         * cái nút Treo/Tha xuống sâu hơn dưới mép màn. Thứ tự ưu tiên ở màn hẹp
         * là bấm được trước, xem sau - nên sân khấu nhận phần còn lại chứ không
         * lấy phần của mình trước.
         *
         * Từ `lg` khung CAO HƠN HẲN, và lý do ngược lại y hệt: ở đó cột giữa
         * tự cuộn, hai cái nút không nằm dưới sân khấu mà ở cột riêng, nên
         * không có gì bị đẩy đi cả. Bản đầu giữ trần 224px cho mọi màn, và trên
         * 1440x900 một khung rộng 900px cao 224px cho ra khuôn mặt bị cáo chừng
         * 27px - nhỏ hơn cả ô người chơi ở cột trái. Sân khấu đang chiếu đúng
         * một người mà lại nói về người đó ít hơn cái danh sách bên cạnh.
         */
        <div className="relative h-[clamp(116px,16vh,168px)] min-h-0 w-full overflow-hidden rounded-t-xl bg-night-950 sm:h-[clamp(132px,22vh,224px)] lg:h-[clamp(220px,34vh,360px)]">
          {visual === "webgl" ? (
            <TrialStageCanvas
              model={model}
              state={sceneState}
              sessionKey={view.key}
              beats={beats}
              beatsId={beatsId}
              onBeatsTaken={onBeatsConsumed}
              reduced={reduced}
              onFail={onFail}
            />
          ) : (
            /* "unknown" cũng vẽ nền CSS: nó là một khung hình chờ có hình, chứ
             * không phải một ô đen - và nó không bao giờ tiêu thụ lô nào. */
            <FlatStage view={view} reduced={reduced} />
          )}
        </div>
      )}

      {/* `shrink-0`: chữ là thứ cuối cùng được phép nhường chỗ, và ở đây nghĩa
        * là không bao giờ. Tên bị cáo, hai con số, ngưỡng kết án và dòng phán
        * quyết đều nằm trong khối này. */}
      <div className="shrink-0 space-y-2.5 p-3.5 sm:space-y-3 sm:p-5">
        {/*
          * Nhãn chặng ở amber-300 chứ không phải mist mờ: đây đúng là dòng trả
          * lời câu hỏi "màn hình này đang là chuyện gì", và ở 60% độ mờ nó rơi
          * xuống quanh 3:1 - dưới ngưỡng AA cho chữ thường.
          */}
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-amber-300">
          {actLabel(view.act)}
        </p>

        <div className="flex items-center gap-3">
          {/*
            * Quầng thoại quanh ảnh bị cáo, cùng một ngôn ngữ hình với ô người
            * chơi trong lưới: xanh lá, nằm NGOÀI vòng amber sẵn có, không đổi
            * vòng đó. Vòng amber nói "đây là bị cáo" - một chuyện đúng suốt cả
            * phiên toà - còn quầng xanh nói "người này đang nói ngay lúc này".
            *
            * Dòng chữ ngay bên dưới (`SpeakStatus`) vẫn là chỗ đọc ra được
            * bằng chữ; quầng chỉ để mắt bắt được mà không phải đọc.
            */}
          <span
            className={`relative shrink-0 ${speaking ? "seat-voice-breathe" : ""}`}
            style={
              { "--breath-offset": breathOffsetFor(view.accusedId) } as React.CSSProperties
            }
          >
            {speaking && (
              <span
                aria-hidden="true"
                className="seat-voice-halo pointer-events-none absolute -inset-1 rounded-full"
              />
            )}
            <CharacterPortrait
              avatar={accusedAvatar}
              isCustom={accusedAvatarUrl !== null}
              tint={tintFor(view.accusedId)}
              alive
              speaking={speaking}
              breathOffset={breathOffsetFor(view.accusedId)}
              className="h-12 w-12 ring-2 ring-amber-500/50 sm:h-14 sm:w-14"
            />
          </span>
          {/* min-w-0 + break-words: một cái tên 20 ký tự không dấu cách phải
            * xuống dòng chứ không đẩy toang thẻ ở cột giữa. */}
          <h3 className="min-w-0 break-words font-display text-xl font-bold leading-tight text-white sm:text-2xl">
            {view.accusedName}
          </h3>
        </div>

        {view.act === "DEFENSE" && (
          <SpeakStatus view={view} speaking={speaking} dead={!snapshot.you?.alive} />
        )}

        {view.act !== "DEFENSE" && <Tally view={view} />}

        {view.verdict && <VerdictBanner view={view} reduced={reduced} />}

        {view.yourWeightDecided && <WeightDecidedNote lynched={view.verdict === "LYNCHED"} />}

        {/*
          * MỘT vùng aria-live cho cả sân khấu, và nó bị tiết chế theo nhịp.
          *
          * Số phiếu đổi liên tục ở cuối pha; đọc từng lần đổi nghĩa là trình
          * đọc màn hình nói suốt cả pha và nuốt mất thông báo đổi pha lẫn tin
          * nhắn chat. `polite` chứ không `assertive` vì không có gì ở đây khẩn
          * cấp tới mức cắt lời người dùng đang nghe dở.
          */}
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </div>
    </section>
  );
}

/**
 * Trạng thái quyền nói.
 *
 * "Đang nói" chỉ hiện khi voice THẬT SỰ báo có tiếng - cùng nguồn dữ liệu với
 * vòng sáng quanh người chơi trong danh sách. Không có voice thì không giả lập
 * một cái sóng âm nào cả: cái duy nhất còn nói được là AI ĐƯỢC PHÉP nói, và đó
 * là thứ dòng này nói.
 */
function SpeakStatus({
  view,
  speaking,
  dead,
}: {
  view: TrialStageView;
  speaking: boolean;
  dead: boolean;
}) {
  const mine = view.canSpeak;
  return (
    <p
      role="status"
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-sm leading-snug ${
        mine
          ? "border-amber-400/45 bg-amber-500/[0.12] font-semibold text-amber-100"
          : "border-white/10 bg-night-800/60 text-mist-bright"
      }`}
    >
      <span aria-hidden="true">{mine ? "🎙" : speaking ? "🔊" : "👂"}</span>
      <span>
        {mine
          ? "Đến lượt bạn biện hộ"
          : dead
            ? `Bạn đã chết — chỉ ${view.accusedName} được nói lúc này`
            : speaking
              ? `${view.accusedName} đang nói`
              : `Hãy lắng nghe — chỉ ${view.accusedName} được nói lúc này`}
      </span>
    </p>
  );
}

/**
 * Bảng số và ngưỡng kết án.
 *
 * Hai thứ TÁCH BẠCH, và đó là điểm quan trọng nhất của cả khối này: thanh tương
 * quan nói phe nào đang đông hơn, còn cái vạch trên thanh nói bao nhiêu là đủ
 * để kết án. Trộn hai thứ đó vào một hình ảnh là cách nhanh nhất để một thanh
 * đầy được đọc thành một bản án.
 */
function Tally({ view }: { view: TrialStageView }) {
  // Mẫu số là tổng phiếu ĐÃ BỎ hoặc ngưỡng kết án, lấy cái lớn hơn: chia cho
  // tổng phiếu thôi thì hai phiếu Treo trên hai phiếu đã bỏ trông như đã đủ án.
  const total = Math.max(view.guilty + view.innocent, view.required ?? 0, 1);
  const mark = view.required === null ? null : Math.min(100, (view.required / total) * 100);

  return (
    <div>
      <div className="relative">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-night-800">
          <div
            className="bg-blood-500 transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${(view.guilty / total) * 100}%` }}
          />
          <div
            className="bg-emerald-500/80 transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${(view.innocent / total) * 100}%` }}
          />
        </div>
        {mark !== null && (
          // Vạch ngưỡng nằm TRÊN thanh, không phải một màu thứ ba trong thanh:
          // nó không phải một phần của tương quan, nó là cái mốc mà tương quan
          // đang tiến tới.
          <span
            aria-hidden="true"
            className="absolute top-[-3px] h-[17px] w-[3px] -translate-x-1/2 rounded-full bg-amber-300 ring-1 ring-night-950"
            style={{ left: `${mark}%` }}
          />
        )}
      </div>

      {/*
        * Ký hiệu đi kèm chữ, và chữ mới là thứ mang nghĩa.
        *
        * Hai bên khác nhau ở BA lớp: từ ngữ ("Treo"/"Tha"), ký hiệu (■/○) và
        * màu. Ai không phân biệt được đỏ với lục vẫn còn đủ hai lớp đầu.
        */}
      <div className="mt-1.5 flex justify-between text-sm">
        <span className="font-bold text-blood-400">
          <span aria-hidden="true" className="mr-1">
            ■
          </span>
          Treo <span className="tabular-nums">{view.guilty}</span>
        </span>
        <span className="font-bold text-emerald-300">
          Tha <span className="tabular-nums">{view.innocent}</span>
          <span aria-hidden="true" className="ml-1">
            ○
          </span>
        </span>
      </div>

      {view.required !== null && (
        <p className="mt-1.5 text-[13px] text-mist-strong">
          Cần <b className="font-bold text-white tabular-nums">{view.required}</b> phiếu Treo để kết
          án, nếu mọi lá phiếu đều nặng như nhau.
        </p>
      )}

      {view.thresholdReached && !view.verdict && (
        /*
         * Nhãn dừng ở "đã đạt ngưỡng HIỆN TẠI", và không đi xa hơn một chữ nào.
         *
         * Ngưỡng tính trên số cử tri còn sống, mà cử tri thì chết được giữa
         * phiên toà; phiếu cũng còn đổi được cho tới lúc chốt. Một dòng "đã đủ
         * phiếu treo" ở đây là tuyên án hộ server, và nó sai ngay lần đầu có
         * người đổi phiếu ở giây cuối.
         */
        <p className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[13px] font-semibold text-amber-100">
          <span aria-hidden="true">⚖</span>
          Đã đạt ngưỡng hiện tại — chờ làng chốt phiếu
        </p>
      )}
    </div>
  );
}

/**
 * Dòng tuyên án.
 *
 * "Được tha" KHÔNG kèm một chữ nào về vai trò thật: làng vừa quyết định không
 * treo người này, chứ làng không hề biết người này là ai. Xem `verdictLabel`.
 */
function VerdictBanner({ view, reduced }: { view: TrialStageView; reduced: boolean }) {
  const lynched = view.verdict === "LYNCHED";
  return (
    <p
      className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 font-display text-lg font-bold ${
        lynched
          ? "border-blood-500/45 bg-blood-950/30 text-blood-400"
          : "border-emerald-500/40 bg-emerald-950/25 text-emerald-300"
      } ${reduced ? "" : "animate-riseIn"}`}
    >
      <span aria-hidden="true">{lynched ? "⚖" : "🕊"}</span>
      {verdictLabel(view.verdict!)}
    </p>
  );
}

/**
 * Sân khấu dựng bằng CSS.
 *
 * KHÔNG phải một ảnh chờ: khi máy không dựng được WebGL thì đây CHÍNH LÀ sân
 * khấu, và nó phải ra hình một quảng trường về đêm chứ không phải một ô trống.
 * Cùng ba lớp với bản 3D - trăng lạnh phía sau, bục sáng ở giữa, bóng người
 * đứng trên bục - chỉ là bằng gradient thay vì bằng đa giác.
 */
function FlatStage({ view, reduced }: { view: TrialStageView; reduced: boolean }) {
  const lynched = view.verdict === "LYNCHED";
  const spared = view.verdict === "SPARED";
  // Cùng một luật ánh sáng với bản 3D: biện hộ thì đèn dồn vào bị cáo, bỏ phiếu
  // thì trả bớt sáng cho quảng trường, bị treo thì đèn ấm tắt.
  const warm = lynched ? 0 : view.act === "DEFENSE" ? 1 : spared ? 1.1 : 0.62;

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 120%, #172640 0%, #0b1424 55%, #070c18 100%)",
        }}
      />
      {/* Trăng: điểm lạnh, đứng yên. */}
      <span
        className={`absolute left-[14%] top-[16%] h-8 w-8 rounded-full bg-[#e6ecff] ${
          reduced ? "" : "animate-moonGlow"
        }`}
        style={{ boxShadow: "0 0 34px 12px rgba(145,169,226,0.35)" }}
      />
      {/* Quầng đèn ấm quanh bị cáo. Độ đậm đi theo `warm`, kể cả lúc tắt hẳn. */}
      <span
        className="absolute bottom-0 left-1/2 h-[130%] w-[70%] -translate-x-1/2 transition-opacity duration-700 motion-reduce:transition-none"
        style={{
          opacity: Math.min(1, warm),
          background:
            "radial-gradient(50% 45% at 50% 78%, rgba(255,196,107,0.34) 0%, rgba(255,157,61,0.12) 45%, rgba(255,157,61,0) 72%)",
        }}
      />
      {/* Bục xét xử và bóng người trên bục. */}
      <span className="absolute bottom-[14%] left-1/2 h-[16%] w-[42%] -translate-x-1/2 rounded-[50%] bg-[#46557a]/70" />
      <span className="absolute bottom-[24%] left-1/2 h-[34%] w-[7%] -translate-x-1/2 rounded-t-full bg-[#0a1120]" />
      {/* Vòng khán giả: một dải bóng mờ ở hai mép, không đếm được và không ai
        * trong đó sáng lên. */}
      <span
        className="absolute inset-x-0 bottom-0 h-[26%]"
        style={{
          background: "linear-gradient(to top, rgba(7,12,24,0.95) 20%, rgba(7,12,24,0) 100%)",
        }}
      />
    </div>
  );
}

/**
 * Giữ một chuỗi lại ít nhất `ms` trước khi đổi.
 *
 * Dựng riêng ở đây thay vì đọc thẳng: vùng `aria-live` là chỗ duy nhất trong cả
 * tính năng mà "cập nhật ngay" lại là hành vi SAI. Con số nhìn thấy phải đổi tức
 * thì theo snapshot; còn tai thì không nghe kịp một câu mới mỗi giây, và mỗi câu
 * mới lại cắt ngang câu trước.
 */
function useThrottled(text: string, ms: number): string {
  const [shown, setShown] = useState(text);
  const last = useRef(0);

  useEffect(() => {
    const wait = Math.max(0, ms - (Date.now() - last.current));
    const timer = setTimeout(() => {
      last.current = Date.now();
      setShown(text);
    }, wait);
    return () => clearTimeout(timer);
  }, [text, ms]);

  return shown;
}
