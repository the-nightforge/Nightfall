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

async function main(): Promise<void> {
  const app = express();
  app.use(cors({ origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(",") }));
  app.use(express.json());

  // Không bao giờ log payload chứa dữ liệu bí mật ở production
  if (!isProd) {
    app.use((req, _res, next) => {
      console.log(`[http] ${req.method} ${req.path}`);
      next();
    });
  }

  app.use("/api", apiRouter);

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(",") },
  });

  setIo(io);
  setupSocket(io);

  const redisOk = await pingRedis();
  console.log(`[server] Redis: ${redisOk ? "OK" : "KHÔNG kết nối được - kiểm tra docker compose"}`);
  // Không log key hay bất kỳ phần nào của nó - chỉ nêu tên bộ não đang dùng.
  console.log(`[server] Bot AI: ${botBrain().name === "gemini" ? "Gemini đang bật" : "chạy ngẫu nhiên (random)"}`);

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
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
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
