"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import {
  cinematicFor,
  nextClips,
  type Cinematic,
  type CinematicKind,
} from "@/lib/cinematic-transition";
import { playbackMode, readPlaybackInputs } from "@/lib/cinematic-settings";
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

const CLIP_BASE = "/cinematics";

export function CinematicOverlay({ snapshot }: { snapshot: RoomSnapshot | null }) {
  const [playing, setPlaying] = useState<Cinematic | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const previous = useRef<RoomSnapshot | null>(null);
  const played = useRef(new Set<string>());
  const [mode, setMode] = useState<"video" | "css" | "none">("none");
  // Bản sao trong ref để effect chọn cảnh chỉ phụ thuộc snapshot: cho `mode` vào
  // deps thì đổi thiết lập giữa pha sẽ chạy lại effect và ghi đè `previous`.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  /*
   * Đọc thiết lập SAU khi hydrate, không phải trong lúc render: cả localStorage
   * lẫn matchMedia đều không tồn tại ở server, đọc thẳng thì cây DOM hai bên
   * lệch nhau. Khởi tạo "none" nên trong khoảnh khắc trước khi effect chạy,
   * cùng lắm là bỏ lỡ một cảnh - không bao giờ là phát nhầm một cảnh.
   */
  useEffect(() => {
    const apply = () => setMode(playbackMode(readPlaybackInputs()));
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

  useEffect(() => {
    if (!playing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, finish]);

  // Nạp trước chỉ những cảnh có thể tới ngay sau pha hiện tại, và chỉ sau khi đã
  // vào phòng - trang chủ không chạm tới component này nên nó không tải gì cả.
  useEffect(() => {
    if (mode !== "video" || !snapshot) return;
    for (const clip of nextClips(snapshot.phase)) {
      if (prefetched.has(clip) || brokenClips.has(clip)) continue;
      prefetched.add(clip);
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = `${CLIP_BASE}/${clip}.webm`;
      document.head.append(link);
    }
  }, [mode, snapshot]);

  if (!playing) return null;

  const useVideo = mode === "video" && !brokenClips.has(playing.clip);

  return (
    <div
      // Trên cả nút chat nổi (z-40) và tấm trượt chat (z-50).
      className="fixed inset-0 z-[70] cine-root"
      role="group"
      aria-label={`Chuyển cảnh: ${playing.label}`}
      // Chạm chỗ nào cũng bỏ qua. Đây là lý do lớp phủ ăn click thay vì cho
      // xuyên qua: một cú chạm lạc trong 1,2 giây đó mà rơi trúng "Bỏ phiếu"
      // bên dưới thì tệ hơn nhiều so với việc mất một đoạn chuyển cảnh.
      onClick={finish}
    >
      <div className={`cine-scene cine-${playing.kind.toLowerCase().replace(/_/g, "-")}`} aria-hidden="true">
        <SceneArt kind={playing.kind} />
      </div>

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

      <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 grid place-items-center px-6">
        <p className="cine-caption font-display text-3xl font-bold text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.9)] sm:text-4xl">
          {playing.label}
        </p>
      </div>

      {/* Nhãn cho trình đọc màn hình. Phần hình ở trên đã aria-hidden, nên đây
        * là chỗ duy nhất nói ra chuyện gì vừa xảy ra. */}
      <p className="sr-only" aria-live="polite">
        {playing.label}
      </p>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          finish();
        }}
        className="absolute bottom-6 right-5 rounded-full border border-white/25 bg-black/50 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-black/70"
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
