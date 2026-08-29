/**
 * Script thử tay: gọi LiveKit thật một lượt để kiểm tra key, quyền và cách
 * nhận dạng lỗi. Không nằm trong `npm test` vì cần credential thật.
 * Chạy: npm run voice:probe (cần LIVEKIT_* trong apps/server/.env)
 *
 * Nó kiểm đúng những thứ mà test bằng adapter giả KHÔNG chứng minh được:
 *  - credential có thật sự dùng được không;
 *  - token ký ra mang đúng bộ grant, đặc biệt canPublish=false;
 *  - lỗi "participant không tồn tại" của LiveKit có được nhận dạng đúng thành
 *    VoiceNotFoundError không. Chỗ này là suy đoán trong code (khớp theo thông
 *    điệp và mã 404), và đoán sai sẽ khiến việc leo thang thu hồi token của
 *    người chưa từng dùng voice.
 */
import path from "node:path";
import dotenv from "dotenv";

// Cùng lý do như bot-probe: key nằm ở apps/server/.env còn script chạy từ thư
// mục gốc repo, và một biến cũ còn sót trong shell sẽ lặng lẽ che file.
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

import { resolveVoiceConfig } from "../src/config";
import {
  VoiceNotFoundError,
  createLiveKitAdmin,
  mintJoinToken,
} from "../src/voice/livekit";

const ROOM = "masoi-probe-ZZZZZ";

function decode(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

const results: Array<{ ok: boolean; label: string; detail?: string }> = [];
function check(ok: boolean, label: string, detail?: string): void {
  results.push({ ok, label, detail });
  console.log(`${ok ? "  OK  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  const config = resolveVoiceConfig(process.env);
  if (!config.enabled) {
    console.error("Chưa có LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET trong apps/server/.env");
    process.exitCode = 1;
    return;
  }

  console.log("Cấu hình");
  console.log("  url    :", config.url.replace(/\/\/([^.]+)\./, "//<project>."));
  console.log("  env    :", config.env);
  console.log("  key    :", `${config.apiKey.slice(0, 4)}*** (dài ${config.apiKey.length})`);
  console.log("  secret : *** (dài", `${config.apiSecret.length})`);
  console.log("");

  const admin = createLiveKitAdmin(config);

  console.log("Token");
  const token = await mintJoinToken(config, ROOM, "probe-player", "Probe");
  const video = decode(token).video as Record<string, unknown>;
  check(video.canPublish === false, "token KHÔNG mang quyền nói", `canPublish=${video.canPublish}`);
  check(
    video.canPublishSources === undefined,
    "token KHÔNG mang canPublishSources (nó ghi đè canPublish)",
  );
  check(video.canPublishData === false, "kênh dữ liệu bị đóng (mặc định của LiveKit là MỞ)");
  check(video.canSubscribe === true, "vẫn nghe được");
  check(decode(token).sub === "probe-player", "identity chính là playerId");
  const ttl = (decode(token).exp as number) - (decode(token).nbf as number);
  check(ttl === 120, "token sống 120 giây", `ttl=${ttl}s`);
  console.log("");

  console.log("Gọi API thật");
  try {
    await admin.createRoom(ROOM);
    check(true, "tạo được room tường minh (để áp emptyTimeout)");
  } catch (err) {
    check(false, "tạo room", err instanceof Error ? err.message : String(err));
    console.error("\nDừng ở đây: credential nhiều khả năng sai.");
    process.exit(1);
  }

  // Đây là phần đáng giá nhất của probe.
  try {
    await admin.updateParticipant(ROOM, "khong-ton-tai-bao-gio", {
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      canPublishSources: [],
      canUpdateMetadata: false,
      hidden: false,
    });
    check(false, "lỗi participant-không-tồn-tại", "LiveKit KHÔNG báo lỗi — giả định trong code sai");
  } catch (err) {
    check(
      err instanceof VoiceNotFoundError,
      "participant không tồn tại được nhận dạng thành VoiceNotFoundError",
      err instanceof VoiceNotFoundError
        ? undefined
        : `nhận được ${(err as Error).name}: ${(err as Error).message}`,
    );
  }

  try {
    await admin.deleteRoom(ROOM);
    check(true, "xoá được room");
  } catch (err) {
    check(false, "xoá room", err instanceof Error ? err.message : String(err));
  }

  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(failed.length === 0 ? "TẤT CẢ ĐỀU ĐẠT" : `${failed.length} mục KHÔNG đạt`);
  // exitCode chứ không phải process.exit(): thoát cưỡng bức trong lúc SDK còn
  // handle đang đóng làm libuv ném assertion ngay SAU dòng kết quả, trông như
  // probe hỏng trong khi nó vừa báo đạt.
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("Probe hỏng:", err);
  process.exitCode = 1;
});
