import { describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, type ChatMessage } from "@masoi/shared";
import { buildSnapshot, resolveChat, visibleChatLog } from "../src/rooms/snapshot";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";

/*
 * Hàng rào quyền chat, kiểm ở phía THI HÀNH.
 *
 * Web có một bản sao của cùng bộ luật này (apps/web/src/lib/chat-channels.ts) để
 * tắt ô nhập trước khi người chơi gõ xong một câu. Bản sao đó là tiện nghi, và
 * nó nằm trong bundle của chính người muốn phá nó - nên mọi khẳng định kiểu
 * "chỉ phe Sói đọc được kênh Sói" phải được chốt ở đây, nơi tin nhắn thật sự
 * được phát đi và snapshot thật sự được dựng.
 *
 * Ba câu hỏi mà file này trả lời:
 *   1. Ai GỬI được vào kênh nào (resolveChat).
 *   2. Câu đã gửi tới tay AI (recipients).
 *   3. Người ngoài phe có nhìn thấy vai hay nội dung kênh không (buildSnapshot,
 *      visibleChatLog) - kể cả khi họ đọc thẳng payload chứ không nhìn màn hình.
 */

const messages: ChatMessage[] = [
  { id: "lobby", channel: "lobby", playerId: "wolf", playerName: "Sói", text: "lobby", at: 1 },
  { id: "day", channel: "day", playerId: "villager", playerName: "Dân", text: "day", at: 2 },
  { id: "wolves", channel: "wolves", playerId: "wolf", playerName: "Sói", text: "wolves", at: 3 },
  { id: "dead", channel: "dead", playerId: "dead", playerName: "Ma", text: "dead", at: 4 },
];

type Phase = GameState["phase"];

function room(phase: Phase, patch?: Partial<GameState>): Room {
  const state: GameState = {
    ...GAME_STATE_SCAFFOLD,
    phase,
    round: 1,
    phaseEndsAt: null,
    players: [
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "cub", name: "Sói Con", role: "WOLF_CUB", alive: true, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
      { id: "seer", name: "Tiên Tri", role: "SEER", alive: true, isBot: false },
      { id: "dead", name: "Ma", role: "GUARD", alive: false, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    night: { ...NIGHT_SCAFFOLD },
    ...patch,
  };

  return {
    ...ROOM_SCAFFOLD,
    code: "GUARD",
    hostId: "villager",
    status: "IN_GAME",
    members: state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: false,
    })),
    config: { ...state.config },
    engine: new GameEngine(state),
    chatLog: [...messages],
    createdAt: 0,
  };
}

const channelsOf = (value: ChatMessage[]): string[] => value.map((message) => message.channel);

/** Mọi pha đang chơi mà kênh làng đang mở. */
const DAY_PHASES: Phase[] = [
  "ROLE_REVEAL",
  "NIGHT_RESULT",
  "DAY_DISCUSSION",
  "VOTING",
  "FINAL_VOTE",
  "ELIMINATION",
];

