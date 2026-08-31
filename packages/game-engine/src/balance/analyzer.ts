// Luật cân bằng đã dọn về `@masoi/shared`: server chặn cấu hình lệch và sảnh
// chờ xem trước phải chấm bằng CÙNG một hàm, nếu không sảnh chờ báo "Cân bằng"
// trong khi server từ chối. Giữ lại lối import cũ cho các chỗ đang dùng.
export { calculateBalanceScore, generateWarnings } from "@masoi/shared";
