-- Lịch sử ván (`GET /api/players/me/matches`) lọc bằng toán tử chứa jsonb `@>`,
-- thứ KHÔNG dùng được B-tree. Không có index này thì Postgres quét tuần tự toàn
-- bộ "GameResult" và giải mã jsonb từng dòng - trên đường vào của MỌI người
-- chơi, vì lịch sử nằm ngay ở trang chủ.
--
-- jsonb_path_ops chứ không phải lớp toán tử mặc định: nó chỉ phục vụ `@>`, tức
-- đúng và chỉ đúng truy vấn đang có, đổi lại index nhỏ hơn và tra nhanh hơn.
--
-- CỐ Ý KHÔNG kèm index cho "createdAt" DESC. Truy vấn lọc bằng GIN rồi mới
-- ORDER BY, và một bitmap scan từ GIN thường không kết hợp được với B-tree để
-- lấy sẵn thứ tự - nên index đó có thể không được dùng tới. Chỉ thêm nó kèm
-- một EXPLAIN ANALYZE cho thấy nó có ích thật.
CREATE INDEX IF NOT EXISTS "GameResult_playerRoles_idx"
  ON "GameResult" USING GIN ("playerRoles" jsonb_path_ops);
