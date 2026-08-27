/**
 * Script thử tay: gọi Gemini một lần với ván giả để kiểm tra key và prompt.
 * Không nằm trong `npm test` vì cần API key thật (và tiêu tốn quota free-tier).
 * Chạy: npm run bot:probe (cần GEMINI_API_KEY trong apps/server/.env)
 */
import path from "node:path";
import dotenv from "dotenv";
import { DEFAULT_ROOM_CONFIG, type RoomSnapshot } from "@masoi/shared";
import { GeminiBrain } from "../src/bots/gemini-brain";
import { BotGovernor } from "../src/bots/governor";

// Script được chạy từ thư mục gốc repo (npm run bot:probe), nhưng key nằm ở
// apps/server/.env theo README - nạp rõ đường dẫn thay vì dựa vào cwd.
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const view: RoomSnapshot = {
  code: "PROBE",
  hostId: "w",
  phase: "DAY_DISCUSSION",
  config: { ...DEFAULT_ROOM_CONFIG },
  round: 2,
  phaseEndsAt: null,
  you: { id: "w", name: "Hải", ready: true, connected: true, role: "WEREWOLF", alive: true },
  players: [
    { id: "w", name: "Hải", alive: true, isBot: true, role: "WEREWOLF" },
    { id: "v", name: "Vân", alive: true, isBot: false },
    { id: "s", name: "Sang", alive: true, isBot: false },
  ],
  night: null,
  myVote: null,
  votesRevealed: false,
  lastNightDeaths: [{ playerId: "x", name: "Bình" }],
  lastEliminated: null,
  winner: null,
  chatLog: [
    { id: "1", channel: "day", playerId: "v", playerName: "Vân", text: "Tôi nghi Hải đấy", at: 1 },
  ],
  log: [],
};

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Thiếu GEMINI_API_KEY trong apps/server/.env");
    process.exit(1);
  }

  const brain = new GeminiBrain({
    apiKey,
    model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
    governor: new BotGovernor(5),
    timeoutMs: 15_000,
  });

  const decision = await brain.decideDay(view);
  console.log("Kết quả:", decision);
  if (!decision) console.error("Không nhận được quyết định hợp lệ - xem log phía trên");
}

main().catch((err) => {
  console.error("[bot-probe] Lỗi:", err instanceof Error ? err.message : err);
  process.exit(1);
});
