/**
 * Ghi công tài nguyên hình ảnh.
 *
 * Cả hai bộ art đều là CC BY, và giấy phép đó đòi ghi công CHO NGƯỜI DÙNG tác
 * phẩm - một file markdown trong mã nguồn không đáp ứng được. Đây là mặt ghi
 * công duy nhất của game, nên đừng xoá nó, và thay bộ art nào thì sửa đúng
 * dòng của bộ đó.
 *
 * Nguồn đầy đủ: `src/lib/AVATAR-CREDITS.md` và `public/characters/SOURCES.md`.
 */
export function AssetCredits() {
  return (
    <footer className="mx-auto max-w-6xl px-4 pb-8 text-center text-[11px] leading-relaxed text-mist/65">
      <p>
        Chân dung nhân vật by{" "}
        <a
          href="https://studio-nik.itch.io"
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-mist/20 underline-offset-2 hover:text-mist/60"
        >
          Studio Nik
        </a>{" "}
        (CC BY 4.0) · Biểu tượng by Lorc, Delapouite và sbed tại{" "}
        <a
          href="https://game-icons.net"
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-mist/20 underline-offset-2 hover:text-mist/60"
        >
          game-icons.net
        </a>{" "}
        (CC BY 3.0)
      </p>
    </footer>
  );
}
