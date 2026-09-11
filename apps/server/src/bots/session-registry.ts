import { BotRuntime, createSeededRng, type BotRuntimeOptions, type SeededRng } from "@masoi/game-engine";
import type { BotBrainState } from "@masoi/game-engine";
import { isWolfPack } from "@masoi/shared";
import type { Room } from "../rooms/store";
import { botPolicy, learnedRuntimeOptions, policyAppliesToSeat } from "./learned-policy";

/**
 * Ảnh chụp nhận thức của cả bàn BOT trong một ván.
 *
 * Có mặt vì server không còn trả phòng đang chơi về sảnh chờ sau khi khởi động
 * lại: brain phải sống sót cùng ván, nếu không thì sau restart cả bàn quên sạch
 * mọi nghi ngờ và đổi hẳn cách chơi giữa chừng.
 *
 * `cursors` lưu VỊ TRÍ của từng dòng RNG chứ không lưu số đã sinh: dòng số là
 * hàm thuần của (hạt, số lần gọi), nên một số nguyên là đủ để mở lại đúng chỗ.
 *
 * `wolfPack` ghi phe của từng ghế (`isWolfPack(role)`) - `BotRuntime` không biết
 * vai trò của chính mình nên việc lọc learned policy theo phe phải làm ở tầng
 * này. Không có `learnedPolicy` là đường heuristic, nên ảnh chụp cũ thiếu trường
 * này đọc lên thành cả bàn heuristic: một ván sau restart chơi an toàn thay vì
 * bị giao nhầm model phe làng cho ghế sói.
 */
export interface PersistedBotSession {
  seed: string;
  playerIds: string[];
  brains: Record<string, { state: BotBrainState; lastDecayRound: number }>;
  /** Khoá là `botId:channel`; kênh `brain` của runtime cũng nằm ở đây. */
  cursors: Record<string, number>;
  wolfPack?: Record<string, boolean>;
}

/**
 * Vòng đời nhận thức của BOT trong một ván.
 *
 * State riêng của BOT KHÔNG nằm trong `GameState`: engine chỉ giữ sự thật công
 * khai của ván, còn ở đây là nhận thức có thể sai của từng con BOT. Nhờ vậy một
 * bug trong lõi AI không thể ghi ngược vào luật chơi, và belief riêng không thể
 * vô tình lọt vào snapshot.
 *
 * Session sống đúng một ván, và sống sót qua việc process chết: `serialize` và
 * `restore` là cặp cửa duy nhất cho việc đó.
 */
export class BotSession {
  private readonly runtimes = new Map<string, BotRuntime>();
  private readonly channels = new Map<string, SeededRng>();
  /**
   * RNG của kênh `brain`, giữ riêng vì `runtimeFor` tạo nó rồi trao hẳn cho
   * runtime. Không giữ lại thì `serialize` không đọc được con trỏ của kênh đó,
   * và sau khôi phục brain sẽ tua lại từ đầu dòng số trong khi mọi kênh khác
   * thì không.
   */
  private readonly brainRngs = new Map<string, SeededRng>();
  /** Phe của từng ghế - xem `PersistedBotSession.wolfPack`. */
  private readonly wolfPack = new Map<string, boolean>();

  constructor(
    readonly seed: string,
    private readonly playerIds: readonly string[],
    wolfPack?: Record<string, boolean>,
  ) {
    for (const [botId, isWolf] of Object.entries(wolfPack ?? {})) {
      this.wolfPack.set(botId, isWolf);
    }
  }

  /**
   * Cấu hình runtime cho MỘT ghế: policy chỉ tới ghế thuộc phe được chọn.
   *
   * Ghế không thuộc phe nhận object rỗng chứ không nhận một policy bị vô hiệu
   * hoá - cùng phía đối chứng với benchmark (xem `selfplay`). Chưa biết phe
   * (session tạo ở sảnh chờ, ảnh chụp cũ) thì không giao cho ai: rủi ro duy
   * nhất là bot đó chơi heuristic, an toàn hơn giao nhầm model phe làng cho
   * ghế sói.
   */
  private runtimeOptions(botId: string): Partial<BotRuntimeOptions> {
    return policyAppliesToSeat(botPolicy(), this.wolfPack.get(botId))
      ? learnedRuntimeOptions(botPolicy())
      : {};
  }

  /** Runtime ổn định theo BOT: gọi lại nhiều lần trả về đúng một đối tượng. */
  runtimeFor(botId: string): BotRuntime {
    const existing = this.runtimes.get(botId);
    if (existing) return existing;

    const rng = createSeededRng(`${this.seed}:${botId}:brain`);
    const runtime = new BotRuntime({
      playerId: botId,
      rng,
      playerIds: this.playerIds,
      ...this.runtimeOptions(botId),
    });
    this.brainRngs.set(botId, rng);
    this.runtimes.set(botId, runtime);
    return runtime;
  }

  /**
   * Dòng RNG riêng cho từng mục đích. Tách kênh để lịch bỏ phiếu không "ăn" mất
   * các số mà lõi belief sẽ dùng: hai thứ đó phải tái lập độc lập với nhau.
   */
  rngFor(botId: string, channel: string): SeededRng {
    const key = `${botId}:${channel}`;
    const existing = this.channels.get(key);
    if (existing) return existing;

    const rng = createSeededRng(`${this.seed}:${key}`);
    this.channels.set(key, rng);
    return rng;
  }

