import { voiceCanPublish, voiceRoomName } from "@masoi/shared";
import type { Phase, VoiceView } from "@masoi/shared";
import {
  VoiceNotFoundError,
  browserUrl,
  mintJoinToken,
  participantPermission,
  type VoiceConfig,
  type VoiceParticipantPermission,
} from "./livekit";
import type { Room } from "../rooms/store";

/**
 * Phần biết luật chơi của voice chat.
 *
 * Không import SDK của nhà cung cấp - mọi lời gọi đi qua `VoiceAdmin`, nên test
 * chạy được bằng bản giả, không cần key và không chạm mạng.
 */

export interface VoiceAdmin {
  createRoom(roomName: string): Promise<void>;
  updateParticipant(
    roomName: string,
    identity: string,
    permission: VoiceParticipantPermission,
  ): Promise<void>;
  removeParticipant(roomName: string, identity: string): Promise<void>;
  deleteRoom(roomName: string): Promise<void>;
}

let admin: VoiceAdmin | null = null;
let voiceConfig: VoiceConfig | null = null;

/**
 * Gắn adapter và cấu hình của nó. Cùng nếp với `setIo` trong rooms/broadcast.ts.
 *
 * Hai thứ đi cùng nhau có chủ ý: "voice có bật không" chỉ có MỘT câu trả lời là
 * "đã gắn adapter hay chưa". Đọc lại `config.voice` ở khắp nơi sẽ tạo nguồn sự
 * thật thứ hai, và test thì không tiêm được.
 */
export function setVoiceAdmin(next: VoiceAdmin | null, cfg: VoiceConfig | null = null): void {
  admin = next;
  voiceConfig = next ? cfg : null;
}

/**
 * Trạng thái phụ trợ của voice, KHÔNG phải state của ván đấu.
 *
 * Nó chỉ tồn tại để khỏi gọi thừa và gọi sai. Mất nó là vô hại: hậu quả tối đa
 * là áp lại quyền cho mọi người một lần, kết quả vẫn đúng. Vì thế nó nằm ở đây
 * chứ không nằm trong `Room`, và không bao giờ được persist.
 */
interface RoomVoiceState {
  /** Người đã thực sự vào room LiveKit. Người ngoài tập này không được đụng tới. */
  joined: Set<string>;
  /** Quyền đã áp thành công lần gần nhất. Chỉ ghi SAU KHI lời gọi thành công. */
  applied: Map<string, boolean>;
  /** Tăng mỗi lượt đồng bộ; lượt cũ bị thay thế thì bỏ hẳn. */
  generation: number;
  /** Hàng đợi tuần tự: hai lượt của cùng một phòng không bao giờ chạy chồng nhau. */
  tail: Promise<void>;
}

const states = new Map<string, RoomVoiceState>();

function stateFor(code: string): RoomVoiceState {
  let state = states.get(code);
  if (!state) {
    state = { joined: new Set(), applied: new Map(), generation: 0, tail: Promise.resolve() };
    states.set(code, state);
  }
  return state;
}

/** Chỉ dùng trong test. */
export function resetVoiceState(): void {
  states.clear();
}

export function voiceRoomNameFor(code: string): string {
  return voiceRoomName(voiceConfig?.env ?? "dev", code);
}

/**
 * Voice có hiệu lực cho phòng này không.
 *
 * Lấy tín hiệu từ chính adapter chứ không đọc lại env: adapter CHỈ được gắn ở
 * `index.ts` khi cấu hình LiveKit hợp lệ, nên `admin !== null` đã là câu trả lời
 * đầy đủ. Đọc env lần nữa ở đây sẽ tạo hai nguồn sự thật cho cùng một câu hỏi.
 */
export function voiceEnabledFor(room: Room): boolean {
  return admin !== null && room.config.voice === true;
}

export function markVoiceJoined(code: string, playerId: string): void {
  stateFor(code).joined.add(playerId);
}

// ---------------------------------------------------------------------------

function desiredPermission(room: Room, playerId: string): boolean {
  const phase: Phase = room.engine ? room.engine.state.phase : "LOBBY";
  const player = room.engine?.state.players.find((p) => p.id === playerId);
  return voiceCanPublish({
    phase,
    // Ngoài trận thì chưa có engine, ai cũng coi như còn sống.
    alive: player ? player.alive : true,
    isAccused: room.engine?.state.trial?.accusedId === playerId,
  });
}

