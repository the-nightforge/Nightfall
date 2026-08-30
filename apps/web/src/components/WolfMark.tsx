/**
 * Dấu đầu sói.
 *
 * Một hình khối đơn chứ không phải emoji 🐺: mỗi hệ điều hành vẽ emoji đó một
 * kiểu, và trên Windows nó ra một con sói hoạt hình vui vẻ - sai hẳn giọng của
 * cả game. Nhận diện thương hiệu thì không nên phụ thuộc bộ font của máy người
 * xem.
 *
 * Ở file riêng để trang chủ dùng được mà không kéo theo CinematicOverlay: trang
 * chủ không phát chuyển cảnh nào và không có lý do gì phải tải phần đó về.
 */
export function WolfMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={className}>
      {/*
        * fill-rule evenodd để mắt và mõm là LỖ chứ không phải hình đè lên:
        * dấu này được tô bằng đủ thứ màu ở đủ thứ nền, và một đốm đen vẽ đè lên
        * chỉ đúng khi nền tình cờ cũng đen.
        */}
      <path
        fillRule="evenodd"
        d="M12 8 L32 30 C40 26 60 26 68 30 L88 8 L84 40 C90 52 86 66 76 74 L50 95 L24 74 C14 66 10 52 16 40 Z
           M30 46 L42 50 L38 58 L28 52 Z
           M70 46 L58 50 L62 58 L72 52 Z
           M50 70 L43 78 L50 83 L57 78 Z"
      />
    </svg>
  );
}
