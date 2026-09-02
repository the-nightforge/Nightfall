import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({ prisma: { gameResult: { create: async () => undefined } } }));

const { startGame, resetToLobby, submitHunterShot } = await import("../src/game/machine");
const { runPendingStep } = await import("../src/game/steps");
const { serializeRoom } = await import("../src/persistence/serialize");
const { restoreRoomFromEnvelope } = await import("../src/persistence/restore");
const { roomEnvelopeSchema } = await import("../src/persistence/schema");
const { clearBotSession } = await import("../src/bots/session-registry");
const { resetBotBudget } = await import("../src/bots");
const {
  lastLetterStateOf,
  openLastLettersForDeaths,
  submitLastLetter,
} = await import("../src/game/last-letter");
const { buildSnapshot } = await import("../src/rooms/snapshot");

/**
 * Phong thư qua một lần khởi động lại máy chủ.
 *
 * Hai điều phải đúng, và chúng kéo về hai hướng ngược nhau:
 *   - Bản nháp phải SỐNG SÓT (mất nó là người chơi mất một lượt cả ván) nhưng
 *     vẫn phải RIÊNG TƯ sau khi nối lại.
 *   - Thư đã mở phải KHÔNG mở lại lần thứ hai.
 *
 * Và điều thứ ba, đắt hơn cả hai: một snapshot ghi TRƯỚC tính năng này vẫn phải
 * khôi phục được. Trường mới bắt buộc là giết sạch các ván đang chạy lúc deploy.
 */

function lobbyRoom(code = "LTRRC"): Room {
  return {
    ...ROOM_SCAFFOLD,
    code,
    hostId: "p1",
    status: "LOBBY",
    members: Array.from({ length: 8 }, (_, index) => ({
      playerId: `p${index + 1}`,
      name: `Người ${index + 1}`,
      ready: true,
      connected: true,
      disconnectedAt: null,
      isBot: index >= 4,
      avatarUrl: null,
    })),
    config: { ...DEFAULT_ROOM_CONFIG, hunter: true, lastLetter: true },
    engine: null,
    chatLog: [],
    createdAt: 1_000,
  };
}

/** Phòng đang ở giữa pha thảo luận, nơi duy nhất viết được thư. */
function discussionRoom(code = "LTRRC"): Room {
  const room = lobbyRoom(code);
  clearBotSession(code);
  resetBotBudget(code);
  startGame(room);
  runPendingStep(room, room.pendingStep!); // ROLE_REVEAL -> NIGHT
  room.engine!.setPhase("DAY_DISCUSSION", 60_000);
  room.engine!.state.round = 2;
  return room;
}

function roundTrip(room: Room): Room {
  const envelope = roomEnvelopeSchema.parse(JSON.parse(JSON.stringify(serializeRoom(room, 1))));
  return restoreRoomFromEnvelope(envelope);
}

beforeEach(() => {
  clearBotSession("LTRRC");
  resetBotBudget("LTRRC");
});

describe("persistence của phong thư", () => {
  it("bản nháp sống sót qua một vòng lưu/đọc", () => {
    const room = discussionRoom();
    submitLastLetter(room, "p1", "giữ giúp tôi câu này");

    const restored = roundTrip(room);
    expect(lastLetterStateOf(restored).drafts["p1"]).toEqual({
      text: "giữ giúp tôi câu này",
      updatedRound: 2,
    });
  });

  it("bản nháp vẫn RIÊNG TƯ sau khi nối lại", () => {
    const room = discussionRoom();
    submitLastLetter(room, "p1", "bí mật của tôi");

    const restored = roundTrip(room);
    expect(buildSnapshot(restored, "p1").lastLetter!.mine.text).toBe("bí mật của tôi");
    expect(buildSnapshot(restored, "p2").lastLetter!.mine.text).toBeNull();
    expect(JSON.stringify(buildSnapshot(restored, "p2"))).not.toContain("bí mật của tôi");
  });

  it("thư đã mở không mở lại sau khi máy chủ khởi động lại", () => {
    const room = discussionRoom();
    submitLastLetter(room, "p3", "lời cuối");
    room.engine!.player("p3")!.alive = false;
    expect(openLastLettersForDeaths(room)).toHaveLength(1);

    const restored = roundTrip(room);
    expect(lastLetterStateOf(restored).opened).toHaveLength(1);
    // Chạy lại hàm mở trên phòng vừa khôi phục: không được sinh thêm gì.
    expect(openLastLettersForDeaths(restored)).toEqual([]);
    expect(lastLetterStateOf(restored).opened).toHaveLength(1);
  });

  /**
   * Ca hiểm nhất: process chết SAU khi mở thư nhưng TRƯỚC khi kịp lưu, nên bản
   * đọc lên còn mang cả bản nháp lẫn dãy id đã mở. Dãy id là thứ chặn, không
   * phải sự vắng mặt của bản nháp.
   */
  it("bản nháp sống lại từ snapshot cũ vẫn không mở được lần hai", () => {
    const room = discussionRoom();
    submitLastLetter(room, "p3", "lời cuối");
    room.engine!.player("p3")!.alive = false;
    openLastLettersForDeaths(room);

    const state = lastLetterStateOf(room);
    state.drafts["p3"] = { text: "lời cuối", updatedRound: 2 };

    const restored = roundTrip(room);
    expect(openLastLettersForDeaths(restored)).toEqual([]);
    expect(lastLetterStateOf(restored).opened).toHaveLength(1);
  });

  it("snapshot cũ KHÔNG có trường phong thư vẫn khôi phục được", () => {
    const room = discussionRoom();
    submitLastLetter(room, "p1", "sẽ bị bỏ đi cùng trường mới");

    const raw = JSON.parse(JSON.stringify(serializeRoom(room, 1)));
    delete raw.room.lastLetters;

    const parsed = roomEnvelopeSchema.safeParse(raw);
    expect(parsed.success).toBe(true);

    const restored = restoreRoomFromEnvelope(parsed.data!);
    expect(restored.code).toBe("LTRRC");
    expect(restored.engine).not.toBeNull();
    expect(lastLetterStateOf(restored)).toEqual({ drafts: {}, opened: [], openedAuthorIds: [] });
  });

  it("phòng tắt add-on vẫn lưu/đọc bình thường", () => {
    const room = discussionRoom();
    room.config.lastLetter = false;

    const restored = roundTrip(room);
    expect(restored.config.lastLetter).toBe(false);
    expect(buildSnapshot(restored, "p1").lastLetter).toBeNull();
  });
});