async function applyOne(
  state: RoomVoiceState,
  roomName: string,
  identity: string,
  want: boolean,
): Promise<void> {
  const client = admin;
  if (!client) return;

  const permission = participantPermission(want);
  try {
    await client.updateParticipant(roomName, identity, permission);
    state.applied.set(identity, want);
    return;
  } catch (err) {
    if (err instanceof VoiceNotFoundError) {
      // Chưa vào voice hoặc đã rời. Không phải lỗi, và tuyệt đối không leo
      // thang: removeParticipant ở đây sẽ thu hồi token của người vô can.
      state.joined.delete(identity);
      return;
    }

    if (want) {
      // Chiều CẤP quyền: hậu quả chỉ là chưa nói được. Không ghi cache để lần
      // đồng bộ sau tự thử lại.
      return;
    }
  }

  // Chiều THU quyền, lỗi thật: thử lại một lần.
  try {
    await client.updateParticipant(roomName, identity, permission);
    state.applied.set(identity, want);
    return;
  } catch (err) {
    if (err instanceof VoiceNotFoundError) {
      state.joined.delete(identity);
      return;
    }
  }

  // Vẫn hỏng: đá khỏi room. Mất tiếng thì khó chịu, nói khi không được phép thì
  // hỏng ván.
  try {
    await client.removeParticipant(roomName, identity);
  } catch {
    /* hết cách, và đã fail-closed hết mức có thể */
  }
  state.joined.delete(identity);
  state.applied.delete(identity);
}

async function runSync(room: Room, generation: number): Promise<void> {
  const state = stateFor(room.code);
  // Lượt này đã bị lượt mới hơn thay thế - bỏ hẳn, đỡ tốn lời gọi.
  if (generation !== state.generation) return;
  if (!admin || !voiceEnabledFor(room)) return;

  const roomName = voiceRoomNameFor(room.code);

  for (const member of room.members) {
    if (member.isBot) continue;
    if (!state.joined.has(member.playerId)) continue;

    const want = desiredPermission(room, member.playerId);
    if (state.applied.get(member.playerId) === want) continue;

    await applyOne(state, roomName, member.playerId, want);
  }
}

/**
 * Đồng bộ quyền nói cho cả phòng.
 *
 * Gọi từ `machine.ts::sync()` - phễu của mọi chuyển pha. Nhưng chuyển pha KHÔNG
 * phải nguồn thay đổi duy nhất: rời phòng, bị đuổi và host tắt voice đi đường
 * khác, xem `dropVoiceParticipant` và `destroyVoiceRoom`.
 */
export function syncVoicePermissions(room: Room): Promise<void> {
  const state = stateFor(room.code);
  const generation = ++state.generation;
  state.tail = state.tail.then(() => runSync(room, generation)).catch(() => undefined);
  return state.tail;
}

/**
 * Đồng bộ cho đúng một người, ngay sau khi họ vào voice.
 *
 * BẮT BUỘC xoá cache "quyền đã áp" của người này trước khi đồng bộ. Họ vừa vào
 * một phiên LiveKit MỚI bằng một token mới, mà token thì không bao giờ mang
 * quyền nói - nên quyền thật của họ lúc này là `canPublish: false`, bất kể
 * phiên trước đã được cấp gì.
 *
 * Giữ lại cache cũ là hỏng đúng ca hay gặp nhất: người chơi tải lại trang giữa
 * phòng chờ, vào lại, và vòng đồng bộ thấy "đã cấp true rồi" nên bỏ qua đúng
 * người vừa cần được cấp lại. Họ kẹt câm vĩnh viễn trong khi giao diện vẫn mời
 * bấm giữ để nói. Quan sát được trên production ngày 2026-08-30.
 */
export function syncVoiceForPlayer(room: Room, playerId: string): Promise<void> {
  const state = stateFor(room.code);
  state.joined.add(playerId);
  state.applied.delete(playerId);
  return syncVoicePermissions(room);
}

export type VoiceTokenResult =
  | { ok: true; url: string; token: string; roomName: string }
  | { ok: false; error: string };

