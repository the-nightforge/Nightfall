import { voiceCanPublish, voiceRoomName } from "@masoi/shared";
import type { Phase } from "@masoi/shared";
import { config } from "../config";
import {
  VoiceNotFoundError,
  participantPermission,
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

/** Cùng nếp với `setIo` trong rooms/broadcast.ts. */
export function setVoiceAdmin(next: VoiceAdmin | null): void {
  admin = next;
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
  const env = config.voice.enabled ? config.voice.env : "dev";
  return voiceRoomName(env, code);
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

/** Đồng bộ cho đúng một người, ngay sau khi họ vào voice. */
export function syncVoiceForPlayer(room: Room, playerId: string): Promise<void> {
  markVoiceJoined(room.code, playerId);
  return syncVoicePermissions(room);
}

/** Đá một người khỏi room voice: rời phòng, bị đuổi. */
export async function dropVoiceParticipant(code: string, playerId: string): Promise<void> {
  const state = stateFor(code);
  state.joined.delete(playerId);
  state.applied.delete(playerId);
  if (!admin) return;

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
export async function destroyVoiceRoom(code: string): Promise<void> {
  states.delete(code);
  if (!admin) return;

  try {
    await admin.deleteRoom(voiceRoomNameFor(code));
  } catch (err) {
    if (!(err instanceof VoiceNotFoundError)) {
      console.error(`[voice] không xoá được room ${code}:`, err);
    }
  }
}
