/**
 * Script kiểm chứng tay: hỏi LiveKit xem participant đang có quyền gì THẬT SỰ.
 *
 * Đây là bằng chứng mà test bằng adapter giả không đưa ra được. Nó không nghe
 * bằng tai; nó đọc trạng thái quyền do chính LiveKit lưu, rồi in ra mỗi khi
 * quyền đổi - để đối chiếu với pha của ván đang chạy.
 *
 * Chạy: npx tsx apps/server/scripts/voice-watch.ts <MÃ_PHÒNG>
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

import { RoomServiceClient } from "livekit-server-sdk";
import { resolveVoiceConfig } from "../src/config";
import { apiUrl } from "../src/voice/livekit";
import { voiceRoomName } from "@masoi/shared";

const code = (process.argv[2] ?? "").toUpperCase();
if (!code) {
  console.error("Thiếu mã phòng. Ví dụ: npx tsx apps/server/scripts/voice-watch.ts ABCDE");
  process.exit(1);
}

const config = resolveVoiceConfig(process.env);
if (!config.enabled) {
  console.error("Chưa cấu hình LIVEKIT_* trong apps/server/.env");
  process.exit(1);
}

const roomName = voiceRoomName(config.env, code);
const client = new RoomServiceClient(apiUrl(config.url), config.apiKey, config.apiSecret);

console.log(`Theo dõi room ${roomName}. Ctrl+C để dừng.`);

let previous = "";

async function tick(): Promise<void> {
  let line: string;
  try {
    const participants = await client.listParticipants(roomName);
    line =
      participants.length === 0
        ? "(chưa ai vào room voice)"
        : participants
            .map((p) => {
              const perm = p.permission;
              const sources = (perm?.canPublishSources ?? []).join(",") || "-";
              return `${p.identity}: canPublish=${perm?.canPublish} sources=[${sources}] canPublishData=${perm?.canPublishData} canSubscribe=${perm?.canSubscribe} tracks=${p.tracks.length}`;
            })
            .join("\n           ");
  } catch (err) {
    line = `(chưa có room: ${err instanceof Error ? err.message.slice(0, 60) : String(err)})`;
  }

  // Chỉ in khi ĐỔI, để dòng nào hiện ra cũng là một sự kiện thật.
  if (line !== previous) {
    previous = line;
    console.log(`[${new Date().toLocaleTimeString()}] ${line}`);
  }
}

setInterval(() => void tick(), 1000);
void tick();
