import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import type { BotDecisionContext } from "../src/bot/types";
import { GAME_EVENTS } from "../src/events/eventManager";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "@masoi/shared";

/**
 * Tiếng Vọng Người Chết.
 *
 * Sự kiện này trước đây chỉ có một cái banner: không có đường gửi tin nhắn nào,
 * và `deadCanSpeakUsed` không bao giờ thành `true`.
 *
 * Ràng buộc nặng nhất ở đây là ẨN DANH. Danh tính linh hồn được chọn phải nằm
 * trong state và KHÔNG BAO GIỜ đi ra snapshot công khai - lộ nó là hỏng toàn bộ
 * sự kiện, và lộ một lần là không rút lại được.
 */

const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 2,
  mode: "chaos",
};

const FIXED_ROLES = ["WEREWOLF", "WEREWOLF", "SEER", "GUARD", "WITCH", "VILLAGER"] as const;
const NAMES = ["An", "Bình", "Cường", "Dũng", "Hạnh", "Khoa"] as const;

/** `deadIds` chết trước khi ngày bắt đầu, đúng như một đêm vừa qua. */
function dayEngine(deadIds: string[] = ["p5", "p6"]): GameEngine {
  const engine = GameEngine.create(
    // Tên riêng biệt, không phải "Người 1": `chat-analysis` khớp theo TÊN, nên
    // tên đánh số dễ khớp nhầm lẫn nhau và test sẽ đo một thứ khác.
    NAMES.map((name, i) => ({ id: `p${i + 1}`, name, isBot: true })),
    CONFIG,
  );
  engine.state.players.forEach((player, i) => {
    player.role = FIXED_ROLES[i];
    player.alive = !deadIds.includes(player.id);
  });
  return engine;
}

const ECHO = { ...GAME_EVENTS.DEAD_CAN_SPEAK, round: 1 };

/** Mở ngày với ĐÚNG sự kiện này, thay vì quay xổ số cho tới khi trúng. */
function openEcho(engine: GameEngine, rng: () => number = () => 0): GameEngine {
  engine.startDay(60_000, 0, rng, ECHO);
  return engine;
}

describe("Tiếng Vọng Người Chết · chọn linh hồn", () => {
  it("chọn một người ĐÃ CHẾT", () => {
    const e = openEcho(dayEngine());

    expect(["p5", "p6"]).toContain(e.state.deadCanSpeakChosenId);
  });

  it("không có ai chết thì không chọn ai", () => {
    // `selectEvent` đã chặn trường hợp này, nhưng startDay nhận customEvent nên
    // hàng rào thứ hai phải nằm ở đây chứ không dựa vào người gọi.
    const e = openEcho(dayEngine([]));

    expect(e.state.deadCanSpeakChosenId).toBeNull();
  });

  it("cùng rng thì chọn cùng một người", () => {
    expect(openEcho(dayEngine(), () => 0.7).state.deadCanSpeakChosenId).toBe(
      openEcho(dayEngine(), () => 0.7).state.deadCanSpeakChosenId,
    );
  });
});

describe("Tiếng Vọng Người Chết · ẩn danh", () => {
  it("chỉ người được chọn thấy mình có lượt nói", () => {
    const e = openEcho(dayEngine());
    const chosen = e.state.deadCanSpeakChosenId!;

    expect(e.snapshotFor(chosen).deadCanSpeak?.canAct).toBe(true);
    for (const player of e.state.players) {
      if (player.id === chosen) continue;
      expect(e.snapshotFor(player.id).deadCanSpeak?.canAct).toBe(false);
    }
  });

  it("snapshot của người khác không chứa danh tính linh hồn ở bất kỳ độ sâu nào", () => {
    // Đây là assert quan trọng nhất của cả tính năng. Không kiểm một trường cụ
    // thể mà quét cả cây: một trường mới thêm sau này mà lỡ mang chosenId theo
    // sẽ bị test này bắt, chứ không phải người chơi bắt.
    const e = openEcho(dayEngine());
    const chosen = e.state.deadCanSpeakChosenId!;
    const other = e.state.players.find((p) => p.id !== chosen)!.id;

    const serialized = JSON.stringify(e.snapshotFor(other).deadCanSpeak ?? {});
    expect(serialized).not.toContain(chosen);
  });

  it("hết lượt thì không ai còn ô nhập nữa", () => {
    const e = openEcho(dayEngine());
    const chosen = e.state.deadCanSpeakChosenId!;
    e.submitDeadMessage(chosen, "tôi thấy có gì đó không ổn");

    expect(e.snapshotFor(chosen).deadCanSpeak?.canAct).toBe(false);
  });

  it("ngoài sự kiện thì không có view này", () => {
    const e = dayEngine();
    e.setPhase("DAY_DISCUSSION", 60_000, 0);

    expect(e.snapshotFor("p1").deadCanSpeak ?? null).toBeNull();
  });
});

