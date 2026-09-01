import { GameEngine } from "@masoi/game-engine";
import type { ChatMessage, RoomConfig } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { redis } from "../redis";
import { destroyVoiceRoom } from "../voice/service";
import { cleanupRoomBotState } from "../game/bot-room-state";
import { clearDiscussionSkipVotes } from "../game/discussion-skip";

export interface RoomMember {
  playerId: string;
  name: string;
  ready: boolean;
  connected: boolean;
  /**
   * Mốc rớt mạng, null khi đang online. Cần mốc chứ không chỉ cần cờ connected
   * vì ngưỡng đồng thuận skip thảo luận phải phân biệt một lần refresh với một
   * người đã bỏ đi hẳn.
   */
  disconnectedAt?: number | null;
  isBot: boolean;
  avatarUrl?: string | null;
}

export type RoomStatus = "LOBBY" | "IN_GAME";

export interface Room {
  code: string;
  hostId: string | null;
  status: RoomStatus;
  members: RoomMember[];
  config: RoomConfig;
  engine: GameEngine | null;
  chatLog: ChatMessage[];
  createdAt: number;
}

const rooms = new Map<string, Room>();
const roomTimers = new Map<string, NodeJS.Timeout[]>();

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function allRooms(): Room[] {
  return [...rooms.values()];
}

