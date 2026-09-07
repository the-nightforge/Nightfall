"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import {
  cinematicFor,
  prefetchPlan,
  type Cinematic,
  type CinematicKind,
} from "@/lib/cinematic-transition";
import {
  playbackMode,
  readNetworkHints,
  readPlaybackInputs,
  type NetworkHints,
} from "@/lib/cinematic-settings";
import { canUseWebgl, hasWebgl2, hasWebglScene } from "@/lib/cinematic-webgl";
import { isKillKind, killSceneFor, type KillSceneView } from "@/lib/kill-cinematic";
import { stageOwnsCinematic } from "@/lib/live-trial";
import { useModalFocus } from "@/lib/useModalFocus";
import { CinematicCanvas } from "./CinematicCanvas";
import { KillScene } from "./KillScene";
import { VillageSilhouette } from "./VillageSilhouette";
import { EventGlyph } from "./EventGlyph";
import { WolfMark } from "./WolfMark";

/**
 * Lớp phủ chuyển cảnh.
 *
 * Ba điều nó KHÔNG được phép làm, và cả ba đều đã hỏng ở đâu đó trước khi có
 * ghi chú này:
 *
 *  1. Không đụng vào state của ván. Nó chỉ đọc snapshot, không emit gì, không
 *     hoãn render của nội dung pha - nội dung mới đã nằm sẵn phía dưới ngay từ
 *     khung hình đầu tiên của cảnh. Đồng hồ vẫn là đồng hồ server.
 *  2. Không bao giờ chặn ván vì lỗi tải. Bản dựng bằng CSS luôn nằm dưới và
 *     luôn tự chạy; clip chỉ mờ chồng lên khi trình duyệt báo phát được. Thiếu
 *     file, hết mạng, codec lạ - kết quả đều là bản CSS, không có màn hình đen.
 *  3. Không thử lại. Một clip đã lỗi thì cả phiên này không đụng tới nó nữa,
 *     kể cả cho lượt nạp trước.
 */

/**
 * Clip đã lỗi một lần trong phiên này.
 *
 * Cấp module chứ không phải state: nó là sự thật về máy/mạng đang dùng, không
 * phải của một lần render, và nó phải sống qua mọi lần overlay tháo ra dựng lại.
 */
const brokenClips = new Set<string>();
const prefetched = new Set<string>();

/*
 * WebGL đã hỏng trong phiên này chưa.
 *
 * Ở cấp module đúng như `brokenClips`: mất context một lần là máy này không nên
 * bị thử lại ở mọi cảnh sau nữa, kể cả khi overlay tháo rồi dựng lại.
 */
let webglBroken = false;

const CLIP_BASE = "/cinematics";

