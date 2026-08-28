import { BotRuntime, createSeededRng, type BotRng } from "@masoi/game-engine";
import type { Room } from "../rooms/store";

/**
 * Vòng đời nhận thức của BOT trong một ván.
 *
 * State riêng của BOT KHÔNG nằm trong `GameState`: engine chỉ giữ sự thật công
 * khai của ván, còn ở đây là nhận thức có thể sai của từng con BOT. Nhờ vậy một
 * bug trong lõi AI không thể ghi ngược vào luật chơi, và belief riêng không thể
 * vô tình lọt vào snapshot.
 *
 * Session sống đúng một ván. Server hiện trả phòng đang chơi về lobby sau khi
 * restart, nên Phase 1 không persist brain vào Redis.
 */
export class BotSession {
  private readonly runtimes = new Map<string, BotRuntime>();
  private readonly channels = new Map<string, BotRng>();

  constructor(
    readonly seed: string,
    private readonly playerIds: readonly string[],
  ) {}

  /** Runtime ổn định theo BOT: gọi lại nhiều lần trả về đúng một đối tượng. */
  runtimeFor(botId: string): BotRuntime {
    const existing = this.runtimes.get(botId);
    if (existing) return existing;

    const runtime = new BotRuntime({
      playerId: botId,
      rng: createSeededRng(`${this.seed}:${botId}:brain`),
      playerIds: this.playerIds,
    });
    this.runtimes.set(botId, runtime);
    return runtime;
  }

  /**
   * Dòng RNG riêng cho từng mục đích. Tách kênh để lịch bỏ phiếu không "ăn" mất
   * các số mà lõi belief sẽ dùng: hai thứ đó phải tái lập độc lập với nhau.
   */
  rngFor(botId: string, channel: string): BotRng {
    const key = `${botId}:${channel}`;
    const existing = this.channels.get(key);
    if (existing) return existing;

    const rng = createSeededRng(`${this.seed}:${key}`);
    this.channels.set(key, rng);
    return rng;
  }
}

const sessions = new Map<string, BotSession>();

function createSession(room: Room): BotSession {
  const playerIds = room.engine
    ? room.engine.state.players.map((player) => player.id)
    : room.members.map((member) => member.playerId);
  return new BotSession(`${room.code}:${room.createdAt}`, playerIds);
}

/** Bắt đầu một ván mới: session cũ của phòng bị bỏ hẳn. */
export function startBotSession(room: Room): BotSession {
  const session = createSession(room);
  sessions.set(room.code, session);
  return session;
}

/**
 * Session hiện tại của phòng, tạo mới nếu chưa có.
 *
 * Lazy-create là có chủ đích: phòng nạp lại từ Redis và fixture trong test
 * không đi qua `startGame`, và một BOT không có runtime thì tuyệt đối không
 * được rơi về bỏ phiếu ngẫu nhiên.
 */
export function botSessionFor(room: Room): BotSession {
  const existing = sessions.get(room.code);
  if (existing) return existing;
  return startBotSession(room);
}

/** Dọn session khi reset về lobby, kết thúc ván hoặc xoá phòng. */
export function clearBotSession(roomCode: string): void {
  sessions.delete(roomCode);
}