export function createRoom(code: string, host: RoomMember): Room {
  const room: Room = {
    code,
    hostId: host.playerId,
    status: "LOBBY",
    members: [host],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: null,
    chatLog: [],
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

export function removeRoom(code: string): void {
  // Phòng biến mất thì room voice cũng phải biến mất. Đây là chốt chặn duy nhất
  // của việc xoá phòng, nên mọi lối vào tương lai đều được phủ.
  void destroyVoiceRoom(code, "phòng bị xoá");
  clearRoomTimers(code);
  clearAbandonCheckTimer(code);
  rooms.delete(code);
  // Không dọn thì pendingVote/pendingEndFinalVote và ngân sách governor tích luỹ
  // một entry cho mỗi phòng bị bỏ hoang trong suốt vòng đời process.
  cleanupRoomBotState(code);
  clearDiscussionSkipVotes(code);
}

// ---- Timers ----

export function addRoomTimer(code: string, timer: NodeJS.Timeout): void {
  const list = roomTimers.get(code) ?? [];
  list.push(timer);
  roomTimers.set(code, list);
}

export function clearRoomTimers(code: string): void {
  const list = roomTimers.get(code);
  if (list) {
    for (const t of list) clearTimeout(t);
  }
  roomTimers.delete(code);
}

export function setRoomTimer(code: string, fn: () => void, ms: number): void {
  addRoomTimer(code, setTimeout(() => fn(), ms));
}

// Bucket riêng cho check phòng bỏ hoang: phải sống sót qua các lần chuyển pha
// (mỗi lần đều gọi clearRoomTimers xoá sạch roomTimers ở trên), nên không thể
// dùng chung setRoomTimer/clearRoomTimers - chỉ dọn khi phòng thật sự bị xoá.
const abandonCheckTimers = new Map<string, NodeJS.Timeout>();

export function setAbandonCheckTimer(code: string, fn: () => void, ms: number): void {
  clearAbandonCheckTimer(code);
  abandonCheckTimers.set(code, setTimeout(fn, ms));
}

export function clearAbandonCheckTimer(code: string): void {
  const t = abandonCheckTimers.get(code);
  if (t) clearTimeout(t);
  abandonCheckTimers.delete(code);
}

// ---- Redis persistence (write-through) ----

/**
 * KHÔNG còn trường `engineState`.
 *
 * Bản cũ ghi trọn trạng thái engine xuống Redis ở MỌI lần đồng bộ, rồi
 * `loadRoomFromRedis` vứt bỏ đúng thứ đó lúc nạp lại. Không phải quên: phòng
 * đang giữa trận được cố ý trả về LOBBY sau khi server restart, thay vì khôi
 * phục timer và lượt đi dang dở.
 *
 * Bất biến khiến nó thành ghi thừa hoàn toàn: `room.engine` khác null KHI VÀ
 * CHỈ KHI `room.status === "IN_GAME"` (xem `startGame` và `resetToLobby`, hai
 * chỗ duy nhất gán cặp này). Nên `engineState` khác null thì phòng chắc chắn
 * IN_GAME, mà đúng trường hợp đó lại là trường hợp bị vứt.
 *
 * Đo trên ván 15 người: bản ghi phồng từ 5,5 KB lên 48,9 KB, trong đó
 * engineState chiếm ~85% - riêng `dayVoteHistory` đã 27,8 KB. Toàn bộ phần đó
 * đi qua đường truyền tới Redis vài trăm lần mỗi ván để không ai đọc.
 *
 * Bản ghi cũ còn sót trường này thì `JSON.parse` vẫn đọc bình thường; nó chỉ
 * không được nhìn tới nữa.
 */
type SerializedRoom = Omit<Room, "engine">;

export async function persistRoom(room: Room): Promise<void> {
  try {
    const { engine: _engine, ...rest } = room;
    void _engine;
    const data: SerializedRoom = rest;
    await redis.set(`room:${room.code}`, JSON.stringify(data), "EX", 60 * 60 * 6);
  } catch {
    // Redis lỗi không chặn gameplay (in-memory là nguồn chính)
  }
}

export async function deletePersistedRoom(code: string): Promise<void> {
  try {
    await redis.del(`room:${code}`);
  } catch {
    /* ignore */
  }
}

export async function loadRoomFromRedis(code: string): Promise<Room | null> {
  try {
    const raw = await redis.get(`room:${code}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as SerializedRoom;
    // Phòng lưu trước khi có một role mới thiếu hẳn khoá của role đó. Mặc định
    // false: một ván cũ không bao giờ tự dưng bật thêm vai khi được nạp lại.
    const storedConfig = data.config as RoomConfig & {
      hunter?: boolean;
      cursed?: boolean;
      defenseSeconds?: number;
      finalVoteSeconds?: number;
    };
    const normalizedConfig: RoomConfig = {
      ...storedConfig,
      hunter: storedConfig.hunter ?? false,
      cursed: storedConfig.cursed ?? false,
      // Phòng lưu trước khi có phiên toà thiếu hẳn hai mốc này. roomConfigSchema
      // là .strict() nên thiếu trường là lần cập nhật cấu hình kế tiếp sẽ hỏng.
      defenseSeconds: storedConfig.defenseSeconds ?? DEFAULT_ROOM_CONFIG.defenseSeconds,
      finalVoteSeconds: storedConfig.finalVoteSeconds ?? DEFAULT_ROOM_CONFIG.finalVoteSeconds,
    };
    const room: Room = {
      code: data.code,
      hostId: data.hostId,
      status: data.status,
      // Sau khi process khởi động lại thì chưa ai kịp nối lại: cho tất cả một
      // khoảng ân hạn mới thay vì coi như họ đã rớt từ lâu.
      members: data.members.map((m) => ({ ...m, connected: false, disconnectedAt: Date.now() })),
      config: normalizedConfig,
      // Luôn null: ván đang chạy KHÔNG được khôi phục (xem dưới), nên dựng lại
      // engine ở đây chỉ để vứt đi ngay dòng sau - kèm cả phần chuẩn hoá không
      // rẻ trong constructor của nó.
      engine: null,
      chatLog: data.chatLog ?? [],
      createdAt: data.createdAt,
    };
    // Không khôi phục phòng đang trong trận về trạng thái timer cũ:
    // nếu server restart giữa chừng trận, trả phòng về LOBBY an toàn.
    if (room.status === "IN_GAME") {
      room.status = "LOBBY";
      for (const m of room.members) m.ready = false;
    }
    rooms.set(code, room);
    return room;
  } catch {
    return null;
  }
}