export function CinematicOverlay({ snapshot }: { snapshot: RoomSnapshot | null }) {
  const [playing, setPlaying] = useState<Cinematic | null>(null);
  /*
   * Cảnh kill được ĐÓNG BĂNG tại cạnh, không tính lại theo snapshot hiện tại.
   *
   * Bản đầu dựng nó ngay trong lúc render từ `snapshot`, và điều đó hỏng thật:
   * `lastEliminated` chỉ có mặt ở ELIMINATION và CHECK_WIN. Một ván có Thợ Săn
   * đi ELIMINATION -> CHECK_WIN -> HUNTER_SHOT trong chưa tới 2,2 giây, và ở
   * snapshot HUNTER_SHOT trường đó đã là null - nên giữa chừng cảnh treo, khuôn
   * mặt người vừa bị treo biến mất và lớp phủ nhảy về bản CSS chung.
   *
   * Đây cũng chính là nguyên tắc sẵn có của cả module: một cinematic mô tả một
   * CẠNH, không mô tả trạng thái đang chạy. Dữ liệu của nó phải được chốt đúng
   * lúc cạnh ấy xảy ra.
   */
  const [killView, setKillView] = useState<KillSceneView | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const previous = useRef<RoomSnapshot | null>(null);
  const played = useRef(new Set<string>());
  const [mode, setMode] = useState<"video" | "css" | "none">("none");
  const [network, setNetwork] = useState<NetworkHints>({ saveData: false, effectiveType: null });
  const [webgl, setWebgl] = useState(false);
  /*
   * useCallback với deps rỗng, KHÔNG phải arrow inline.
   *
   * CinematicCanvas đặt `onFail` trong deps của effect dựng scene. Một arrow
   * inline đổi danh tính mỗi lần render, mà overlay này render lại theo TỪNG
   * snapshot - nên scene sẽ bị tháo và dựng lại liên tục suốt cả cảnh.
   * `webglBroken` ở cấp module và `setWebgl` ổn định, nên deps rỗng là đúng.
   */
  const handleWebglFail = useCallback(() => {
    webglBroken = true;
    setWebgl(false);
  }, []);
  // Bản sao trong ref để effect chọn cảnh chỉ phụ thuộc snapshot: cho `mode` vào
  // deps thì đổi thiết lập giữa pha sẽ chạy lại effect và ghi đè `previous`.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const rootRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);

  /*
   * Đọc thiết lập SAU khi hydrate, không phải trong lúc render: cả localStorage
   * lẫn matchMedia đều không tồn tại ở server, đọc thẳng thì cây DOM hai bên
   * lệch nhau. Khởi tạo "none" nên trong khoảnh khắc trước khi effect chạy,
   * cùng lắm là bỏ lỡ một cảnh - không bao giờ là phát nhầm một cảnh.
   */
  useEffect(() => {
    const apply = () => {
      const inputs = readPlaybackInputs();
      setMode(playbackMode(inputs));
      setWebgl(
        !webglBroken &&
          canUseWebgl({
            mode: playbackMode(inputs),
            saveData: readNetworkHints().saveData,
            webgl2: hasWebgl2(),
          }),
      );
      setNetwork(readNetworkHints());
    };
    apply();
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    query.addEventListener("change", apply);
    // Công tắc "Giảm chuyển cảnh" nằm ở component khác nên nó báo qua sự kiện
    // này; storage event của trình duyệt chỉ bắn sang TAB KHÁC, không bắn cho
    // chính tab vừa ghi.
    window.addEventListener("masoi:cinematic-settings", apply);
    return () => {
      query.removeEventListener("change", apply);
      window.removeEventListener("masoi:cinematic-settings", apply);
    };
  }, []);

  const finish = useCallback(() => {
    setPlaying(null);
    setKillView(null);
    setVideoReady(false);
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const prev = previous.current;
    previous.current = snapshot;

    const next = cinematicFor(prev, snapshot);
    if (!next) return;
    /*
     * Đánh dấu đã dùng NGAY cả khi đang tắt chuyển cảnh.
     *
     * Người chơi bật lại công tắc giữa ván thì không được lĩnh trọn xâu cảnh
     * của những cạnh đã trôi qua; khoá đã tiêu là đã tiêu.
     */
    if (played.current.has(next.key)) return;
    played.current.add(next.key);
    /*
     * Nhường hai cảnh phiên toà cho sân khấu "Phiên toà sống".
     *
     * Đặt SAU `played.add` chứ không trước, đúng như nhánh "none" ngay dưới:
     * khoá đã tiêu là đã tiêu.
     *
     * Đây cũng là chỗ DUY NHẤT quyết định ai sở hữu hai cảnh đó: không có cảnh
     * mở đầu nào phát hai lần, và không có phán quyết nào chồng lên phán quyết.
     * Kể cả khi sân khấu rơi về bản 2D nó vẫn giữ quyền - bản 2D vẫn tự tuyên
     * án bằng chữ.
     */
    if (stageOwnsCinematic(next.kind)) return;
    if (modeRef.current === "none") return;
    /*
     * Không có nạn nhân nào thì KHÔNG phát.
     *
     * `phaseKind` chỉ chọn hai cảnh kill khi snapshot đã có người chết, nên
     * nhánh này gần như không tới. "Gần như" không đủ: hai bản build lệch nhau
     * có thể cho ra một cạnh kill với danh sách rỗng, và một khung chân dung
     * không có ai trong đó tệ hơn hẳn việc bỏ lỡ một đoạn chuyển cảnh. Khoá vẫn
     * tiêu (đã `played.add` ở trên) nên nó không quay lại ở snapshot sau.
     *
     * Nhánh này cũng là thứ bảo đảm điều mà TypeScript không tự nói được: một
     * cảnh kind kill đang phát thì LUÔN có `killView` đi kèm.
     */
    const kill = isKillKind(next.kind) ? killSceneFor(next.kind, snapshot) : null;
    if (isKillKind(next.kind) && !kill) return;
    setKillView(kill);
    setVideoReady(false);
    setPlaying(next);
  }, [snapshot]);

  // Hết thời lượng thì tự đóng. Đồng hồ chạy từ lúc cảnh xuất hiện chứ không đợi
  // clip tải xong - nếu không, mạng chậm sẽ tự ý kéo dài cảnh ra.
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(finish, playing.durationMs);
    return () => clearTimeout(timer);
  }, [playing, finish]);

  /*
   * Lớp phủ là modal thật trong lúc nó sống.
   *
   * Escape đi qua đây; Enter và Space thì KHÔNG. Bản cũ nghe cả ba trên
   * `window`, nhưng focus vẫn nằm nguyên ở nút bên dưới lớp phủ - nên một phím
   * Space vừa bỏ qua cảnh, vừa để trình duyệt bấm luôn nút "Bỏ phiếu" đang
   * focus đằng sau. Giờ focus nằm ở "Bỏ qua", và Enter/Space chỉ bấm đúng nút
   * đó theo đường mặc định của trình duyệt.
   */
  useModalFocus({
    active: playing !== null,
    roots: [rootRef],
    initialFocus: skipRef,
    onEscape: finish,
  });

  // Nạp trước theo chính sách ở `prefetchPlan`, và chỉ sau khi đã vào phòng -
  // trang chủ không chạm tới component này nên nó không tải gì cả.
  useEffect(() => {
    if (!snapshot) return;
    const plan = prefetchPlan({
      phase: snapshot.phase,
      mode,
      saveData: network.saveData,
      effectiveType: network.effectiveType,
      webgl,
    });

    const add = (clip: string) => {
      // `prefetched` ở cấp module nên một clip chỉ sinh đúng một thẻ <link>
      // trong cả phiên, dù effect này chạy lại ở mỗi snapshot.
      if (prefetched.has(clip) || brokenClips.has(clip)) return;
      prefetched.add(clip);
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = `${CLIP_BASE}/${clip}.webm`;
      document.head.append(link);
    };

    for (const clip of plan.now) add(clip);
    if (plan.idle.length === 0) return;

    /*
     * Bốn clip sự kiện đi ở luồng rảnh.
     *
     * Chúng chỉ CÓ THỂ cần tới, nên không được tranh băng thông với clip của
     * pha kế tiếp, và tuyệt đối không được làm chậm thao tác đang diễn ra.
     * requestIdleCallback chưa có ở Safari nên có đường lui bằng setTimeout -
     * chậm hơn thì thôi, không có nghĩa là bỏ hẳn.
     */
    const idle = (globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    });
    const run = () => plan.idle.forEach(add);
    if (typeof idle.requestIdleCallback === "function") {
      const handle = idle.requestIdleCallback(run, { timeout: 4000 });
      return () => idle.cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(run, 2000);
    return () => clearTimeout(timer);
  }, [mode, network, snapshot, webgl]);

  if (!playing) return null;

  /*
   * Cảnh kill loại bỏ CẢ 3D lẫn video, không phải vì thứ tự ưu tiên mà vì hai
   * đường kia không kể nổi nó: một clip dựng sẵn hay một scene Three.js đều
   * không biết đêm nay ai chết. `KIND_META.clip === null` đã khoá điều đó ở
   * tầng dữ liệu; ba chỗ dùng `kill` bên dưới khoá nó ở tầng dựng hình.
   */
  const kill = killView;

  // Thứ tự quyết định: 3D nếu cảnh này có bản 3D và máy dựng được; nếu không
  // thì clip; nếu không nữa thì chỉ còn cảnh CSS bên dưới. Một cảnh KHÔNG bao
  // giờ chạy cả canvas lẫn video - không có lý do gì tải hai bản của một cảnh.
  const useWebgl = !kill && webgl && !webglBroken && hasWebglScene(playing.kind);
  /*
   * `videoClip` gộp cả điều kiện lẫn tên file vào một giá trị.
   *
   * `playing.clip` là `string | null`, và null nghĩa là cảnh này không bao giờ
   * đi qua đường video. Tách thành một `useVideo: boolean` riêng thì TypeScript
   * không thu hẹp được `playing.clip` bên trong JSX, và mỗi chỗ dùng lại phải
   * tự khẳng định non-null - đúng kiểu khẳng định sẽ sai vào lần sửa sau.
   */
  const videoClip =
    !useWebgl && !kill && mode === "video" && playing.clip !== null && !brokenClips.has(playing.clip)
      ? playing.clip
      : null;

  // Sự kiện mang tên riêng nên nhãn họ tụt xuống làm dòng nhỏ phía trên; cạnh
  // pha thì hai thứ trùng nhau và in hai lần chỉ tổ thừa.
  const eyebrow = playing.title === playing.label ? null : playing.label;

  return (
    <div
      ref={rootRef}
      // Trên cả nút chat nổi (z-40) và tấm trượt chat (z-50).
      className="fixed inset-0 z-[70] cine-root"
      /*
       * dialog + aria-modal, không phải group: trình đọc màn hình đọc TÊN của
       * dialog đúng một lần lúc focus rơi vào trong, nên không còn cần vùng
       * aria-live riêng - bản cũ có cả aria-label lẫn một <p aria-live>, và
       * NVDA đọc tên cảnh hai lượt liền nhau.
       */
      role="dialog"
      aria-modal="true"
      aria-labelledby={`cine-title-${playing.key}`}
      aria-describedby={playing.detail ? `cine-detail-${playing.key}` : undefined}
      // Chạm chỗ nào cũng bỏ qua. Đây là lý do lớp phủ ăn click thay vì cho
      // xuyên qua: một cú chạm lạc trong 1,2 giây đó mà rơi trúng "Bỏ phiếu"
      // bên dưới thì tệ hơn nhiều so với việc mất một đoạn chuyển cảnh.
      onClick={finish}
    >
      <div className={`cine-scene cine-${playing.kind.toLowerCase().replace(/_/g, "-")}`} aria-hidden="true">
        {/*
         * Chỉ vẽ phần hình CSS khi KHÔNG có canvas.
         *
         * Canvas dựng với `alpha: true` và scene không đặt `background`, nên nó
         * TRONG SUỐT - khác hẳn <video> vốn `object-cover` và đục, che kín lớp
         * dưới. Để nguyên thì trăng CSS và trăng 3D chồng lên nhau, siluet làng
         * cũng vậy. Giữ lại thẻ bọc vì class của nó mang nền gradient, thứ cảnh
         * 3D dùng làm nền.
         */}
        {!useWebgl && !kill && <SceneArt kind={playing.kind} />}
      </div>

      {/*
       * Cảnh kill thay CẢ phần hình lẫn phần chữ.
       *
       * Không phải một lớp chồng thêm lên `SceneArt`: nó có bố cục riêng (hàng
       * chân dung ở giữa, chữ ở dưới) và tự mang tiêu đề mà `aria-labelledby`
       * bên trên đang trỏ vào. Khối caption chung ở cuối file vì thế cũng nghỉ -
       * hai tiêu đề cùng một id là một cây DOM sai, và trình đọc màn hình sẽ
       * đọc đúng một cái trong hai, không đoán được cái nào.
       */}
      {kill && <KillScene view={kill} titleId={`cine-title-${playing.key}`} />}

      {useWebgl && (
        <CinematicCanvas
          // key theo khoá lần phát: mỗi cảnh dựng lại scene từ đầu, đúng cách
          // thẻ <video> bên dưới đang làm.
          key={playing.key}
          kind={playing.kind}
          durationMs={playing.durationMs}
          onFail={handleWebglFail}
        />
      )}

      {videoClip && (
        <video
          // key theo khoá lần phát: mỗi cảnh là một thẻ video mới, tháo ra là
          // trình duyệt trả luôn bộ đệm. Không bao giờ có hai clip cùng nằm bộ nhớ.
          key={playing.key}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            videoReady ? "opacity-100" : "opacity-0"
          }`}
          // muted + playsInline là điều kiện để trình duyệt cho autoplay; clip
          // cũng không mang tiếng riêng, mọi âm thanh vẫn đi qua audio engine.
          muted
          playsInline
          autoPlay
          preload="auto"
          aria-hidden="true"
          onCanPlay={() => setVideoReady(true)}
          onError={() => {
            brokenClips.add(videoClip);
            setVideoReady(false);
          }}
        >
          <source src={`${CLIP_BASE}/${videoClip}.webm`} type="video/webm" />
          <source src={`${CLIP_BASE}/${videoClip}.mp4`} type="video/mp4" />
        </video>
      )}

      {/* max-w + px-6: ở 390px dòng phụ phải xuống dòng gọn giữa màn chứ không
        * chạy sát hai mép, và cả khối vẫn nằm trong vùng an toàn giữa khung -
        * đúng vùng mà clip object-cover không cắt mất. */}
      {!kill && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6">
          <div className="cine-caption max-w-md text-center">
            {eyebrow && (
              <p className="cine-eyebrow text-xs font-bold uppercase tracking-[0.2em] text-white/70">
                {playing.glyph && (
                  <EventGlyph
                    name={playing.glyph}
                    className="mr-1.5 inline-block h-3.5 w-3.5 align-[-0.1em]"
                  />
                )}
                {eyebrow}
              </p>
            )}
            <p
              id={`cine-title-${playing.key}`}
              className="font-display text-3xl font-bold text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.9)] sm:text-4xl"
            >
              {playing.title}
            </p>
            {playing.detail && (
              <p
                id={`cine-detail-${playing.key}`}
                className="cine-detail mt-2 text-sm leading-snug text-white/85 drop-shadow-[0_1px_10px_rgba(0,0,0,0.9)]"
              >
                {playing.detail}
              </p>
            )}
          </div>
        </div>
      )}

      <button
        ref={skipRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          finish();
        }}
        /*
         * Khoảng cách mép cộng thêm vùng an toàn.
         *
         * Lớp phủ này `inset-0` và cố tình tràn kín màn hình - từ khi layout
         * khai `viewport-fit=cover` thì nó tràn cả xuống dải home indicator,
         * đúng như một đoạn phim nên làm. Riêng cái nút thì không: `bottom-6`
         * là 24px, còn dải home indicator của iPhone chiếm 34px, nên nút "Bỏ
         * qua" rơi trọn vào vùng iOS dành cho cử chỉ vuốt lên - chạm vào đó là
         * thoát app chứ không phải bỏ qua chuyển cảnh.
         *
         * `right` cũng cộng: chuyển cảnh xem được ở cả hai chiều máy, và khi
         * cầm ngang thì tai thỏ nằm ở đúng cạnh này.
         */
        className="absolute bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-[calc(1.25rem+env(safe-area-inset-right))] rounded-full border border-white/25 bg-black/50 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Bỏ qua
      </button>
    </div>
  );
}

/**
 * Phần hình dựng bằng DOM + CSS của từng cảnh.
 *
 * Đây KHÔNG phải ảnh chờ tạm: khi chưa có clip thật thì đây chính là chuyển
 * cảnh, và nó phải đủ đẹp để review được. Clip khi có sẽ mờ chồng lên trên.
 */
function SceneArt({ kind }: { kind: CinematicKind }) {
  switch (kind) {
    case "NIGHTFALL":
      return (
        <>
          <span className="cine-moon" />
          <span className="cine-cloud" />
          <VillageSilhouette className="cine-village fill-black/85" />
          <span className="cine-wolf">
            <WolfMark className="h-full w-full fill-black/70" />
          </span>
        </>
      );
    case "DAWN":
      return (
        <>
          <span className="cine-sun" />
          <span className="cine-rays" />
          <VillageSilhouette className="cine-village fill-[#14090c]/90" />
        </>
      );
    case "TRIAL":
      return (
        <>
          <span className="cine-spot" />
          <span className="cine-gavel">⚖</span>
          <span className="cine-bars" />
        </>
      );
    case "VERDICT":
      return (
        <>
          <span className="cine-iris" />
          <span className="cine-slam" />
        </>
      );
    case "VILLAGE_WIN":
      return (
        <>
          <span className="cine-burst" />
          <span className="cine-rays" />
          <VillageSilhouette className="cine-village fill-[#04140f]/85" />
        </>
      );
    case "WOLVES_WIN":
      return (
        <>
          <span className="cine-burst" />
          <span className="cine-wolf cine-wolf-big">
            <WolfMark className="h-full w-full fill-black/75" />
          </span>
          <span className="cine-claws" />
        </>
      );
    /*
     * Hai cảnh dưới đây chỉ có bản CSS - chưa dựng clip. Chúng tái dùng đúng
     * những lớp đã có trong `cinematics.css`, nên không thêm một dòng CSS nào
     * và cũng không thêm một byte tải về nào.
     */
    case "KILLER_WIN":
      return (
        <>
          <span className="cine-burst" />
          <span className="cine-claws" />
          <span className="cine-iris" />
        </>
      );
    case "DRAW":
      return (
        <>
          <span className="cine-iris" />
          <VillageSilhouette className="cine-village fill-black/90" />
        </>
      );
    case "WOLF_THREAT":
      return (
        <>
          <span className="cine-pulse" />
          <span className="cine-claws" />
        </>
      );
    case "VILLAGE_BOON":
      return (
        <>
          <span className="cine-bloom" />
          <span className="cine-rays" />
        </>
      );
    case "RULE_CHANGE":
      return (
        <>
          <span className="cine-band" />
          <span className="cine-ring" />
        </>
      );
    case "SPIRIT":
      return (
        <>
          <span className="cine-mist" />
          <span className="cine-bloom" />
        </>
      );
    /*
     * Hai cảnh kill KHÔNG có phần hình ở đây, và đó là một nhánh tường minh chứ
     * không phải một chỗ bỏ trống.
     *
     * Chúng do `KillScene` dựng trọn vẹn - hình lẫn chữ - vì phần hình của
     * chúng phụ thuộc vào việc đêm nay ai chết, thứ mà một hàm nhận đúng một
     * `kind` không thể biết. Overlay đã không gọi tới đây cho hai kind ấy, và
     * hai `case` này chỉ để cái switch còn nói được sự thật: bỏ chúng đi thì
     * hàm âm thầm trả `undefined` cho hai giá trị hợp lệ, và người sửa sau sẽ
     * đọc ra rằng đây là hai cảnh chưa ai dựng.
     */
    case "NIGHT_KILL":
    case "EXECUTION":
      return null;
  }
}
