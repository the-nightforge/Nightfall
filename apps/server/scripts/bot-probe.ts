/**
 * Script thử tay: gọi Gemini một lần với ván giả để kiểm tra key và prompt.
 * Không nằm trong `npm test` vì cần API key thật (và tiêu tốn quota free-tier).
 * Chạy: npm run bot:probe (cần GEMINI_API_KEY trong apps/server/.env)
 */
import path from "node:path";
import dotenv from "dotenv";
import { DEFAULT_ROOM_CONFIG, type RoomSnapshot } from "@masoi/shared";

// Script được chạy từ thư mục gốc repo (npm run bot:probe), nhưng key nằm ở
// apps/server/.env theo README - nạp rõ đường dẫn thay vì dựa vào cwd.
//
// override: mặc định dotenv nhường biến môi trường đã tồn tại, nên một key cũ
// còn sót trong shell sẽ lặng lẽ che key trong .env - probe báo hỏng trong khi
// key bạn vừa thêm hoàn toàn tốt, và chẳng có gì trong log chỉ ra điều đó. Với
// một công cụ chẩn đoán chạy tay thì file phải là nguồn sự thật.
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

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
  // Import động, KHÔNG phải import tĩnh: import được hoisted lên trước mọi câu
  // lệnh, nên ../src/config sẽ chạy dotenv.config() theo cwd (gốc repo, không có
  // .env) trước khi dòng dotenv ở trên kịp trỏ đúng apps/server/.env - và cả
  // chuỗi nhà cung cấp bị dựng từ config rỗng.
  const { botBrain } = await import("../src/bots");

  // Đi qua đúng chuỗi mà server dùng, kể cả fallback - probe gọi thẳng một nhà
  // cung cấp sẽ không phát hiện được lỗi nằm ở khâu chọn hay khâu chuyển tiếp.
  const brain = botBrain();
  console.log(`Chuỗi: ${brain.name}`);

  const attempt = await brain.decideDay(view);
  if (!attempt.ok) {
    console.error("Mọi nhà cung cấp đều hỏng - xem dòng [bot] phía trên");
    process.exitCode = 1;
    return;
  }
  console.log("Kết quả:", attempt.value ?? "(chủ động không nói gì)");
}

main().catch((err) => {
  console.error("[bot-probe] Lỗi:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
