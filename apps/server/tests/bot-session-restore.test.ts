import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import {
  botSessionFor,
  clearBotSession,
  restoreBotSession,
  serializeBotSession,
} from "../src/bots/session-registry";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

function room(code = "ABCDE"): Room {
  return {
    ...ROOM_SCAFFOLD,
    code,
    hostId: "p1",
    status: "IN_GAME",
    members: [
      { playerId: "p1", name: "A", ready: true, connected: true, isBot: false },
      { playerId: "b1", name: "B", ready: true, connected: true, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: null,
    chatLog: [],
    createdAt: 1,
    gameId: null,
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };
}

describe("serialize BotSession", () => {
  it("trả null khi phòng chưa có session", () => {
    clearBotSession("ZZZZZ");
    expect(serializeBotSession("ZZZZZ")).toBeNull();
  });

  it("dựng lại brain đã học và giữ nguyên personality", () => {
    const r = room("AAAAA");
    clearBotSession(r.code);
    const runtime = botSessionFor(r).runtimeFor("b1");
    runtime.state.suspicion["p1"]!.score = 17;
    const personality = { ...runtime.state.personality };

    const dumped = serializeBotSession(r.code)!;
    clearBotSession(r.code);
    const restored = restoreBotSession(r.code, dumped);

    expect(restored.runtimeFor("b1").state.suspicion["p1"]!.score).toBe(17);
    expect(restored.runtimeFor("b1").state.personality).toEqual(personality);
  });

  it("dòng RNG của kênh tiếp tục từ đúng vị trí cũ, không quay lại đầu", () => {
    const r = room("BBBBB");
    clearBotSession(r.code);
    const session = botSessionFor(r);
    const rng = session.rngFor("b1", "vote-schedule");
    const consumed = [rng(), rng()];
    const nextExpected = session.rngFor("b1", "vote-schedule")();

    const dumped = serializeBotSession(r.code)!;
    expect(dumped.cursors["b1:vote-schedule"]).toBe(3);

    clearBotSession(r.code);
    const resumedAt3 = restoreBotSession(r.code, dumped).rngFor("b1", "vote-schedule");

    expect(resumedAt3()).not.toBe(consumed[0]);
    expect(resumedAt3()).not.toBe(nextExpected);
  });

  it("ghi cả con trỏ của kênh brain, nên brain không tua lại sau khôi phục", () => {
    const r = room("CCCCC");
    clearBotSession(r.code);
    botSessionFor(r).runtimeFor("b1");

    const dumped = serializeBotSession(r.code)!;

    expect(dumped.cursors["b1:brain"]).toBeGreaterThan(0);
  });

  it("khôi phục xong vẫn trả về đúng một runtime cho mỗi bot", () => {
    const r = room("DDDDD");
    clearBotSession(r.code);
    botSessionFor(r).runtimeFor("b1");
    const restored = restoreBotSession(r.code, serializeBotSession(r.code)!);

    expect(restored.runtimeFor("b1")).toBe(restored.runtimeFor("b1"));
    expect(botSessionFor(r)).toBe(restored);
  });
});
