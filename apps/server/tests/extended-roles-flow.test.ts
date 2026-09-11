import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GameEngine } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, RoomConfig } from "@masoi/shared";
import { buildSnapshot, resolveChat } from "../src/rooms/snapshot";
import {
  submitDiscussionSkip,
  endVoting,
  maybeEndFinalVoteEarly,
  continueAfterDeathResult,
} from "../src/game/machine";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

const storeMocks = vi.hoisted(() => ({
  clearRoomTimers: vi.fn(),
  setRoomTimer: vi.fn(),
}));

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: storeMocks.clearRoomTimers,
  persistRoom: async () => undefined,
  setRoomTimer: storeMocks.setRoomTimer,
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({
  prisma: {
    gameResult: {
      create: async () => undefined,
    },
  },
}));

function setupRoomWithRoles(
  players: Array<{ id: string; name: string; role: any; isBot?: boolean }>,
  configOverrides?: Partial<RoomConfig>,
): Room {
  const code = "EXTST";
  // Đảm bảo tối thiểu 6 người chơi cho GameEngine.create
  const fullPlayers = [...players];
  let extraCount = 1;
  while (fullPlayers.length < 6) {
    fullPlayers.push({
      id: `extra_${extraCount}`,
      name: `Extra ${extraCount}`,
      role: "VILLAGER",
      isBot: false,
    });
    extraCount++;
  }

  const members = fullPlayers.map((p) => ({
    playerId: p.id,
    name: p.name,
    ready: true,
    connected: true,
    disconnectedAt: null,
    isBot: p.isBot ?? false,
  }));

  const config: RoomConfig = {
    ...DEFAULT_ROOM_CONFIG,
    werewolves: 1,
    wolfCub: false,
    seer: false,
    apprenticeSeer: false,
    detective: false,
    guard: false,
    tracker: false,
    mayor: false,
    cursed: false,
    discussionSeconds: 60,
    voteSeconds: 30,
    defenseSeconds: 20,
    finalVoteSeconds: 20,
    nightSeconds: 30,
    ...configOverrides,
  };

  const engine = GameEngine.create(
    fullPlayers.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot ?? false })),
    config,
  );

  for (const p of fullPlayers) {
    const ep = engine.player(p.id);
    if (ep) ep.role = p.role;
  }

  return {
    ...ROOM_SCAFFOLD,
    code,
    hostId: members[0].playerId,
    status: "IN_GAME",
    members,
    config,
    engine,
    chatLog: [],
    createdAt: 0,
  };
}

