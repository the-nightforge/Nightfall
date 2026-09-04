/**
 * Bóng một người, không phải bóng của MỘT người.
 *
 * Đây là kẻ ra tay trong cảnh `NIGHT_KILL`, và toàn bộ giá trị của nó nằm ở
 * những thứ nó KHÔNG có:
 *
 *   - không mặt, không mắt, không miệng - không có gì để đọc ra ai;
 *   - không tai nhọn, không mõm, không bờm: một bóng sói sẽ khẳng định hộ cả
 *     bàn đúng cái điều mà cả pha thảo luận sinh ra để tranh cãi;
 *   - không dao, không móng vuốt, không lọ thuốc. Cùng một bóng này đi qua mọi
 *     nguyên nhân chết - Sói cắn, Bình Độc, nhát dao trong đêm, Nước thánh phản
 *     vệ - nên hình dáng của nó không được nghiêng về nguyên nhân nào.
 *
 * Hình khối cố ý mơ hồ: một tấm áo choàng loe dần xuống dưới, vai xuôi, đầu
 * trùm kín. Nó đọc ra là "có ai đó đã ở đây", và dừng đúng ở đó.
 *
 * Là một `<svg>` viết tay ngay trong repo - không tải file, không phụ thuộc bộ
 * art nào, và trả lời được câu hỏi giấy phép bằng đúng một câu.
 */
export function ShadowFigure({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 160"
      className={className}
      // Bóng này không mang thông tin nào cho trình đọc màn hình, và nó KHÔNG
      // ĐƯỢC mang: cả điểm của nó là ẩn danh. Câu tường thuật của cảnh nằm ở
      // tiêu đề, nơi `aria-labelledby` của lớp phủ trỏ vào.
      aria-hidden="true"
      focusable="false"
    >
      {/*
       * Mép dưới tan vào bóng tối thay vì cắt ngang bằng một đường thẳng: một
       * siluet có đáy phẳng đọc ra như một hình dán, còn cái này phải đọc ra
       * như một mảng tối đang tiến lại.
       */}
      <defs>
        <linearGradient id="kill-shadow-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="52%" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      {/*
       * Tỉ lệ ở đây là thứ quyết định nó đọc ra là NGƯỜI hay là một quân cờ.
       *
       * Bản đầu cho tà áo loe thẳng từ cổ ra tới hết bề ngang khung, và trên
       * màn rộng nó thành một hình chuông có cái đầu tròn bên trên - đúng bóng
       * một quân tốt, không phải bóng một người. Bản này giữ ba mốc gần với
       * người thật: mũ trùm hẹp (rộng 48/120), vai rộng gấp gần đôi đầu
       * (18..106), và tà áo chỉ loe thêm 18% so với vai chứ không xoè ra.
       *
       * Đầu đặt ở x=62 chứ không phải 60 - lệch phải hai đơn vị. Một siluet
       * đối xứng tuyệt đối đứng yên như một biểu tượng; lệch một chút thì nó
       * đang đi.
       */}
      <path
        fill="url(#kill-shadow-fade)"
        d="
          M 62 4
          C 48.5 4 38.5 14.5 38 28.5
          C 37.7 35 39.3 40.5 42.5 44.5
          C 30 49.5 21.5 58.5 18 70
          L 10 160
          L 114 160
          L 106 70
          C 102.5 58.5 94 49.5 81.5 44.5
          C 84.7 40.5 86.3 35 86 28.5
          C 85.5 14.5 75.5 4 62 4
          Z
        "
      />
    </svg>
  );
}
