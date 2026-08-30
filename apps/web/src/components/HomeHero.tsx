import { VillageSilhouette } from "./VillageSilhouette";
import { WolfMark } from "./WolfMark";

/**
 * Nhận diện và khung cảnh của trang chủ.
 *
 * Dựng bằng SVG và gradient nội bộ, không một ảnh từ xa nào: trang chủ là thứ
 * đo Core Web Vitals, và một tấm hero tải về là thêm một lượt request nằm chắn
 * ngay trước LCP. Ở đây phần tử nặng nhất là một đường `path`.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={`relative grid shrink-0 place-items-center rounded-[28%] border border-blood-500/30 bg-gradient-to-br from-blood-600/25 via-night-800 to-night-900 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.9)] ${className ?? ""}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-[28%] bg-blood-500/10 blur-md motion-safe:animate-moonGlow"
      />
      <WolfMark className="relative h-3/5 w-3/5 fill-blood-400 drop-shadow-[0_2px_10px_rgba(220,38,64,0.45)]" />
    </span>
  );
}

/*
 * Toạ độ cố định chứ không random: random thì server và client dựng ra hai bầu
 * trời khác nhau, hydrate lệch, và React dựng lại cả nhánh.
 *
 * [trái %, trên %, cạnh px, độ mờ, trễ giây] - ba cỡ sao khác nhau để bầu trời
 * có chiều sâu; một dải sao đều tăm tắp trông ra một tấm lưới chứ không ra trời.
 */
const STARS: [number, number, number, number, number][] = [
  [6, 14, 2, 0.5, 0], [11, 31, 1, 0.35, 2.4], [17, 8, 2, 0.62, 1.1],
  [23, 22, 1, 0.3, 3.6], [29, 11, 3, 0.75, 0.6], [34, 34, 1, 0.28, 4.8],
  [41, 6, 2, 0.55, 2.9], [46, 26, 1, 0.34, 1.7], [52, 16, 2, 0.6, 5.2],
  [58, 4, 1, 0.32, 3.1], [63, 29, 2, 0.48, 0.9], [69, 12, 1, 0.36, 4.2],
  [76, 33, 2, 0.52, 2.1], [84, 6, 1, 0.3, 5.7], [88, 24, 2, 0.58, 1.4],
  [93, 15, 1, 0.33, 3.9], [97, 36, 2, 0.42, 0.3],
];

/** Đèn cửa sổ trong khối làng: [trái %, dưới %, cạnh px, trễ giây]. */
const WINDOWS: [number, number, number, number][] = [
  [13, 5.5, 3, 0], [21, 3.5, 2, 1.8], [37, 7, 3, 3.4],
  [44, 4, 2, 0.9], [58, 6, 3, 2.6], [67, 3.5, 2, 4.1], [81, 5, 3, 1.2],
];

/** Tàn lửa bay lên từ phía làng: [trái %, trễ giây, chu kỳ giây]. */
const EMBERS: [number, number, number][] = [
  [18, 0, 13], [39, 5.5, 16], [61, 2.5, 14], [78, 8, 18],
];

/**
 * Khung cảnh ngôi làng dưới trăng, phủ kín viewport.
 *
 * Không phải một tấm ảnh đặt trong khung: nó là NỀN của cả trang, và nội dung
 * đứng bên trong nó. Đặt `fixed` với z-index âm nên không tốn một pixel nào
 * trong luồng bố cục - trên điện thoại chỗ trên màn hình vẫn thuộc trọn về ô
 * biệt danh và ô mã phòng, đúng như khi chưa có cảnh này.
 *
 * z-index -9 để nằm ngay TRÊN `Backdrop` (-10) chứ không thay thế nó: bầu trời
 * gốc và vignette của `.backdrop-night` dùng lại nguyên, ở đây chỉ chồng thêm
 * trăng, sao, sương và hai lớp làng.
 */
export function VillageScene() {
  return (
    <div className="village-scene" aria-hidden="true">
      <div className="village-sky" />

      {/* Trăng lệch hẳn về phải: nguồn sáng của cả trang nằm ở đó, và mọi vệt
        * sáng trên panel form bên dưới đều đổ theo đúng hướng này. */}
      <div className="village-moon-halo motion-safe:animate-moonGlow" />
      <div className="village-moon" />

      {STARS.map(([left, top, size, opacity, delay]) => (
        <span
          key={`${left}-${top}`}
          className="village-star"
          style={{
            left: `${left}%`,
            top: `${top}%`,
            width: `${size}px`,
            height: `${size}px`,
            opacity,
            animationDelay: `${delay}s`,
          }}
        />
      ))}

      {/* Bóng sói chìm trong trời đêm. Mờ tới mức phải nhìn kỹ mới ra - nó là
        * một điềm báo chứ không phải một cái logo dán lên nền. */}
      <WolfMark className="village-wolf" />

      {/* Rặng làng xa: nhỏ hơn, xanh hơn, blur nhẹ. Đứng cao hơn dãy gần nên
        * đọc ra một sườn đồi phía sau. */}
      <VillageSilhouette preserveAspectRatio="xMidYMax slice" className="village-far" />

      <span className="village-fog village-fog-back motion-safe:animate-fogDrift" />

      {/* Quầng sáng ấm hắt lên từ sau nóc nhà - làng có người ở. */}
      <div className="village-hearth" />

      <VillageSilhouette preserveAspectRatio="xMidYMax slice" className="village-near" />

      {WINDOWS.map(([left, bottom, size, delay]) => (
        <span
          key={`w-${left}`}
          className="village-window motion-safe:animate-moonGlow"
          style={{
            left: `${left}%`,
            bottom: `${bottom}%`,
            width: `${size}px`,
            height: `${size}px`,
            animationDelay: `${delay}s`,
          }}
        />
      ))}

      {EMBERS.map(([left, delay, duration]) => (
        <span
          key={`e-${left}`}
          className="village-ember motion-safe:animate-emberFloat"
          style={{ left: `${left}%`, animationDelay: `${delay}s`, animationDuration: `${duration}s` }}
        />
      ))}

      {/* Sương lớp trước trôi ngược chiều lớp sau: một dải đơn trông như cả
        * khung hình đang trượt, hai dải mới ra chiều sâu. */}
      <span className="village-fog village-fog-front motion-safe:animate-fogDrift" />

      <div className="village-vignette" />
    </div>
  );
}
