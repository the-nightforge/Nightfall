import { GameEngine } from "@masoi/game-engine";
import type { ChatMessage, RoomConfig } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG, MAX_PLAYERS_PER_ROOM } from "@masoi/shared";
import { redis } from "../redis";
import { cleanupRoomBotState } from "../game/bot-room-state";

export interface RoomMember {
  playerId: string;
  name: string;
  ready: boolean;
  connected: boolean;
  isBot: boolean;
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
  clearRoomTimers(code);
  rooms.delete(code);
  // Không dọn thì pendingVote/pendingEndVote và ngân sách governor tích luỹ
  // một entry cho mỗi phòng bị bỏ hoang trong suốt vòng đời process.
  cleanupRoomBotState(code);
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

// ---- Redis persistence (write-through) ----

interface SerializedRoom extends Omit<Room, "engine"> {
  engineState: ReturnType<GameEngine["getState"]> | null;
}

export async function persistRoom(room: Room): Promise<void> {
  try {
    const { engine: _engine, ...rest } = room;
    void _engine;
    const data: SerializedRoom = {
      ...rest,
      engineState: room.engine ? room.engine.getState() : null,
    };
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
    const room: Room = {
      code: data.code,
      hostId: data.hostId,
      status: data.status,
      members: data.members.map((m) => ({ ...m, connected: false })),
      config: data.config,
      engine: data.engineState ? new GameEngine(data.engineState) : null,
      chatLog: data.chatLog ?? [],
      createdAt: data.createdAt,
    };
    // Không khôi phục phòng đang trong trận về trạng thái timer cũ:
    // nếu server restart giữa chừng trận, trả phòng về LOBBY an toàn.
    if (room.status === "IN_GAME") {
      room.status = "LOBBY";
      room.engine = null;
      for (const m of room.members) m.ready = false;
    }
    rooms.set(code, room);
    return room;
  } catch {
    return null;
  }
}

export function maxPlayers(): number {
  return MAX_PLAYERS_PER_ROOM;
}
