-- Khoá idempotency cho kết quả ván. NULL cho mọi ván ghi trước migration này:
-- Postgres cho phép nhiều NULL trong unique index nên dữ liệu cũ không đụng nhau.
ALTER TABLE "GameResult" ADD COLUMN "gameId" TEXT;
CREATE UNIQUE INDEX "GameResult_gameId_key" ON "GameResult"("gameId");
