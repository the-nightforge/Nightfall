import Link from "next/link";

/**
 * Trang 404 mặc định của Next là nền trắng chữ đen - lạc hẳn khỏi một game
 * tông tối, và không có lối nào về ngoài nút Back của trình duyệt.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-display text-2xl font-bold text-white">Không có gì ở đây</h1>
      <p className="text-sm text-mist/85">
        Đường dẫn này không tồn tại. Vào phòng bằng mã 5 ký tự từ trang chủ.
      </p>
      <Link href="/" className="btn-primary">
        Về trang chủ
      </Link>
    </main>
  );
}
