import { describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, PHASES, voiceCanPublish, voiceRoomName, type Phase } from "@masoi/shared";
import { resolveChat } from "../src/rooms/snapshot";
import type { Room } from "../src/rooms/store";

/**
 * Bảng kỳ vọng viết tay, KHÔNG suy ra từ code.
 *
 * Nếu test này tính lại luật bằng chính công thức của `voiceCanPublish` thì nó
 * chỉ khẳng định hàm bằng chính nó. Mỗi ô dưới đây phải là một quyết định thiết
 * kế đọc được từ mục 4 của spec.
 */
const EXPECTED: Record<Phase, { alive: boolean; dead: boolean }> = {
  LOBBY: { alive: true, dead: true },
  ROLE_REVEAL: { alive: false, dead: false },
  NIGHT: { alive: false, dead: false },
  NIGHT_RESULT: { alive: true, dead: false },
  DAY_DISCUSSION: { alive: true, dead: false },
  VOTING: { alive: true, dead: false },
  // Biện hộ mở cho MỌI người còn sống, giống ban ngày. Trước đây chỉ bị cáo
  // được nói; đó là lý do bảng này từng phải tách "người sống thường" khỏi
  // "bị cáo còn sống". Giờ không pha nào phân biệt hai hạng đó nữa, nên cột
  // ấy bị gộp lại thay vì để nó khẳng định một phân biệt đã hết tồn tại.
  DEFENSE: { alive: true, dead: false },
  FINAL_VOTE: { alive: true, dead: false },
  ELIMINATION: { alive: true, dead: false },
  HUNTER_SHOT: { alive: false, dead: false },
  CHECK_WIN: { alive: false, dead: false },
  GAME_OVER: { alive: true, dead: true },
};

describe("voiceCanPublish - bảng vét cạn", () => {
  it("phủ hết mọi pha, không thiếu ô nào", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...PHASES].sort());
  });

  for (const phase of PHASES) {
    const row = EXPECTED[phase];

    it(`${phase}: người còn sống ${row.alive ? "được" : "không được"} nói`, () => {
      expect(voiceCanPublish({ phase, alive: true })).toBe(row.alive);
    });

    it(`${phase}: người chết ${row.dead ? "được" : "không được"} nói`, () => {
      expect(voiceCanPublish({ phase, alive: false })).toBe(row.dead);
    });
  }
});

// ---------------------------------------------------------------------------
// Bất biến chéo với luật chat text (spec mục 11.1)
// ---------------------------------------------------------------------------

function gameState(phase: GameState["phase"], accusedId: string | null): GameState {
  return {
    phase,
    round: 1,
    phaseEndsAt: null,
    players: [
      { id: "alive", name: "Sống", role: "VILLAGER", alive: true, isBot: false },
      { id: "accused", name: "Bị cáo", role: "VILLAGER", alive: true, isBot: false },
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "ghost", name: "Ma", role: "SEER", alive: false, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      killTarget: null,
      actedWolves: [],
      skippedWolves: [],
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
    },
    votes: {},
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    trial: accusedId ? { accusedId, finalVotes: {} } : null,
    log: [],
  } as unknown as GameState;
}

function room(phase: Phase): Room {
  const inLobby = phase === "LOBBY";
  const needsTrial = phase === "DEFENSE" || phase === "FINAL_VOTE";
  return {
    code: "ABCDE",
    hostId: "alive",
    status: inLobby ? "LOBBY" : "IN_GAME",
    members: [
      { playerId: "alive", name: "Sống", ready: true, connected: true, isBot: false },
      { playerId: "accused", name: "Bị cáo", ready: true, connected: true, isBot: false },
      { playerId: "wolf", name: "Sói", ready: true, connected: true, isBot: false },
      { playerId: "ghost", name: "Ma", ready: true, connected: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: inLobby
      ? null
      : new GameEngine(gameState(phase as GameState["phase"], needsTrial ? "accused" : null)),
    chatLog: [],
    createdAt: 0,
  } as unknown as Room;
}

/**
 * Bất biến phải phát biểu theo KHÁN GIẢ, không theo "có được nói hay không".
 *
 * `resolveChat` trả `{ ok: true, channel: "dead" }` cho người chết - tức là
 * "được nói", chỉ là nói với người chết. Một bất biến chỉ kiểm `ok === true` sẽ
 * xanh ngay cả khi voice cho người chết nói với người sống, tức là để lọt đúng
 * lỗi nghiêm trọng nhất mà nó sinh ra để chặn.
 *
 * Voice ban ngày phát tới người sống, nên `voiceCanPublish` đúng chỉ hợp lệ khi
 * kênh text tương ứng cũng tới người sống: `day` hoặc `lobby`.
 */
const AUDIENCE_REACHES_LIVING = ["day", "lobby"];

describe("bất biến: voice không bao giờ tới được khán giả rộng hơn text", () => {
  for (const phase of PHASES) {
    for (const [playerId, alive] of [
      ["alive", true],
      ["accused", true],
      ["wolf", true],
      ["ghost", false],
    ] as const) {
      it(`${phase} / ${playerId}`, () => {
        const canPublish = voiceCanPublish({ phase, alive });
        if (!canPublish) return;

        const chat = resolveChat(room(phase), playerId);
        expect(chat.ok).toBe(true);
        if (!chat.ok) return;
        expect(AUDIENCE_REACHES_LIVING).toContain(chat.channel);
      });
    }
  }
});

describe("voiceRoomName", () => {
  it("mang tên môi trường để staging không bao giờ chạm production", () => {
    expect(voiceRoomName("prod", "ABCDE")).toBe("masoi-prod-ABCDE");
    expect(voiceRoomName("dev", "ABCDE")).toBe("masoi-dev-ABCDE");
    expect(voiceRoomName("prod", "ABCDE")).not.toBe(voiceRoomName("dev", "ABCDE"));
  });
});
