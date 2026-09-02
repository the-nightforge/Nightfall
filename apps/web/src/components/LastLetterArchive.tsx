import type { CaseLastLetter } from "@masoi/shared";

/**
 * "Những phong thư đã mở" - mục xem lại sau trận.
 *
 * MỘT component cho cả hai chỗ đọc lại: màn kết thúc ván và lịch sử trận. Cả
 * hai đều lấy dữ liệu từ cùng một chỗ trong `CaseFile`, nên hai bản vẽ riêng sẽ
 * chỉ tạo ra hai câu chữ phải giữ cho khớp nhau.
 *
 * Mục RIÊNG, không trộn vào danh sách bước ngoặt. Một lá thư không tự nó là
 * điểm ngoặt của ván - phần lớn là một linh cảm đã sai - và ép nó vào danh sách
 * đó sẽ làm loãng đúng thứ mà danh sách kia dựng ra để nói.
 *
 * Nhận `CaseLastLetter[]` chứ không nhận `CaseFile`: kiểu đó không có trường
 * vai, nên không có gì để lỡ tay vẽ ra.
 */
export function LastLetterArchive({
  letters,
  compact = false,
}: {
  letters: CaseLastLetter[];
  compact?: boolean;
}) {
  if (letters.length === 0) return null;

  return (
    <section
      className={compact ? "" : "card space-y-3"}
      aria-labelledby={compact ? undefined : "last-letters-heading"}
    >
      <p
        id={compact ? undefined : "last-letters-heading"}
        className="text-xs font-semibold uppercase tracking-[0.2em] text-mist"
      >
        Những phong thư đã mở
      </p>
      <ul className="space-y-2">
        {letters.map((letter, index) => (
          <li
            key={`${letter.authorId}-${index}`}
            className="rounded-lg border border-amber-500/20 bg-amber-950/10 px-3 py-2.5"
          >
            <p className="text-sm font-bold text-amber-200">{letter.authorName}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-mist-strong">
              {letter.text}
            </p>
            <p className="mt-1 text-[11px] text-mist/65">
              Niêm phong ở vòng {letter.sealedRound}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