  /** Ảnh chụp mọi brain và vị trí mọi dòng RNG đã mở. */
  serialize(): PersistedBotSession {
    const brains: PersistedBotSession["brains"] = {};
    for (const [botId, runtime] of this.runtimes) brains[botId] = runtime.serialize();

    const cursors: Record<string, number> = {};
    for (const [key, rng] of this.channels) cursors[key] = rng.cursor;
    for (const [botId, rng] of this.brainRngs) cursors[`${botId}:brain`] = rng.cursor;

    return {
      seed: this.seed,
      playerIds: [...this.playerIds],
      brains,
      cursors,
      // Chỉ ghi khi có: ván chưa phân vai (sảnh chờ) thì ảnh chụp không cần
      // thêm rác, và lọc ở `restore` trả object rỗng khi thiếu trường này.
      ...(this.wolfPack.size > 0 ? { wolfPack: Object.fromEntries(this.wolfPack) } : {}),
    };
  }

  /**
   * Dựng lại session từ ảnh chụp.
   *
   * Runtime và kênh RNG được nạp SẴN chứ không lazy: lazy sẽ dựng lại chúng
   * bằng con trỏ 0 nếu có ai hỏi trước khi ảnh kịp áp, và một con BOT mất trí
   * nhớ giữa ván là loại lỗi khó lần ra nhất trong cả hệ thống này.
   */
  static restore(data: PersistedBotSession): BotSession {
    const session = new BotSession(data.seed, data.playerIds, data.wolfPack);

    for (const [botId, dumped] of Object.entries(data.brains)) {
      const rng = createSeededRng(
        `${data.seed}:${botId}:brain`,
        data.cursors[`${botId}:brain`] ?? 0,
      );
      session.brainRngs.set(botId, rng);
      session.runtimes.set(
        botId,
        new BotRuntime({
          playerId: botId,
          rng,
          playerIds: data.playerIds,
          state: dumped.state,
          lastDecayRound: dumped.lastDecayRound,
          ...session.runtimeOptions(botId),
        }),
      );
    }

    for (const [key, cursor] of Object.entries(data.cursors)) {
      // Kênh `brain` đã được nạp ở trên cùng runtime của nó.
      if (key.endsWith(":brain")) continue;
      session.channels.set(key, createSeededRng(`${data.seed}:${key}`, cursor));
    }

    return session;
  }
}

const sessions = new Map<string, BotSession>();

function createSession(room: Room): BotSession {
  const playerIds = room.engine
    ? room.engine.state.players.map((player) => player.id)
    : room.members.map((member) => member.playerId);
  /*
   * Phe của từng ghế, gieo cùng lúc với playerIds. Engine chỉ tồn tại từ lúc
   * bắt đầu ván - đúng lúc role đã phân xong - nên session gắn với ván luôn
   * biết phe; session sảnh chờ thì không, và `runtimeOptions` xử lý đường
   * "không biết" bằng cách không giao policy cho ai.
   */
  const wolfPack = room.engine
    ? Object.fromEntries(
        room.engine.state.players.map((player) => [player.id, isWolfPack(player.role)]),
      )
    : undefined;
  /*
   * Hạt đi theo VÁN, không theo PHÒNG.
   *
   * `room.createdAt` bất biến suốt đời phòng, nên gieo bằng nó thì ván thứ hai
   * trong cùng phòng mở lại ĐÚNG dòng số của ván trước - cùng tie-break, cùng
   * biến thiên câu chữ của bảng mẫu, cùng nhịp phát biểu. Mà "Chơi lại" là
   * luồng phổ biến nhất, nên đó là dạng lặp người chơi gặp thường xuyên nhất
   * và cũng là dạng họ CẢM thấy trước khi giải thích được.
   *
   * `gameId` sinh mới ở mỗi `startGame`, đã nằm trong envelope persist, nên nó
   * cho mỗi ván một dòng riêng mà không mất tính tái lập: cùng gameId vẫn dựng
   * lại được y hệt. Không cần tăng `PERSISTENCE_VERSION` - `BotSession.restore`
   * đọc `seed` từ chính ảnh chụp, nên phòng đang chạy giữ nguyên hạt cũ và chỉ
   * ván MỚI dùng cách gieo này.
   *
   * Rơi về `createdAt` khi chưa có gameId: phòng ở sảnh chờ và ảnh chụp ghi
   * trước khi có khoá này đều không mang nó.
   */
  return new BotSession(`${room.code}:${room.gameId ?? room.createdAt}`, playerIds, wolfPack);
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

/** Ảnh chụp session của phòng; `null` khi phòng chưa mở session nào. */
export function serializeBotSession(roomCode: string): PersistedBotSession | null {
  return sessions.get(roomCode)?.serialize() ?? null;
}

/** Nạp lại session của phòng từ ảnh chụp, thay hẳn session đang có. */
export function restoreBotSession(roomCode: string, data: PersistedBotSession): BotSession {
  const session = BotSession.restore(data);
  sessions.set(roomCode, session);
  return session;
}

/** Dọn session khi reset về lobby, kết thúc ván hoặc xoá phòng. */
export function clearBotSession(roomCode: string): void {
  sessions.delete(roomCode);
}
