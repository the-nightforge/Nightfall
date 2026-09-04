/**
 * Vì sao bản án đi ngược bảng phiếu - nói cho ĐÚNG MỘT người.
 *
 * Server chỉ gửi cờ `yourWeightDecided` cho người vốn đã biết mình mang trọng số
 * ẩn, nên dòng chữ ở đây không tiết lộ gì mà người đọc chưa có. Cả làng vẫn chỉ
 * thấy bảng phiếu đếm đầu người và một kết quả không khớp với nó - đó là chất
 * liệu để suy luận, và nó phải ở lại trong ván.
 *
 * Không nêu con số: "phiếu của bạn tính hai" là thứ người này cần để thôi nghĩ
 * màn hình hỏng, còn số học của phép kiểm phiếu thì không.
 *
 * Đứng ở CẢ hai màn phán quyết - sân khấu Phiên toà sống và màn kết quả phẳng -
 * vì cùng một người chơi có thể gặp bản án qua bất kỳ màn nào trong hai.
 */
export function WeightDecidedNote({ lynched }: { lynched: boolean }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-[13px] font-semibold text-amber-100">
      <span aria-hidden="true">👑</span>
      Phiếu của bạn tính hai, và chính nó làm nên {lynched ? "bản án này" : "kết quả này"} - bảng
      phiếu đếm đầu người không cho thấy trọng số nào.
    </p>
  );
}
