import type { EventGlyphName } from "@/lib/event-art";
import { WolfMark } from "./WolfMark";

/**
 * Dấu hiệu của từng sự kiện, vẽ bằng SVG.
 *
 * Trước đây chỗ này dùng emoji: 🔇 🕊️ 🩸 🐾 🛡️ 🐺 👁️ ⚖️ 📰 👻. Nó vi phạm đúng
 * cái nguyên tắc mà `WolfMark.tsx` đã viết ra và giải thích: mỗi hệ điều hành
 * vẽ emoji một kiểu, và bản Windows thường là hoạt hình vui vẻ - sai hẳn giọng
 * của một ván Ma Sói. Trên Linux thiếu font emoji thì còn ra ô vuông trống.
 *
 * Toàn bộ là silhouette một màu và `currentColor`, không gradient, không nét
 * mảnh: chúng nằm ở nền với độ mờ 15-25%, nên chi tiết nhỏ chỉ thành nhiễu.
 * Đổi màu bằng class `text-*` của Tailwind như mọi chỗ khác.
 */
/*
 * Danh sách tên sống ở `lib/event-art.ts`, không ở đây.
 *
 * Bảng tra sự kiện -> tên hình phải nằm trong một module thuần (chuyển cảnh
 * import nó từ `node --test`), nên union đi cùng bảng đó. File này chỉ nhập lại
 * và vẽ. Re-export để `EventEnvironment` và các file khác vẫn lấy tên từ nơi
 * chúng lấy hình - một import thay vì hai.
 */
export type { EventGlyphName };

const PATHS: Record<Exclude<EventGlyphName, "wolf">, string> = {
  // Loa bị gạch chéo.
  silence:
    "M6 40v20h12l16 14V26L18 40H6z M52 34l16 16m0-16L52 50",
  /*
   * Cờ trắng cho Ngày Ân Xá, không phải chim bồ câu.
   *
   * Đã thử vẽ bồ câu và nó ra hình một cái lá - một con chim đang bay cần đủ
   * chi tiết để đọc ra, mà ở độ mờ 25% trên nền đêm thì chi tiết chỉ thành
   * nhiễu. Lá cờ đình chiến đọc ra ngay ở mọi cỡ và đúng nghĩa của pha này.
   */
  flag: "M20 8h7v84h-7z M27 14h56l-13 16 13 16H27z",
  // Giọt máu.
  blood: "M50 12c10 16 20 28 20 40a20 20 0 1 1-40 0c0-12 10-24 20-40z",
  // Bàn chân sói: bốn ngón và một đệm.
  paw: "M28 34a8 9 0 1 0 0.1 0z M50 28a8 10 0 1 0 0.1 0z M72 34a8 9 0 1 0 0.1 0z M50 52c12 0 20 8 20 16s-8 12-20 12-20-4-20-12 8-16 20-16z",
  // Khiên.
  shield: "M50 10l30 10v24c0 20-14 34-30 42-16-8-30-22-30-42V20l30-10z",
  // Mắt: hình quả hạnh và con ngươi.
  eye: "M6 50c12-18 26-27 44-27s32 9 44 27c-12 18-26 27-44 27S18 68 6 50z M50 36a14 14 0 1 1 0 28 14 14 0 0 1 0-28z",
  // Cán cân công lý.
  scales:
    "M48 12h4v66h-4z M30 78h40v5H30z M14 30h72v4H14z M14 32L4 56h20L14 32z M86 32L76 56h20L86 32z",
  // Tờ báo: khung và ba dòng chữ.
  report:
    "M12 20h76v60H12z M20 28h30v18H20z M56 28h24v5H56z M56 38h24v5H56z M20 54h60v5H20z M20 64h44v5H20z",
  // Bóng ma: vòm trên và viền dưới lượn sóng.
  ghost:
    "M50 8c19 0 34 15 34 34v50l-11-10-12 10-11-10-11 10-12-10-11 10V42C16 23 31 8 50 8z",
  /*
   * Trăng lưỡi liềm = hai đường tròn chồng nhau, phần giao thành lỗ nhờ evenodd.
   *
   * Bản đầu viết bằng hai cung nối tiếp và nó KHÔNG hiện gì cả: dây cung dài
   * đúng 88 trong khi bán kính 44, tức bằng chẵn đường kính - cung suy biến
   * thành nửa vòng tròn. Cung thứ hai bán kính 36 lại có dây cung 88 > 72, nên
   * theo spec SVG bán kính bị phóng lên vừa đủ, thành 44 - trùng khít cung thứ
   * nhất, diện tích bằng 0.
   */
  moon: "M50 10a40 40 0 1 0 0.1 0z M66 6a34 34 0 1 0 0.1 0z",
  // Đồng hồ: vành và hai kim.
  clock: "M50 6a44 44 0 1 0 0.1 0z M50 22v30l22 12",
};

/** Nét nào tô đặc, nét nào chỉ vẽ viền. */
const STROKED: ReadonlySet<EventGlyphName> = new Set(["silence", "clock"]);

export function EventGlyph({
  name,
  className,
}: {
  name: EventGlyphName;
  className?: string;
}) {
  // Đầu sói dùng lại đúng dấu của thương hiệu chứ không vẽ con thứ hai: hai
  // con sói khác nhau trong cùng một game là hai thương hiệu.
  if (name === "wolf") return <WolfMark className={`fill-current ${className ?? ""}`} />;

  const stroked = STROKED.has(name);
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={className}>
      <path
        d={PATHS[name]}
        // evenodd để con ngươi của mắt và phần khuyết của trăng là LỖ chứ không
        // phải hình đè lên - chúng được tô ở đủ thứ nền, và một đốm đặc vẽ đè
        // chỉ đúng khi nền tình cờ cùng màu.
        fillRule="evenodd"
        fill={stroked ? "none" : "currentColor"}
        stroke={stroked ? "currentColor" : "none"}
        strokeWidth={stroked ? 7 : undefined}
        strokeLinecap={stroked ? "round" : undefined}
        strokeLinejoin={stroked ? "round" : undefined}
      />
    </svg>
  );
}