describe("máy trạng thái tự mở thư, không ai phải gọi tay", () => {
  /**
   * Khẳng định cái HOOK, không phải cái hàm.
   *
   * `openLastLettersForDeaths` đã có test riêng ở `last-letter.test.ts`. Bài này
   * hỏi một câu khác: một cái chết đi qua đúng đường của máy trạng thái thì thư
   * có tự mở không, hay vẫn phải có ai đó nhớ gọi thêm một dòng. Nếu ngày mai
   * lời gọi trong `sync` bị gỡ đi, đây là bài đỏ lên.
   */
  it("phát bắn của Thợ Săn qua machine tự mở thư của nạn nhân", () => {
    const room = discussionRoom();
    const engine = room.engine!;
    const hunter = engine.state.players.find((player) => player.role === "HUNTER")!;
    const victim = engine.state.players.find(
      (player) => player.id !== hunter.id && player.alive,
    )!;

    submitLastLetter(room, victim.id, "đừng để phí phát bắn đó");

    // Thợ Săn đã chết và đang có lượt phản kích.
    hunter.alive = false;
    engine.state.hunterReaction = { hunterId: hunter.id, source: "night", resolved: false };
    engine.beginHunterShot(10_000);

    submitHunterShot(room, hunter.id, victim.id);

    const opened = lastLetterStateOf(room).opened;
    expect(opened).toHaveLength(1);
    expect(opened[0].authorId).toBe(victim.id);
    expect(opened[0].text).toBe("đừng để phí phát bắn đó");
  });
});

describe("vòng đời trận", () => {
  /**
   * Add-on là lựa chọn của MỘT ván, không phải thiết lập dính vào phòng.
   *
   * Bấm "Chơi lại" mà công tắc còn bật thì ván sau chạy với một luật thêm mà
   * không ai vừa đồng ý - và không ai nhìn lại khu Add-on để phát hiện, vì lần
   * trước chính họ đã bật nó. Host bật lại là một cú bấm; tự bật hộ thì không
   * có cú bấm nào để rút lại.
   */
  it("reset về sảnh chờ TẮT luôn add-on", () => {
    const room = discussionRoom();
    expect(room.config.lastLetter).toBe(true);

    resetToLobby(room);

    expect(room.config.lastLetter).toBe(false);
  });

  it("snapshot sảnh chờ sau reset cho thấy add-on đã tắt", () => {
    const room = discussionRoom();
    resetToLobby(room);

    const view = buildSnapshot(room, "p1");
    expect(view.phase).toBe("LOBBY");
    expect(view.config.lastLetter).toBe(false);
    // Add-on tắt thì snapshot không mang phần phong thư nào cả.
    expect(view.lastLetter).toBeNull();
  });

  it("KHÔNG đụng tới cấu hình nào khác", () => {
    const room = discussionRoom();
    room.config.voice = true;
    room.config.mode = "chaos";
    room.config.nightSeconds = 45;
    room.config.werewolves = 3;
    const before = { ...room.config };

    resetToLobby(room);

    expect(room.config).toEqual({ ...before, lastLetter: false });
  });

  it("reset về sảnh chờ xoá sạch dữ liệu thư", () => {
    const room = discussionRoom();
    submitLastLetter(room, "p1", "còn sống");
    submitLastLetter(room, "p3", "sắp chết");
    room.engine!.player("p3")!.alive = false;
    openLastLettersForDeaths(room);

    resetToLobby(room);

    expect(lastLetterStateOf(room)).toEqual({ drafts: {}, opened: [], openedAuthorIds: [] });
  });

  it("ván mới bắt đầu với sổ thư trắng", () => {
    const room = discussionRoom();
    submitLastLetter(room, "p1", "của ván trước");

    startGame(room);

    expect(lastLetterStateOf(room)).toEqual({ drafts: {}, opened: [], openedAuthorIds: [] });
  });
});
