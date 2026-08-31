/**
 * Xem trước cân bằng ở sảnh chờ.
 *
 * Trước đây file này chép tay lại toàn bộ `PRESET_DECKS` + thuật toán chấm điểm
 * của `packages/game-engine/src/balance/analyzer.ts`, với lý do né việc kéo
 * `game-engine` (kèm cả lõi engine và bộ não BOT) vào bundle Next. Cái giá là
 * hai bản luật rời nhau: server CHẶN theo bản engine còn sảnh chờ hiển thị theo
 * bản chép - chỉnh một bên là người chơi thấy "Cân bằng" rồi bấm Bắt đầu và bị
 * server từ chối.
 *
 * Luật nay nằm ở `@masoi/shared` (chỉ phụ thuộc `zod`, web vốn đã import
 * `ROLE_POWER` từ đó), nên cả hai đầu dùng chung đúng một hàm mà bundle không
 * phải gánh thêm gì.
 *
 * Vẫn ưu tiên `snapshot.balanceWarning` của server; hàm ở đây chỉ để xem trước
 * tức thì lúc host bật/tắt vai, trước khi snapshot kịp về.
 */
export { PRESET_DECKS, clamp, generateWarnings } from "@masoi/shared";
