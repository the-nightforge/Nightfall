// PHẢI là import đầu tiên - xem instrument.ts.
import "./instrument";
import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { config, isProd } from "./config";
import { apiRouter } from "./http";
import { setupSocket } from "./ws";
import { setIo } from "./rooms/broadcast";
import { pingRedis, redis } from "./redis";
import { prisma } from "./db";
import { botBrain } from "./bots";
import { createLiveKitAdmin } from "./voice/livekit";
import { setVoiceAdmin } from "./voice/service";
import { initObjectStorage } from "./storage";
import { apiErrorFallback } from "./error-middleware";
import { securityHeaders } from "./security";
import { attachExpressErrorReporter, flushObservability, observabilityEnabled } from "./observability";

async function main(): Promise<void> {
  const corsOrigin = config.corsOrigin === "*" ? true : config.corsOrigin.split(",");

  const app = express();
  // Rate limit của /api/players khoá theo req.ip, mà sau proxy của Render thì
  // req.ip là IP load balancer nếu không khai báo - cả thiên hạ chung một rổ.
  app.set("trust proxy", config.trustProxy);
  // Trước cors: header an toàn phải có mặt cả trên phản hồi preflight.
  app.use(securityHeaders());
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json());

  // Không bao giờ log payload chứa dữ liệu bí mật ở production
  if (!isProd) {
    app.use((req, _res, next) => {
      console.log(`[http] ${req.method} ${req.path}`);
      next();
    });
  }

  app.use("/api", apiRouter);

  // Sentry ghi nhận rồi next(err) tiếp; apiErrorFallback bên dưới vẫn là bên
  // quyết định người gọi thấy gì. Không có SENTRY_DSN thì dòng này là no-op.
  attachExpressErrorReporter(app);

  // Xem apiErrorFallback trong error-middleware.ts để biết vì sao lưới này
  // cần thiết và vì sao nó được tách ra module riêng.
  app.use(apiErrorFallback);

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: corsOrigin },
  });

  setIo(io);
  setupSocket(io);

  // Adapter chỉ được gắn khi cấu hình LiveKit hợp lệ. `service.ts` lấy chính
  // việc "đã gắn hay chưa" làm câu trả lời cho "voice có bật không", nên không
  // có nguồn sự thật thứ hai.
  if (config.voice.enabled) setVoiceAdmin(createLiveKitAdmin(config.voice), config.voice);
  console.log(`[server] Voice chat: ${config.voice.enabled ? `bật (${config.voice.env})` : "tắt"}`);

  initObjectStorage(config.objectStorage);
  console.log(
    `[server] Object storage: ${
      config.objectStorage.enabled ? `bật (${config.objectStorage.bucket})` : "tắt - avatar tải lên bị vô hiệu"
    }`,
  );

  const redisOk = await pingRedis();
  console.log(`[server] Redis: ${redisOk ? "OK" : "KHÔNG kết nối được - kiểm tra docker compose"}`);
  console.log(`[server] Sentry: ${observabilityEnabled() ? "bật" : "tắt (không có SENTRY_DSN)"}`);
  // Không log key hay bất kỳ phần nào của nó - chỉ nêu tên bộ não đang dùng.
  console.log(`[server] Bot AI: ${botBrain().name === "random" ? "chạy ngẫu nhiên (random)" : `chuỗi ${botBrain().name}`}`);

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`[server] Ma Sói server đang chạy tại http://localhost:${config.port}`);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[server] Đang tắt...");
    const forceExit = setTimeout(() => process.exit(1), 5_000);
    forceExit.unref();
    io.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.allSettled([prisma.$disconnect(), redis.quit(), flushObservability()]);
    clearTimeout(forceExit);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("[server] Lỗi khởi động:", err);
  process.exit(1);
});
