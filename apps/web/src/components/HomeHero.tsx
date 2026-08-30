import { VillageSilhouette } from "./VillageSilhouette";
import { WolfMark } from "./WolfMark";

/**
 * Nhận diện của trang chủ.
 *
 * Dựng bằng SVG và gradient nội bộ, không một ảnh từ xa nào: trang chủ là thứ
 * đo Core Web Vitals, và một tấm hero tải về là thêm một lượt request nằm chắn
 * ngay trước LCP. Ở đây phần tử nặng nhất là một đường `path`.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={`relative grid place-items-center rounded-2xl border border-blood-500/30 bg-gradient-to-br from-blood-600/25 via-night-800 to-night-900 shadow-lg shadow-blood-950/40 ${className ?? ""}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-2xl bg-blood-500/10 blur-md motion-safe:animate-moonGlow"
      />
      <WolfMark className="relative h-3/5 w-3/5 fill-blood-400 drop-shadow-[0_2px_10px_rgba(220,38,64,0.45)]" />
    </span>
  );
}

/**
 * Khung cảnh ngôi làng dưới trăng.
 *
 * Chỉ dựng từ `lg` trở lên: trên điện thoại chỗ trên màn hình là để cho biệt
 * danh và mã phòng, còn màn desktop thì có nguyên nửa trái bỏ không.
 */
export function HomeHero({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`relative aspect-[5/4] overflow-hidden rounded-3xl border border-white/[0.07] ${className ?? ""}`}
      style={{
        background:
          "radial-gradient(120% 80% at 78% 12%, rgba(150, 180, 240, 0.18), transparent 62%)," +
          "radial-gradient(100% 70% at 20% 105%, rgba(180, 108, 60, 0.14), transparent 68%)," +
          "linear-gradient(180deg, #0c1424 0%, #060a14 100%)",
      }}
    >
      {/* Sao. Toạ độ cố định chứ không random: random thì mỗi lần server và
        * client dựng ra hai bầu trời khác nhau và React dựng lại cả nhánh. */}
      {[
        [14, 18], [28, 9], [41, 26], [57, 13], [68, 31], [82, 20], [91, 38], [22, 41], [50, 6],
      ].map(([left, top]) => (
        <span
          key={`${left}-${top}`}
          className="absolute h-[2px] w-[2px] rounded-full bg-white/70"
          style={{ left: `${left}%`, top: `${top}%` }}
        />
      ))}

      <span className="absolute right-[14%] top-[12%] h-24 w-24 rounded-full bg-gradient-to-br from-[#f2f6ff] via-[#c9d8f5] to-[#7d93bd] shadow-[0_0_70px_20px_rgba(150,180,240,0.22)] motion-safe:animate-moonGlow" />

      {/* Hai dải sương trôi ngược chiều nhau: một dải đơn trông như cả khung
        * hình đang trượt, hai dải mới ra chiều sâu. */}
      <span className="absolute inset-x-[-10%] bottom-[26%] h-24 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent blur-xl motion-safe:animate-fogDrift" />
      <span
        className="absolute inset-x-[-10%] bottom-[8%] h-28 bg-gradient-to-r from-transparent via-white/[0.05] to-transparent blur-lg motion-safe:animate-fogDrift"
        style={{ animationDirection: "reverse", animationDuration: "34s" }}
      />

      <VillageSilhouette className="absolute inset-x-0 bottom-0 h-[46%] w-full fill-[#03060d]" />

      {/* Tối bốn góc, cùng thủ pháp với Backdrop trong phòng, để khung cảnh
        * chìm vào nền trang thay vì nổi lên như một tấm ảnh dán. */}
      <span
        className="absolute inset-0"
        style={{
          background: "radial-gradient(120% 78% at 50% 44%, transparent 40%, rgba(0,0,0,0.6) 100%)",
        }}
      />
    </div>
  );
}
