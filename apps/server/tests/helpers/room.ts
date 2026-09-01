import type { Room } from "../../src/rooms/store";

/**
 * Phần "bookkeeping" của một `Room`, dùng chung cho mọi fixture test.
 *
 * Tồn tại vì hơn bốn mươi file test dựng `Room` bằng tay, và chúng chỉ quan tâm
 * tới members/config/engine - phần còn lại là sổ sách của server mà bài test nào
 * cũng phải chép lại. Chép tay thì mỗi lần `Room` mọc thêm một trường là bốn
 * mươi chỗ phải sửa, và đó chính là cách các fixture này trôi lệch khỏi kiểu
 * thật rồi nói dối suốt một thời gian dài.
 *
 * Trải nó ở ĐẦU object literal, để giá trị nào bài test tự khai vẫn thắng.
 */
export const ROOM_SCAFFOLD = {
  gameId: null,
  resultWritten: false,
  pendingStep: null,
  phaseSeq: 0,
  kickedPlayerIds: [],
} satisfies Partial<Room>;