describe("Tiếng Vọng Người Chết · gửi tin", () => {
  it("người được chọn gửi được, và lượt đó tiêu luôn", () => {
    const e = openEcho(dayEngine());
    const chosen = e.state.deadCanSpeakChosenId!;

    expect(e.submitDeadMessage(chosen, "  đừng tin p1  ")).toBe("đừng tin p1");
    expect(e.state.deadCanSpeakUsed).toBe(true);
  });

  it("người chết KHÁC không nói thay được", () => {
    const e = openEcho(dayEngine());
    const chosen = e.state.deadCanSpeakChosenId!;
    const otherGhost = ["p5", "p6"].find((id) => id !== chosen)!;

    expect(() => e.submitDeadMessage(otherGhost, "cho tôi nói")).toThrow();
  });

  it("người còn sống không mượn được lượt của ma", () => {
    const e = openEcho(dayEngine());

    expect(() => e.submitDeadMessage("p1", "tôi là ma đây")).toThrow();
  });

  it("chỉ một lần mỗi ván", () => {
    const e = openEcho(dayEngine());
    const chosen = e.state.deadCanSpeakChosenId!;
    e.submitDeadMessage(chosen, "lần một");

    expect(() => e.submitDeadMessage(chosen, "lần hai")).toThrow();
  });

  it("quá 120 ký tự thì từ chối chứ không cắt", () => {
    // Cắt âm thầm sẽ đổi nghĩa câu nói của người chơi mà họ không hay biết.
    const e = openEcho(dayEngine());
    const chosen = e.state.deadCanSpeakChosenId!;

    expect(() => e.submitDeadMessage(chosen, "a".repeat(121))).toThrow();
    expect(e.state.deadCanSpeakUsed).toBe(false);
  });

  it("câu rỗng không phải một lời nhắn", () => {
    const e = openEcho(dayEngine());
    const chosen = e.state.deadCanSpeakChosenId!;

    expect(() => e.submitDeadMessage(chosen, "   ")).toThrow();
    expect(e.state.deadCanSpeakUsed).toBe(false);
  });

  it("ngoài sự kiện thì không ai gửi được", () => {
    const e = dayEngine();
    e.setPhase("DAY_DISCUSSION", 60_000, 0);

    expect(() => e.submitDeadMessage("p5", "xin chào")).toThrow();
  });
});

/**
 * Khi linh hồn được chọn là một BOT.
 *
 * Lõi chốt NÓI VỀ AI; nhà cung cấp chỉ diễn đạt. Và theo đúng luật của sự kiện,
 * lõi chỉ được lấy từ nghi ngờ - không vai, không kết quả soi. Một con ma khai
 * ra kết quả soi sẽ biến "chết là hết thông tin" thành vô nghĩa.
 */
function runtimeFor(engine: GameEngine, playerId: string): BotRuntime {
  return new BotRuntime({
    playerId,
    rng: createSeededRng(playerId),
    playerIds: engine.state.players.map((p) => p.id),
  });
}

function contextWithChat(
  engine: GameEngine,
  playerId: string,
  chat: Array<{ actorId: string; text: string }>,
): BotDecisionContext {
  return {
    knowledge: engine.botKnowledgeFor(playerId),
    visibleChat: chat.map((message, i) => ({ ...message, id: `m${i}`, at: i })),
  };
}

const nameOf = (engine: GameEngine, playerId: string) =>
  engine.state.players.find((p) => p.id === playerId)!.name;

describe("BOT · lời thì thầm của linh hồn", () => {
  it("nói về người mình nghi nhất trong số người CÒN SỐNG", () => {
    const e = openEcho(dayEngine());
    const ghost = e.state.deadCanSpeakChosenId!;
    const runtime = runtimeFor(e, ghost);

    const context = contextWithChat(e, ghost, [
      { actorId: "p3", text: "tôi nghi An, An là sói" },
      { actorId: "p4", text: "đúng rồi, An rất khả nghi" },
    ]);
    runtime.observe(context);

    expect(runtime.decideGhostWhisper(context).targetId).toBe("p1");
  });

  it("không chỉ vào người đã chết, vì chỉ ra thì cũng chẳng treo được ai", () => {
    const e = openEcho(dayEngine());
    const ghost = e.state.deadCanSpeakChosenId!;
    const otherGhost = ["p5", "p6"].find((id) => id !== ghost)!;
    const runtime = runtimeFor(e, ghost);

    const context = contextWithChat(e, ghost, [
      {
        actorId: "p3",
        text: `tôi nghi ${nameOf(e, otherGhost)}, ${nameOf(e, otherGhost)} là sói`,
      },
    ]);
    runtime.observe(context);

    expect(runtime.decideGhostWhisper(context).targetId).not.toBe(otherGhost);
  });

  it("không tự chỉ vào mình", () => {
    const e = openEcho(dayEngine());
    const ghost = e.state.deadCanSpeakChosenId!;
    const runtime = runtimeFor(e, ghost);

    const context = contextWithChat(e, ghost, [
      { actorId: "p3", text: `${nameOf(e, ghost)} là sói, tôi nghi ${nameOf(e, ghost)}` },
    ]);
    runtime.observe(context);

    expect(runtime.decideGhostWhisper(context).targetId).not.toBe(ghost);
  });

  it("chưa nghi ai thì im lặng chứ không chỉ bừa", () => {
    // Một lời buộc tội không có cơ sở nào vẫn đủ sức đẩy làng treo nhầm, và
    // linh hồn thì không phải chịu hậu quả. Im lặng là lựa chọn đúng.
    const e = openEcho(dayEngine());
    const ghost = e.state.deadCanSpeakChosenId!;
    const runtime = runtimeFor(e, ghost);
    const context = contextWithChat(e, ghost, []);
    runtime.observe(context);

    expect(runtime.decideGhostWhisper(context).targetId).toBeNull();
  });
});
