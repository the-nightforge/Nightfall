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
import { canUseWebgl, hasWebglScene } from "@/lib/cinematic-webgl";
import { useModalFocus } from "@/lib/useModalFocus";
import { CinematicCanvas } from "./CinematicCanvas";
import { VillageSilhouette } from "./VillageSilhouette";
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
  const [videoReady, setVideoReady] = useState(false);
  const previous = useRef<RoomSnapshot | null>(null);
  const played = useRef(new Set<string>());
  const [mode, setMode] = useState<"video" | "css" | "none">("none");
  const [network, setNetwork] = useState<NetworkHints>({ saveData: false, effectiveType: null });
  const [webgl, setWebgl] = useState(false);
  /*
   * useCallback voi deps rong, KHONG phai arrow inline.
   *
   * CinematicCanvas dat `onFail` trong deps cua effect dung scene. Mot arrow
   * inline doi danh tinh moi lan render, ma overlay nay render lai theo TUNG
   * snapshot - nen scene se bi thao va dung lai lien tuc suot ca canh.
   * `webglBroken` o cap module va `setWebgl` on dinh, nen deps rong la dung.
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
    if (modeRef.current === "none") return;
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

  // Thứ tự quyết định: 3D nếu cảnh này có bản 3D và máy dựng được; nếu không
  // thì clip; nếu không nữa thì chỉ còn cảnh CSS bên dưới. Một cảnh KHÔNG bao
  // giờ chạy cả canvas lẫn video - không có lý do gì tải hai bản của một cảnh.
  const useWebgl = webgl && !webglBroken && hasWebglScene(playing.kind);
  const useVideo = !useWebgl && mode === "video" && !brokenClips.has(playing.clip);

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
        <SceneArt kind={playing.kind} />
      </div>

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

      {useVideo && (
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
            brokenClips.add(playing.clip);
            setVideoReady(false);
          }}
        >
          <source src={`${CLIP_BASE}/${playing.clip}.webm`} type="video/webm" />
          <source src={`${CLIP_BASE}/${playing.clip}.mp4`} type="video/mp4" />
        </video>
      )}

      {/* max-w + px-6: ở 390px dòng phụ phải xuống dòng gọn giữa màn chứ không
        * chạy sát hai mép, và cả khối vẫn nằm trong vùng an toàn giữa khung -
        * đúng vùng mà clip object-cover không cắt mất. */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center px-6">
        <div className="cine-caption max-w-md text-center">
          {eyebrow && (
            <p className="cine-eyebrow text-xs font-bold uppercase tracking-[0.2em] text-white/70">
              {playing.icon && (
                <span className="mr-1.5" aria-hidden="true">
                  {playing.icon}
                </span>
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

      <button
        ref={skipRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          finish();
        }}
        className="absolute bottom-6 right-5 rounded-full border border-white/25 bg-black/50 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
  }
}

/**
 * Máy này có WebGL2 không.
 *
 * Thử tạo context trên một canvas rời rồi bỏ đi ngay: đây là cách duy nhất
 * biết chắc, vì `window.WebGL2RenderingContext` tồn tại kể cả trên máy mà
 * driver từ chối cấp context thật.
 */
function hasWebgl2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}
