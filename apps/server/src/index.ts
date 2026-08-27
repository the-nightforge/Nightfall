import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { config, isProd } from "./config";
import { apiRouter } from "./http";
import { setupSocket } from "./ws";
import { setIo } from "./rooms/broadcast";
import { pingRedis } from "./redis";

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

  server.listen(config.port, () => {
    console.log(`[server] Ma Sói server đang chạy tại http://localhost:${config.port}`);
  });

  const shutdown = () => {
    console.log("[server] Đang tắt...");
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[server] Lỗi khởi động:", err);
  process.exit(1);
});