describe("Extended Roles and Events Server Flow Integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles Detective night check and Detective snapshot", () => {
    const room = setupRoomWithRoles([
      { id: "det", name: "Detective Bot", role: "DETECTIVE", isBot: true },
      { id: "w1", name: "Wolf 1", role: "WEREWOLF" },
      { id: "w2", name: "Wolf Cub", role: "WOLF_CUB" },
      { id: "v1", name: "Villager 1", role: "VILLAGER" },
    ]);
    const engine = room.engine!;
    engine.setPhase("NIGHT", 30000);

    engine.submitNightAction("det", "DETECTIVE_CHECK", "w1", "w2");
    const snap = buildSnapshot(room, "det");

    expect(snap.night?.detectiveResult).toBeDefined();
    expect(snap.night?.detectiveResult?.sameTeam).toBe(true);
    expect(snap.night?.detectiveResult?.target1.name).toBe("Wolf 1");
    expect(snap.night?.detectiveResult?.target2.name).toBe("Wolf Cub");
  });

  it("handles Tracker night track and owner-only Tracker snapshot", () => {
    const room = setupRoomWithRoles(
      [
        { id: "tr", name: "Tracker", role: "TRACKER" },
        { id: "w1", name: "Wolf 1", role: "WEREWOLF" },
        { id: "v1", name: "Villager", role: "VILLAGER" },
      ],
      { tracker: true },
    );
    const engine = room.engine!;
    engine.setPhase("NIGHT", 30000);

    // Kết quả chỉ có sau bình minh, nên trước `resolveNight` snapshot còn rỗng.
    engine.submitNightAction("tr", "TRACK", "w1");
    expect(buildSnapshot(room, "tr").trackerResult).toBeNull();

    engine.submitNightAction("w1", "KILL", "v1");
    engine.resolveNight();

    expect(buildSnapshot(room, "tr").trackerResult).toEqual({ targetId: "w1", acted: true });
    // Biết ai đang bị dõi đã là một rò rỉ: người khác không được thấy gì.
    expect(buildSnapshot(room, "w1").trackerResult).toBeNull();
  });

  it("handles Sorcerer seer-line check and Sorcerer snapshot", () => {
    const room = setupRoomWithRoles([
      { id: "sorc", name: "Sorcerer", role: "SORCERER" },
      { id: "seer", name: "Seer", role: "SEER" },
      { id: "w1", name: "Wolf", role: "WEREWOLF" },
      { id: "v1", name: "Villager", role: "VILLAGER" },
    ]);
    const engine = room.engine!;
    engine.setPhase("NIGHT", 30000);

    // Sorcerer checks the Seer: seer-line
    engine.submitNightAction("sorc", "SORCERER_CHECK", "seer");
    expect(engine.state.night.sorcererResults["sorc"]).toEqual({
      targetId: "seer",
      isSeerLine: true,
    });

    const snap = buildSnapshot(room, "sorc");
    expect(snap.night?.sorcererResult).toMatchObject({
      target: { id: "seer", name: "Seer" },
      isSeerLine: true,
    });
    // The pack sees nothing of the check.
    expect(buildSnapshot(room, "w1").night?.sorcererResult ?? null).toBeNull();

    // Next night the same Sorcerer checks a Villager: not seer-line.
    engine.setPhase("DAY_DISCUSSION", 30000);
    engine.setPhase("NIGHT", 30000);
    engine.submitNightAction("sorc", "SORCERER_CHECK", "v1");
    expect(engine.state.night.sorcererResults["sorc"]).toEqual({
      targetId: "v1",
      isSeerLine: false,
    });
  });

  it("handles Wolf Cub rage triggering double bite next night", () => {
    const room = setupRoomWithRoles([
      { id: "w1", name: "Wolf", role: "WEREWOLF" },
      { id: "wc", name: "Cub", role: "WOLF_CUB" },
      { id: "witch", name: "Witch", role: "WITCH" },
      { id: "v1", name: "Villager 1", role: "VILLAGER" },
      { id: "v2", name: "Villager 2", role: "VILLAGER" },
      // Nạn nhân đêm đầu: dân thường có tên, để đêm hai còn đủ v1+v2 cho cắn kép.
      { id: "v3", name: "Villager 3", role: "VILLAGER" },
    ]);
    const engine = room.engine!;
    engine.setPhase("NIGHT", 30000);

    // Witch poisons the cub (after the pack locks, when the Witch's turn opens)
    engine.submitNightAction("w1", "KILL", "v3");
    engine.lockWolves();
    engine.submitNightAction("witch", "POISON", "wc");
    engine.resolveNight();

    expect(engine.state.wolfCubRageNextNight).toBe(true);

    // Next night starts
    engine.setPhase("NIGHT", 30000);
    expect(engine.state.night.wolfCubRageTonight).toBe(true);

    engine.submitNightAction("w1", "KILL", "v1", "v2");
    const deaths = engine.resolveNight();
    expect(deaths.map((d) => d.playerId)).toContain("v1");
    expect(deaths.map((d) => d.playerId)).toContain("v2");
  });

  it("applies Mayor x2 vote multiplier during day voting and trial resolution", () => {
    const room = setupRoomWithRoles([
      { id: "mayor", name: "Mayor", role: "MAYOR" },
      { id: "v1", name: "Villager 1", role: "VILLAGER" },
      { id: "v2", name: "Villager 2", role: "VILLAGER" },
      { id: "accused", name: "Accused", role: "VILLAGER" },
      { id: "w1", name: "Wolf", role: "WEREWOLF" },
    ]);
    const engine = room.engine!;
    engine.setPhase("VOTING", 30000);

    // Mayor votes accused (weight = 2)
    engine.submitVote("mayor", "accused");
    // v1 and v2 vote w1 (total weight = 2)
    engine.submitVote("v1", "w1");
    engine.submitVote("v2", "w1");

    const tally = engine.voteTally();
    expect(tally.players["accused"]).toBe(2);
    expect(tally.players["w1"]).toBe(2);
  });

  it("Amnesty Day event skips Voting phase and transitions directly to Night", () => {
    const room = setupRoomWithRoles([
      { id: "v1", name: "Villager 1", role: "VILLAGER" },
      { id: "v2", name: "Villager 2", role: "VILLAGER" },
      { id: "w1", name: "Wolf", role: "WEREWOLF" },
      { id: "extra_1", name: "Extra 1", role: "VILLAGER" },
      { id: "extra_2", name: "Extra 2", role: "VILLAGER" },
      { id: "extra_3", name: "Extra 3", role: "VILLAGER" },
    ]);
    const engine = room.engine!;

    // Start Day with AMNESTY_DAY event
    engine.startDay(60000, Date.now(), () => 0, {
      id: "AMNESTY_DAY",
      name: "Ngày Hòa Hoãn",
      description: "Bỏ qua biểu quyết ban ngày",
      targetPhase: "DAY",
      round: 1,
      beneficiary: "neutral",
      power: 2,
    });

    expect(engine.state.phase).toBe("DAY_DISCUSSION");
    expect(engine.state.activeEvent?.id).toBe("AMNESTY_DAY");

    // Skip discussion unanimously by all living human players
    for (const member of room.members) {
      submitDiscussionSkip(room, member.playerId, true);
    }

    // Should transition directly to NIGHT instead of VOTING
    expect(engine.state.phase).toBe("NIGHT");
  });

  it("Curfew event cuts discussion duration by 50%", () => {
    const room = setupRoomWithRoles([
      { id: "v1", name: "Villager 1", role: "VILLAGER" },
      { id: "w1", name: "Wolf", role: "WEREWOLF" },
    ], { discussionSeconds: 60 });
    const engine = room.engine!;

    const now = 100000;
    engine.startDay(60000, now, () => 0, {
      id: "CURFEW",
      name: "Lệnh Giới Nghiêm",
      description: "Giảm 50% thời gian",
      targetPhase: "DAY",
      round: 1,
      beneficiary: "neutral",
      power: 1,
    });

    expect(engine.state.phase).toBe("DAY_DISCUSSION");
    expect(engine.state.phaseEndsAt).toBe(now + 30000);
  });

  it("Silent Night event blocks wolf chat during night", () => {
    const room = setupRoomWithRoles([
      { id: "w1", name: "Wolf 1", role: "WEREWOLF" },
      { id: "w2", name: "Wolf Cub", role: "WOLF_CUB" },
      { id: "v1", name: "Villager", role: "VILLAGER" },
    ]);
    const engine = room.engine!;

    engine.startNight(30000, Date.now(), () => 0, {
      id: "SILENT_NIGHT",
      name: "Đêm Tĩnh Lặng",
      description: "Kênh chat bầy Sói bị tắt",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "neutral",
      power: 1,
    });

    const chatRes = resolveChat(room, "w1");
    expect(chatRes.ok).toBe(false);
    if (!chatRes.ok) {
      expect(chatRes.error).toContain("Đêm Tĩnh Lặng");
    }
  });
});