describe("kênh phe Sói", () => {
  it("người ngoài phe không gửi được vào ban đêm", () => {
    const night = room("NIGHT");

    for (const outsider of ["villager", "seer"]) {
      expect(resolveChat(night, outsider)).toEqual({
        ok: false,
        error: "Ban đêm bạn không thể trò chuyện",
      });
    }
  });

  it("câu của Sói không tới tay bất kỳ người sống nào ngoài phe", () => {
    const resolved = resolveChat(room("NIGHT"), "wolf");

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.channel).toBe("wolves");
    // Cả hai con Sói còn sống đều nghe được nhau; khán giả đã chết theo dõi
    // trọn ván (luật cũ, không đổi ở vòng này).
    expect(resolved.recipients).toEqual(expect.arrayContaining(["wolf", "cub", "dead"]));
    for (const outsider of ["villager", "seer"]) {
      expect(resolved.recipients).not.toContain(outsider);
    }
  });

  it("Sói Con gửi vào cùng kênh với Sói thường", () => {
    expect(resolveChat(room("NIGHT"), "cub")).toMatchObject({ ok: true, channel: "wolves" });
  });

  it("người ngoài phe không nhận vai Sói NÀO trong payload", () => {
    // Không phải chuyện giao diện: đây là snapshot thật gửi xuống socket, và
    // một người mở DevTools đọc thẳng nó cũng chỉ thấy đúng chừng này.
    for (const phase of ["NIGHT", ...DAY_PHASES] as Phase[]) {
      const view = buildSnapshot(room(phase), "villager");
      for (const player of view.players) {
        if (player.id === "villager") continue;
        expect(player.role).toBeUndefined();
      }
      expect(view.you?.role).toBe("VILLAGER");
    }
  });

  it("người ngoài phe không nhận NỘI DUNG kênh Sói trong payload", () => {
    expect(channelsOf(buildSnapshot(room("NIGHT"), "villager").chatLog)).toEqual([]);
    for (const phase of DAY_PHASES) {
      expect(channelsOf(buildSnapshot(room(phase), "villager").chatLog)).toEqual(["day"]);
    }
  });

  it("Sói thì nhìn thấy nhau, và chỉ nhau", () => {
    const view = buildSnapshot(room("NIGHT"), "wolf");
    const roles = Object.fromEntries(view.players.map((p) => [p.id, p.role]));

    expect(roles.cub).toBe("WOLF_CUB");
    expect(roles.villager).toBeUndefined();
    expect(roles.seer).toBeUndefined();
    // Vai của chính mình nằm ở khối `you`, không nhân bản vào danh sách người chơi.
    expect(roles.wolf).toBeUndefined();
  });

  it("Đêm Tĩnh Lặng đóng kênh Sói ở cả hai chiều", () => {
    const silent = room("NIGHT", { activeEvent: { id: "SILENT_NIGHT" } as GameState["activeEvent"] });

    expect(resolveChat(silent, "wolf")).toEqual({
      ok: false,
      error: "Đêm Tĩnh Lặng: Kênh chat phe Sói bị vô hiệu hóa",
    });
    expect(channelsOf(visibleChatLog(silent, "wolf"))).toEqual([]);
  });
});

describe("kênh làng", () => {
  it("chỉ người còn sống gửi vào được", () => {
    for (const phase of DAY_PHASES) {
      const current = room(phase);
      for (const living of ["wolf", "villager", "seer"]) {
        expect(resolveChat(current, living)).toMatchObject({ ok: true, channel: "day" });
      }
      // Người chết rơi xuống kênh của họ, không bao giờ vào được kênh làng.
      expect(resolveChat(current, "dead")).toMatchObject({ ok: true, channel: "dead" });
    }
  });

  it("trong lúc biện hộ MỌI người còn sống đều gửi được vào kênh làng", () => {
    /*
     * Đổi luật: pha này từng là lượt nói độc quyền của bị cáo. Giờ nó mở như
     * ban ngày - cả làng phản ứng ngay được, đổi lại bị cáo mất lớp bảo vệ
     * "không bị cắt ngang" mà pha này vốn dựng ra cho họ.
     */
    const defense = room("DEFENSE", {
      trial: { accusedId: "villager", finalVotes: {} } as GameState["trial"],
    });

    for (const id of ["villager", "wolf", "cub", "seer"]) {
      expect(resolveChat(defense, id)).toMatchObject({ ok: true, channel: "day" });
    }
  });

  it("cổng ban đêm không phụ thuộc vào bất cứ thứ gì client gửi lên", () => {
    /*
     * Nhánh này là câu trả lời cho "gọi thẳng event thì sao".
     *
     * `resolveChat` chỉ nhận `room` và `senderId` - id thì lấy từ phiên socket
     * đã xác thực, không phải từ payload - nên một người bấm Enter, chèn biểu
     * tượng, hay tự bắn `chat:send` từ console đều đi qua đúng một hàm này và
     * nhận đúng một câu trả lời.
     *
     * Trước đây nhánh này mượn cổng biện hộ làm phương tiện. Cổng đó đã mở,
     * nên luận điểm chuyển sang cổng ban đêm - thứ vẫn còn từ chối người sống
     * không phải phe Sói. Điều được chứng minh vẫn y nguyên: gọi bao nhiêu lần
     * cũng nhận đúng một câu trả lời, và nó chỉ phụ thuộc vào phòng với id đã
     * xác thực.
     */
    const night = room("NIGHT");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(resolveChat(night, "seer")).toEqual({
        ok: false,
        error: "Ban đêm bạn không thể trò chuyện",
      });
    }
  });

  it("người sống không đọc được kênh người chết ở bất kỳ pha nào", () => {
    for (const phase of DAY_PHASES) {
      for (const living of ["wolf", "villager", "seer"]) {
        expect(channelsOf(visibleChatLog(room(phase), living))).toEqual(["day"]);
      }
    }
  });
});