/**
 * Cấp token join cho một người chơi.
 *
 * Trả kết quả kiểu ok/error thay vì ném lỗi, cùng nếp với `resolveChat`, để
 * không phải import ngược `RoomError` từ `rooms/service` (chính file đó đã
 * import xuống đây).
 *
 * Token KHÔNG mang quyền nói - xem `joinTokenGrant`. Người chơi vào phòng câm,
 * rồi `voice:ready` mới kích hoạt việc cấp quyền theo pha hiện tại. Nhờ vậy dán
 * lại một token cũ cũng không lấy lại được quyền của lúc còn sống.
 */
export async function issueVoiceToken(room: Room, playerId: string): Promise<VoiceTokenResult> {
  if (!admin || !voiceConfig) return { ok: false, error: "Máy chủ chưa bật voice chat" };
  if (room.config.voice !== true) return { ok: false, error: "Phòng này chưa bật voice chat" };

  const member = room.members.find((m) => m.playerId === playerId);
  if (!member) return { ok: false, error: "Bạn không ở trong phòng này" };
  if (member.isBot) return { ok: false, error: "Bot không dùng voice chat" };

  const roomName = voiceRoomNameFor(room.code);

  // Tạo room tường minh trước khi ai đó join. Không phải tối ưu hoá: LiveKit tự
  // tạo room khi người đầu tiên vào, và đường tự tạo đó không áp `emptyTimeout`
  // mình muốn, nên room rỗng sẽ sống lâu hơn dự tính.
  try {
    await admin.createRoom(roomName);
  } catch (err) {
    console.error(`[voice] không tạo được room ${roomName}:`, err);
    return { ok: false, error: "Không kết nối được máy chủ thoại, hãy thử lại" };
  }

  try {
    const token = await mintJoinToken(voiceConfig, roomName, playerId, member.name);
    return { ok: true, url: browserUrl(voiceConfig.url), token, roomName };
  } catch (err) {
    console.error(`[voice] không ký được token cho ${playerId}:`, err);
    return { ok: false, error: "Không cấp được quyền thoại, hãy thử lại" };
  }
}

/** Trạng thái voice gắn vào snapshot của riêng một người xem. */
export function voiceViewFor(room: Room, viewerId: string): VoiceView {
  const enabled = voiceEnabledFor(room);
  return {
    available: admin !== null,
    enabled,
    canPublish: enabled && desiredPermission(room, viewerId),
    roomName: voiceRoomNameFor(room.code),
  };
}

/** Đá một người khỏi room voice: rời phòng, bị đuổi. */
export async function dropVoiceParticipant(
  code: string,
  playerId: string,
  reason = "không rõ",
): Promise<void> {
  const state = stateFor(code);
  state.joined.delete(playerId);
  state.applied.delete(playerId);
  if (!admin) return;

  console.log(`[voice] đá ${playerId} khỏi ${code} (${reason})`);
  try {
    await admin.removeParticipant(voiceRoomNameFor(code), playerId);
  } catch (err) {
    // Chưa từng vào voice là chuyện thường, không phải lỗi.
    if (!(err instanceof VoiceNotFoundError)) {
      console.error(`[voice] không đá được ${playerId} khỏi ${code}:`, err);
    }
  }
}

/**
 * Xoá hẳn room voice: phòng về lobby, phòng biến mất, host tắt voice.
 *
 * KHÔNG gọi ở GAME_OVER - lúc lật bài xong là lúc đáng nói nhất cả ván.
 */
export async function destroyVoiceRoom(code: string, reason = "không rõ"): Promise<void> {
  states.delete(code);
  if (!admin) return;

  // Ghi cả lúc THÀNH CÔNG, không chỉ lúc lỗi. Ngày 2026-08-30 một room bị xoá
  // giữa lúc chạy thử mà không truy được nguyên nhân, đúng vì đường này im lặng
  // khi mọi thứ chạy trơn tru - và "chạy trơn tru" không có nghĩa là "đúng lúc".
  console.log(`[voice] xoá room ${code} (${reason})`);
  try {
    await admin.deleteRoom(voiceRoomNameFor(code));
  } catch (err) {
    if (!(err instanceof VoiceNotFoundError)) {
      console.error(`[voice] không xoá được room ${code}:`, err);
    }
  }
}
