-- Cộng thêm cột, không phá gì: chạy được trên Neon TRƯỚC khi code mới lên
-- Render, và code cũ bỏ qua cột này mà không sao.
ALTER TABLE "Player" ADD COLUMN "avatarKey" TEXT;
