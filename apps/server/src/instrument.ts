/**
 * Dòng import ĐẦU TIÊN của `index.ts`, và chỉ làm một việc: bật Sentry trước
 * khi express/http/socket.io được nạp, để SDK kịp móc vào chúng.
 *
 * Tự gọi `dotenv.config()` thay vì dựa vào `config.ts`: module đó đứng sau
 * express trong thứ tự nạp, mà SENTRY_DSN trong `.env` phải có mặt ở đây rồi.
 * `dotenv.config()` không ghi đè biến đã có nên gọi hai lần vô hại.
 */
import dotenv from "dotenv";
import { initObservability } from "./observability";

dotenv.config();
initObservability();
