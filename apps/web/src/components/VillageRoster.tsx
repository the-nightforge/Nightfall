import type { VillageLegendEntry, VillageLightState } from "@/lib/village-memory";

/**
 * Ký hiệu kèm theo mỗi trạng thái.
 *
 * `aria-hidden` và luôn đi CÙNG dòng chữ đầy đủ, không bao giờ thay nó: một
 * emoji mặt trăng không đọc ra "nhà đã tắt đèn" ở bất kỳ trình đọc màn hình
 * nào, và ở cỡ chữ nhỏ thì ba pha trăng cũng khó phân biệt. Nó ở đây để mắt
 * quét nhanh, còn nghĩa nằm ở `statusLabel`.
 */
const GLYPH: Record<VillageLightState, string> = {
  lit: "🪟",
  extinguishing: "🌘",
  dark: "🌑",
};

interface Props {
  entries: VillageLegendEntry[];
  /** Sắc của bước hiện tại, dùng viền cho những nhà đang là tâm điểm. */
  accent: string;
  /**
   * "wide" là khi bảng này CHÍNH LÀ ngôi làng - bản dự phòng 2D, chiếm cả khung.
   * "compact" là khi nó nằm dưới mô hình 3D, thu gọn được và có vùng cuộn riêng.
   */
  layout: "wide" | "compact";
}

/**
 * Bảng nhà: ai ở nhà nào, vai gì, đèn còn sáng không.
 *
 * MỘT component cho cả hai chế độ. Bản đầu chỉ có bảng này ở đường dự phòng 2D,
 * nên khi WebGL chạy được - tức là gần như luôn luôn - người xem nhìn thấy mười
 * lăm khối nhà giống nhau với mấy vòng màu dưới chân và không có cách nào biết
 * nhà nào của ai. Màu vai thì người mù màu không đọc được, và tên thì không thể
 * dựng bằng 3D text: chữ trong canvas không đọc được bằng trình đọc màn hình,
 * không bôi đen được, không giãn theo cỡ chữ hệ thống, và tiếng Việt có dấu là
 * chỗ font dự phòng vỡ trước nhất.
 *
 * Nên lớp thông tin ở đây là DOM, và nó dùng chung cho cả 3D lẫn 2D - mất
 * context WebGL giữa chừng không được đổi nội dung người xem đang đọc.
 */
export function VillageRoster({ entries, accent, layout }: Props) {
  if (entries.length === 0) return null;
  const wide = layout === "wide";
  const litCount = entries.filter((entry) => entry.state === "lit").length;

  const list = (
    <ul
      className={
        wide
          ? "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
          : // KHÔNG có vùng cuộn riêng ở đây. Bản đầu cho bảng này một
            // `max-h-36 overflow-y-auto`, và nó nằm lồng bên trong vùng cuộn của
            // tấm chú thích - hai vùng cuộn lồng nhau trên điện thoại là một cái
            // bẫy: ngón tay không biết mình đang cuộn cái nào, và cái trong luôn
            // nuốt cú vuốt trước. Trần chiều cao giờ đặt một lần cho cả tấm.
            "mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3"
      }
    >
      {entries.map((entry) => (
        <li
          key={entry.playerId}
          // `aria-current="step"` chứ không phải một cái viền sáng: người dùng
          // trình đọc màn hình cũng phải biết bước này đang nói về ai.
          aria-current={entry.focused ? "step" : undefined}
          className={`rounded-lg border ${wide ? "px-3 py-2.5" : "px-2.5 py-1.5"} ${
            entry.focused ? "bg-white/[0.07]" : "border-white/[0.07] bg-night-800/50"
          }`}
          style={entry.focused ? { borderColor: accent } : undefined}
        >
          <p className="flex items-baseline gap-1.5">
            <span aria-hidden="true" className="shrink-0 text-sm">
              {GLYPH[entry.state]}
            </span>
            <span
              className={`min-w-0 flex-1 truncate text-sm font-semibold ${
                entry.state === "dark" ? "text-mist-strong line-through" : "text-white"
              }`}
            >
              {entry.name}
            </span>
            {/* Tâm điểm nói bằng CHỮ, không chỉ bằng viền màu. */}
            {entry.focused && (
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-white/70">
                Tâm điểm
              </span>
            )}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-mist-strong">
            {entry.roleLabel} · {entry.teamLabel}
          </p>
          <p className="truncate text-[11px] text-mist/85">{entry.statusLabel}</p>
        </li>
      ))}
    </ul>
  );

  if (wide) {
    return (
      <section aria-labelledby="village-roster-heading">
        <p
          id="village-roster-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-mist"
        >
          Ngôi làng
        </p>
        {list}
      </section>
    );
  }

  /*
   * `open` mặc định: cả điểm của bản sửa này là thông tin phải NHÌN THẤY được
   * khi 3D đang chạy, và một danh sách gấp lại thì mặc định là không thấy.
   * Người xem muốn dành hết chỗ cho mô hình thì gập nó lại - và đó là một cú
   * bấm, không phải một thứ phải đi tìm trong thiết lập.
   */
  return (
    <details open className="mt-3 border-t border-white/[0.06] pt-2">
      <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-[0.2em] text-mist">
        Ngôi làng · {entries.length} nhà · {litCount} còn sáng
      </summary>
      {list}
    </details>
  );
}