describe("kênh người chết", () => {
  it("người chết gửi vào đúng kênh của mình ở MỌI pha đang chơi", () => {
    for (const phase of ["NIGHT", ...DAY_PHASES] as Phase[]) {
      const resolved = resolveChat(room(phase), "dead");
      expect(resolved).toMatchObject({ ok: true, channel: "dead" });
      if (!resolved.ok) continue;
      for (const living of ["wolf", "cub", "villager", "seer"]) {
        expect(resolved.recipients).not.toContain(living);
      }
    }
  });

  it("người chết đọc được cả ván nhưng vẫn không thấy vai của ai", () => {
    const view = buildSnapshot(room("DAY_DISCUSSION"), "dead");

    expect(channelsOf(view.chatLog)).toEqual(["day", "wolves", "dead"]);
    for (const player of view.players) {
      expect(player.role).toBeUndefined();
    }
  });
});

/*
 * Sói Pháp Sư và Sói Alpha là bầy (isWolfPack): kênh Sói đêm phải mở cho
 * chúng như Sói thường — gửi được, nhận được, và thấy nhau trong payload.
 */
describe("kênh phe Sói mở cho Sói Pháp Sư và Sói Alpha", () => {
  function packRoom(): Room {
    const state: GameState = {
      ...GAME_STATE_SCAFFOLD,
      phase: "NIGHT",
      round: 1,
      phaseEndsAt: null,
      players: [
        { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
        { id: "alpha", name: "Sói Alpha", role: "ALPHA_WOLF", alive: true, isBot: false },
        { id: "sorc", name: "Sói Pháp Sư", role: "SORCERER", alive: true, isBot: false },
        { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
        { id: "seer", name: "Tiên Tri", role: "SEER", alive: true, isBot: false },
      ],
      config: { ...DEFAULT_ROOM_CONFIG },
      night: { ...NIGHT_SCAFFOLD },
    };

    return {
      ...ROOM_SCAFFOLD,
      code: "PACK",
      hostId: "villager",
      status: "IN_GAME",
      members: state.players.map((player) => ({
        playerId: player.id,
        name: player.name,
        ready: true,
        connected: true,
        isBot: false,
      })),
      config: { ...state.config },
      engine: new GameEngine(state),
      chatLog: [...messages],
      createdAt: 0,
    };
  }

  it("hai vai sói mới gửi vào cùng kênh với bầy", () => {
    for (const id of ["wolf", "alpha", "sorc"]) {
      expect(resolveChat(packRoom(), id)).toMatchObject({ ok: true, channel: "wolves" });
    }
    expect(resolveChat(packRoom(), "villager")).toEqual({
      ok: false,
      error: "Ban đêm bạn không thể trò chuyện",
    });
  });

  it("tin sói tới tay cả bầy gồm hai vai mới", () => {
    const resolved = resolveChat(packRoom(), "wolf");

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.channel).toBe("wolves");
    for (const id of ["wolf", "alpha", "sorc"]) {
      expect(resolved.recipients).toContain(id);
    }
    for (const outsider of ["villager", "seer"]) {
      expect(resolved.recipients).not.toContain(outsider);
    }
  });

  it("Sói Pháp Sư đọc kênh Sói và thấy vai đồng bọn", () => {
    const view = buildSnapshot(packRoom(), "sorc");
    const roles = Object.fromEntries(view.players.map((p) => [p.id, p.role]));

    expect(channelsOf(view.chatLog)).toEqual(["wolves"]);
    expect(roles.wolf).toBe("WEREWOLF");
    expect(roles.alpha).toBe("ALPHA_WOLF");
    expect(roles.villager).toBeUndefined();
    expect(roles.seer).toBeUndefined();
  });

  it("Sói Alpha đọc kênh Sói và thấy vai đồng bọn", () => {
    const view = buildSnapshot(packRoom(), "alpha");
    const roles = Object.fromEntries(view.players.map((p) => [p.id, p.role]));

    expect(channelsOf(view.chatLog)).toEqual(["wolves"]);
    expect(roles.wolf).toBe("WEREWOLF");
    expect(roles.sorc).toBe("SORCERER");
    expect(roles.villager).toBeUndefined();
    expect(roles.seer).toBeUndefined();
  });
});

describe("người ngoài phòng", () => {
  it("không gửi được và không đọc được dòng nào", () => {
    const current = room("DAY_DISCUSSION");

    expect(resolveChat(current, "khach-la")).toEqual({
      ok: false,
      error: "Bạn không ở trong phòng này",
    });
    expect(visibleChatLog(current, "khach-la")).toEqual([]);
  });
});
