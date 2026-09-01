/*
  Xoá bảng `RoomRecord`.

  Migration NÀY LẼ RA phải đi kèm commit bỏ model khỏi schema.prisma nhưng đã
  bị thất lạc, nên `main` rơi vào trạng thái schema và migration nói hai điều
  khác nhau: schema không có model, còn migration `init` vẫn CREATE TABLE nó.
  Trên một database mới tinh (production, hoặc máy dev mới) `migrate deploy` vì
  thế vẫn dựng bảng rồi bỏ đó vĩnh viễn, và lần `migrate dev` kế tiếp báo drift.

  ĐÂY LÀ THAO TÁC PHÁ HUỶ: dữ liệu trong bảng mất hẳn, chỉ khôi phục được từ
  bản sao lưu. Lý do vẫn xoá:

  1. Không dòng code nào ĐỌC bảng này - chỉ có một `create` lúc mở phòng và một
     `updateMany` lúc đóng, cả hai đã được gỡ.

  2. Dữ liệu trong đó vốn đã không đáng tin. `code` có ràng buộc UNIQUE, nhưng
     vòng sinh mã phòng chỉ tránh các phòng ĐANG hoạt động (RAM + Redis) chứ
     không tra bảng này. Mã dùng lại sau khi phòng cũ đóng làm `create` ném lỗi
     trùng khoá, và lời gọi đó nằm trong một `catch {}` rỗng - lỗi bị nuốt im
     lặng, bảng càng chạy lâu càng thiếu bản ghi.

  Thông tin phòng còn cần thì đã nằm ở `GameResult.roomCode`.
*/
-- DropTable
DROP TABLE "RoomRecord";
