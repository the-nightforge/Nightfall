import { redis } from "../redis";
import { roomEnvelopeSchema, type RoomEnvelopeV1 } from "./schema";

/** Phòng đang sống. Đủ dài cho một buổi chơi, đủ ngắn để rác tự biến mất. */
export const ROOM_TTL_SECONDS = 6 * 60 * 60;
/** Ván đã kết thúc: chỉ cần sống qua màn lật bài và vài phút bàn tán. */
export const FINISHED_ROOM_TTL_SECONDS = 60 * 60;
/** Bản hỏng giữ lại một ngày để còn mổ xẻ, rồi tự biến mất. */
const QUARANTINE_TTL_SECONDS = 24 * 60 * 60;

const roomKey = (code: string): string => `room:${code}`;

export type LoadResult =
  | { status: "ok"; envelope: RoomEnvelopeV1 }
  | { status: "missing" }
  | { status: "unavailable" }
  | { status: "corrupt"; reason: string };

/**
 * Ghi có kiểm tra thứ tự.
 *
 * Một lời ghi mang `opSeq` nhỏ hơn bản đang nằm trong Redis là một lời ghi về
 * muộn - nó mô tả một tình thế đã cũ. Đè lên là làm mất những gì vừa xảy ra,
 * nên nó bị bỏ. So sánh phải nằm TRONG Redis chứ không phải đọc-rồi-ghi ở đây:
 * hai lời ghi chen nhau giữa hai bước đó sẽ lọt qua.
 */
const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current then
  local ok, parsed = pcall(cjson.decode, current)
  if ok and parsed.opSeq and tonumber(parsed.opSeq) > tonumber(ARGV[2]) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
`;

/**
 * Ghi snapshot. Best-effort có chủ đích: Redis là bản sao, RAM mới là nguồn
 * đang chạy, nên một lần ghi hỏng không được phép chặn ván đang diễn ra.
 */
export async function saveEnvelope(
  envelope: RoomEnvelopeV1,
  ttlSeconds: number,
): Promise<void> {
  try {
    await redis.eval(
      CAS_SCRIPT,
      1,
      roomKey(envelope.room.code),
      JSON.stringify(envelope),
      String(envelope.opSeq),
      String(ttlSeconds),
    );
  } catch {
    // Không log ở đây: `redis.ts` đã có bộ gộp cảnh báo mất kết nối, và một lần
    // ghi hỏng mỗi hành động sẽ nhấn chìm log.
  }
}

/**
 * Cách ly một bản snapshot không đọc được.
 *
 * Không xoá thẳng: bản hỏng là bằng chứng DUY NHẤT để lần ra vì sao nó hỏng, và
 * sau 24h nó tự biến mất. Key gốc thì phải biến mất ngay, nếu không mỗi lần
 * người chơi thử vào lại là một lần đọc đúng bản hỏng đó.
 */
async function quarantine(code: string, raw: string, reason: string): Promise<void> {
  console.warn(
    JSON.stringify({
      event: "snapshot.invalid",
      roomCode: code,
      reason,
      bytes: raw.length,
      quarantinedUntilSeconds: QUARANTINE_TTL_SECONDS,
    }),
  );
  try {
    await redis.set(
      `${roomKey(code)}:quarantine:${Date.now()}`,
      raw,
      "EX",
      QUARANTINE_TTL_SECONDS,
    );
    await redis.del(roomKey(code));
  } catch {
    /* Redis hỏng thì không cách ly được; lần đọc sau sẽ thử lại */
  }
}

/**
 * Đọc snapshot, PHÂN LOẠI kết quả.
 *
 * Bốn kết quả này không được gộp lại: "Redis đang chết" và "phòng không tồn
 * tại" dẫn tới hai hành xử trái ngược nhau ở tầng trên - một bên phải bảo người
 * chơi thử lại và giữ nguyên mọi thứ, bên kia thì dọn sạch. Gộp chúng chính là
 * cách mất một ván chỉ vì Redis chớp mắt một giây.
 */
export async function loadEnvelope(code: string): Promise<LoadResult> {
  let raw: string | null;
  try {
    raw = await redis.get(roomKey(code));
  } catch {
    return { status: "unavailable" };
  }

  if (!raw) return { status: "missing" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await quarantine(code, raw, "json-parse-failed");
    return { status: "corrupt", reason: "json-parse-failed" };
  }

  const result = roomEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    // Ghi lại tối đa vài issue đầu: đủ để lần ra nguyên nhân, không đủ để lộ
    // nội dung ván ra log.
    const reason = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".")}: ${issue.code}`)
      .join("; ");
    await quarantine(code, raw, reason || "schema-mismatch");
    return { status: "corrupt", reason: reason || "schema-mismatch" };
  }

  return { status: "ok", envelope: result.data };
}

/** Xoá hẳn snapshot của phòng. Dùng khi phòng bị xoá khỏi bộ nhớ. */
export async function deleteEnvelope(code: string): Promise<void> {
  try {
    await redis.del(roomKey(code));
  } catch {
    /* hết TTL thì nó cũng tự biến mất */
  }
}
