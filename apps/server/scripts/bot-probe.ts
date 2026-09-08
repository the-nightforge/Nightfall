/**
 * Script thử tay: gọi chuỗi nhà cung cấp một lần với ván giả để kiểm tra key và
 * prompt. Không nằm trong `npm test` vì cần API key thật (và tiêu tốn quota).
 * Chạy: npm run bot:probe (cần key trong apps/server/.env)
 */
import path from "node:path";
import dotenv from "dotenv";
import {
  DEFAULT_BOT_WEIGHTS,
  createBotPersonality,
  createSeededRng,
  deriveSpeechStyle,
  describeSpeechStyle,
} from "@masoi/game-engine";
import type { SpeechRequest } from "../src/bots/types";

// Script được chạy từ thư mục gốc repo (npm run bot:probe), nhưng key nằm ở
// apps/server/.env theo README - nạp rõ đường dẫn thay vì dựa vào cwd.
//
// override: mặc định dotenv nhường biến môi trường đã tồn tại, nên một key cũ
// còn sót trong shell sẽ lặng lẽ che key trong .env - probe báo hỏng trong khi
// key bạn vừa thêm hoàn toàn tốt, và chẳng có gì trong log chỉ ra điều đó. Với
// một công cụ chẩn đoán chạy tay thì file phải là nguồn sự thật.
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

/**
 * Ý định giả đã "chốt" sẵn, đúng hình dạng mà lõi deterministic phát ra. Probe
 * chỉ kiểm tra khâu diễn đạt: nhà cung cấp không còn chọn mục tiêu nữa.
 *
 * Phong cách dẫn xuất từ personality thật (gieo seed cố định) - đúng đường
 * `BotRuntime` đi, thay vì chuỗi nhãn cứng `personalityStyle` đã bị bỏ khỏi
 * `SpeechRequest`.
 */
const personality = createBotPersonality(createSeededRng("bot-probe"), DEFAULT_BOT_WEIGHTS);
const style = deriveSpeechStyle(personality);

const request: SpeechRequest = {
  roomCode: "PROBE",
  speaker: { id: "w", name: "Hải" },
  style,
  styleDescription: describeSpeechStyle(style),
  intention: {
    kind: "ACCUSE",
    targetId: "v",
    confidence: 0.72,
    tone: "FIRM",
    evidence: [
      {
        id: "2:nomination:5:LATE_SWITCH",
        kind: "LATE_SWITCH",
        sourceId: "2:nomination:5",
        actorId: "v",
        targetId: "s",
        weight: 7,
        confidence: 0.6,
        round: 2,
        summary: "đổi phiếu sang Sang khi chỉ còn vài giây",
      },
    ],
  },
  evidence: [
    { sourceId: "2:nomination:5", summary: "đổi phiếu sang Sang khi chỉ còn vài giây" },
  ],
  targetName: "Vân",
  replyTo: null,
  recentOwnLines: [],
  chatWindow: [],
  avoidOpenings: [],
  recentSpeechSourceIds: [],
  seq: 1,
  round: 2,
  players: [
    { id: "w", name: "Hải", alive: true },
    { id: "v", name: "Vân", alive: true },
    { id: "s", name: "Sang", alive: true },
  ],
  defense: null,
};

async function main() {
  // Import động, KHÔNG phải import tĩnh: import được hoisted lên trước mọi câu
  // lệnh, nên ../src/config sẽ chạy dotenv.config() theo cwd (gốc repo, không có
  // .env) trước khi dòng dotenv ở trên kịp trỏ đúng apps/server/.env - và cả
  // chuỗi nhà cung cấp bị dựng từ config rỗng.
  const { botBrain } = await import("../src/bots");
  const { speechTemplate } = await import("../src/bots/speech-renderer");

  // Đi qua đúng chuỗi mà server dùng, kể cả fallback - probe gọi thẳng một nhà
  // cung cấp sẽ không phát hiện được lỗi nằm ở khâu chọn hay khâu chuyển tiếp.
  const brain = botBrain();
  console.log(`Chuỗi: ${brain.name}`);

  const attempt = await brain.renderDaySpeech(request);
  if (!attempt.ok) {
    console.error("Mọi nhà cung cấp đều hỏng - xem dòng [bot] phía trên");
    // Đường lui mẫu vẫn nói được, nên probe in ra để phân biệt "chuỗi hỏng"
    // với "cả hệ thống câm".
    console.log("Mẫu dự phòng:", speechTemplate(request));
    process.exitCode = 1;
    return;
  }
  console.log("Kết quả:", attempt.value ?? "(chủ động không nói gì)");
}

main().catch((err) => {
  console.error("[bot-probe] Lỗi:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
