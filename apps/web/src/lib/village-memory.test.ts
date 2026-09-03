import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ROOM_CONFIG,
  buildCaseFile,
  type CaseFile,
  type CaseFilePlayer,
  type CaseHighlight,
  type CaseLastLetter,
  type CaseTimelineEntry,
  type RoomSnapshot,
} from "@masoi/shared";
import {
  MAX_VILLAGE_HOUSES,
  VILLAGE_LIGHT_LABEL,
  VILLAGE_MEMORY_TITLE,
  buildVillageMemory,
  villageLegend,
  type VillageMemoryModel,
} from "./village-memory";

/*
 * Id dài và có tiền tố, đúng như id thật của server.
 *
 * KHÔNG dùng "seer"/"wolf": bộ test dưới đây khẳng định rằng không một id nào
 * lọt vào câu chữ hiển thị, và một id bốn chữ cái sẽ trùng vào giữa một từ
 * tiếng Việt bất kỳ rồi báo động giả.
 */
const ID = {
  seer: "pl_Sr7QaK",
  wolf: "pl_Wf3KzM",
  guard: "pl_Gd9MxP",
  witch: "pl_Wc2VbT",
  hunter: "pl_Hn5JtL",
  villager: "pl_Vl8RdN",
} as const;

const CAST: CaseFilePlayer[] = [
  { id: ID.seer, name: "Bảy", role: "SEER", originRole: "SEER", team: "village", alive: false, isBot: false },
  { id: ID.wolf, name: "Tám", role: "WEREWOLF", originRole: "WEREWOLF", team: "wolves", alive: true, isBot: false },
  { id: ID.guard, name: "Chín", role: "GUARD", originRole: "GUARD", team: "village", alive: true, isBot: false },
  { id: ID.witch, name: "Mười", role: "WITCH", originRole: "WITCH", team: "village", alive: false, isBot: true },
  { id: ID.hunter, name: "Hai", role: "HUNTER", originRole: "HUNTER", team: "village", alive: false, isBot: false },
  { id: ID.villager, name: "Ba", role: "VILLAGER", originRole: "VILLAGER", team: "village", alive: true, isBot: true },
];

function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "HOIUC",
    hostId: ID.seer,
    phase: "GAME_OVER",
    config: DEFAULT_ROOM_CONFIG,
    round: 3,
    phaseEndsAt: null,
    serverNow: 0,
    you: { id: ID.seer, name: "Bảy", ready: false, connected: true, role: "SEER", alive: false },
    players: CAST.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      isBot: p.isBot,
      role: p.role,
    })),
    night: null,
    hunterShot: null,
    trial: null,
    lastTrial: null,
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    discussionSkip: null,
    votesRevealed: true,
    dayVoteHistory: [],
    nightHistory: [],
    hunterShots: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: "village",
    chatLog: [],
    log: [],
    ...overrides,
  };
}

function highlight(patch: Partial<CaseHighlight>): CaseHighlight {
  return {
    type: "QUIET_MATCH",
    round: 1,
    phase: "day",
    title: "Một vụ án khép nhanh",
    description: "Không có gì đáng kể.",
    participants: [],
    importance: 1,
    evidence: { kind: "quiet-match", rounds: 1 },
    ...patch,
  };
}

function caseFile(patch: Partial<CaseFile> = {}): CaseFile {
  return {
    version: 1,
    caseId: "HS-A1B2C",
    winner: "village",
    rounds: 3,
    cast: CAST,
    highlights: [highlight({})],
    timeline: [],
    fallback: false,
    ...patch,
  };
}

function build(patch: Partial<CaseFile> = {}, snap = snapshot()): VillageMemoryModel {
  const model = buildVillageMemory(snap, caseFile(patch));
  assert.ok(model, "model phải dựng được");
  return model;
}

// ---- Cổng dựng model ----

describe("buildVillageMemory · cổng", () => {
  it("chỉ dựng khi snapshot ở GAME_OVER", () => {
    for (const phase of ["LOBBY", "NIGHT", "DAY_DISCUSSION", "VOTING"] as const) {
      assert.equal(buildVillageMemory(snapshot({ phase }), caseFile()), null, phase);
    }
    assert.ok(buildVillageMemory(snapshot(), caseFile()));
  });

  it("không có hồ sơ vụ án thì không có hồi ức", () => {
    assert.equal(buildVillageMemory(snapshot(), null), null);
  });

  it("mang đúng tên trải nghiệm và phe thắng", () => {
    const model = build({ winner: "wolves" });
    assert.equal(model.title, VILLAGE_MEMORY_TITLE);
    assert.equal(model.winner, "wolves");
    assert.match(model.winnerLabel, /Ma Sói/);
  });
});

// ---- Tất định ----

describe("buildVillageMemory · tất định", () => {
  it("cùng snapshot cho ra model giống hệt nhau", () => {
    assert.deepEqual(build(), build());
  });

  it("không chạm Math.random hay Date.now", () => {
    const random = Math.random;
    const now = Date.now;
    Math.random = () => {
      throw new Error("model không được random");
    };
    Date.now = () => {
      throw new Error("model không được đọc đồng hồ");
    };
    try {
      assert.ok(build());
    } finally {
      Math.random = random;
      Date.now = now;
    }
  });

  it("bố cục nhà không đổi khi thứ tự roster đảo", () => {
    const forward = build();
    const reversed = buildVillageMemory(
      snapshot({ players: [...snapshot().players].reverse() }),
      caseFile({ cast: [...CAST].reverse() }),
    );
    assert.ok(reversed);
    assert.deepEqual(
      reversed.houses,
      forward.houses,
      "thứ tự mảng của React không được làm xê dịch một căn nhà nào",
    );
  });
});

// ---- Làng ----

describe("buildVillageMemory · làng", () => {
  it("mỗi người chơi đúng một căn nhà", () => {
    const model = build();
    assert.equal(model.houses.length, CAST.length);
    assert.equal(new Set(model.houses.map((h) => h.playerId)).size, CAST.length);
    for (const player of CAST) {
      assert.equal(model.houses.filter((h) => h.playerId === player.id).length, 1, player.id);
    }
  });

  it("không bao giờ quá 15 căn nhà", () => {
    const many: CaseFilePlayer[] = Array.from({ length: 22 }, (_, index) => ({
      id: `pl_${String(index).padStart(4, "0")}`,
      name: `Người ${index}`,
      role: "VILLAGER",
      originRole: "VILLAGER",
      team: "village",
      alive: true,
      isBot: false,
    }));
    assert.equal(build({ cast: many }).houses.length, MAX_VILLAGE_HOUSES);
  });

  it("nhà nằm rời nhau và nằm trong nền đất", () => {
    const model = build();
    for (const house of model.houses) {
      assert.ok(Math.hypot(house.x, house.z) < model.groundRadius, house.name);
    }
    for (const a of model.houses) {
      for (const b of model.houses) {
        if (a === b) continue;
        assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 1.6, `${a.name} chạm ${b.name}`);
      }
    }
  });

  it("sắc nhà nói đúng vai, và vai đọc được bằng chữ", () => {
    const model = build();
    const by = (id: string) => model.houses.find((h) => h.playerId === id)!;
    assert.equal(by(ID.wolf).accent, "wolf");
    assert.equal(by(ID.guard).accent, "guard");
    assert.equal(by(ID.seer).accent, "seer");
    assert.equal(by(ID.witch).accent, "witch");
    assert.equal(by(ID.hunter).accent, "hunter");
    assert.equal(by(ID.villager).accent, "villager");
    // Không chỉ có màu: mỗi nhà mang nhãn vai và nhãn phe bằng chữ.
    assert.equal(by(ID.wolf).roleLabel, "Ma Sói");
    assert.equal(by(ID.guard).teamLabel, "Dân Làng");
  });
});

// ---- Bước replay ----

describe("buildVillageMemory · bước", () => {
  const highlights = [
    highlight({
      type: "BLOODBATH",
      round: 1,
      phase: "night",
      title: "Đêm đẫm máu",
      participants: [ID.seer],
      evidence: { kind: "bloodbath", victimIds: [ID.seer] },
    }),
    highlight({
      type: "WOLF_LYNCHED",
      round: 2,
      phase: "day",
      title: "Làng tóm đúng Sói",
      participants: [ID.witch],
      evidence: { kind: "lynch", accusedId: ID.witch, guilty: 4, innocent: 1, abstain: 0 },
    }),
  ];

  it("số bước khớp số điểm ngoặt của hồ sơ", () => {
    assert.equal(build({ highlights }).steps.length, highlights.length);
    assert.equal(build({ highlights: [highlights[0]] }).steps.length, 1);
  });

  it("bước xếp theo vòng rồi tới pha, đêm trước ngày", () => {
    const model = build({
      highlights: [
        highlight({ round: 2, phase: "day", type: "WOLF_LYNCHED", evidence: { kind: "lynch", accusedId: ID.wolf, guilty: 1, innocent: 0, abstain: 0 } }),
        highlight({ round: 2, phase: "night", type: "WITCH_POISON", evidence: { kind: "witch-poison", poisonedId: ID.wolf } }),
        highlight({ round: 1, phase: "night", type: "SEER_FOUND_WOLF", evidence: { kind: "seer-check", seerId: ID.seer, targetId: ID.wolf } }),
      ],
    });
    assert.deepEqual(
      model.steps.map((s) => `${s.round}${s.phase}`),
      ["1night", "2night", "2day"],
    );
    assert.deepEqual(
      model.steps.map((s) => s.index),
      [0, 1, 2],
    );
  });

  it("id bước ổn định và duy nhất", () => {
    const model = build({ highlights });
    assert.equal(new Set(model.steps.map((s) => s.id)).size, model.steps.length);
    assert.deepEqual(
      model.steps.map((s) => s.id),
      build({ highlights }).steps.map((s) => s.id),
    );
  });

  it("tiêu đề và mô tả lấy nguyên từ hồ sơ, và không mang id người chơi", () => {
    const model = build({ highlights });
    assert.equal(model.steps[0].title, "Đêm đẫm máu");
    assert.equal(model.steps[0].momentLabel, "Đêm 1");
    assert.equal(model.steps[1].momentLabel, "Ngày 2");

    const copy = [
      model.title,
      model.winnerLabel,
      model.subtitle,
      ...model.houses.flatMap((h) => [h.name, h.roleLabel, h.teamLabel]),
      ...model.steps.flatMap((s) => [s.title, s.description, s.momentLabel]),
    ].join(" | ");
    for (const id of Object.values(ID)) {
      assert.ok(!copy.includes(id), `id ${id} lọt vào chữ hiển thị`);
    }
  });

  it("camera nhắm vào nhà của người tham gia", () => {
    const model = build({ highlights });
    const seerHouse = model.houses.find((h) => h.playerId === ID.seer)!;
    assert.equal(model.steps[0].cameraTarget.x, seerHouse.x);
    assert.equal(model.steps[0].cameraTarget.z, seerHouse.z);
  });

  it("điểm ngoặt không có người tham gia thì camera về quảng trường", () => {
    const model = build({ highlights: [highlight({})] });
    assert.deepEqual(model.steps[0].cameraTarget, { x: 0, z: 0 });
  });
});

// ---- Ánh xạ hiệu ứng ----

describe("buildVillageMemory · hiệu ứng", () => {
  const one = (patch: Partial<CaseHighlight>) => build({ highlights: [highlight(patch)] }).steps[0];

  it("bầy Sói tấn công", () => {
    const step = one({
      type: "BLOODBATH",
      round: 1,
      phase: "night",
      participants: [ID.seer, ID.witch],
      evidence: { kind: "bloodbath", victimIds: [ID.seer, ID.witch] },
    });
    assert.equal(step.effect, "WOLF_ATTACK");
    // Bóng Sói chạy TỪ rìa rừng, nên không có nhà nào là điểm xuất phát.
    assert.equal(step.originId, null);
    assert.deepEqual(step.targetIds, [ID.seer, ID.witch]);
  });

  it("Bảo Vệ và Thiên Thần dùng chung tấm khiên", () => {
    for (const [type, kind] of [
      ["GUARD_SAVE", "guard-save"],
      ["ANGEL_SAVE", "angel-save"],
    ] as const) {
      const step = one({
        type,
        round: 2,
        phase: "night",
        participants: [ID.villager],
        evidence: { kind, savedId: ID.villager },
      });
      assert.equal(step.effect, "SHIELD_SAVE");
      assert.deepEqual(step.targetIds, [ID.villager]);
    }
  });

  it("Bình Cứu và Bình Độc là hai hiệu ứng khác nhau", () => {
    assert.equal(
      one({ type: "WITCH_SAVE", round: 1, phase: "night", evidence: { kind: "witch-save", savedId: ID.villager } }).effect,
      "WITCH_HEAL",
    );
    assert.equal(
      one({ type: "WITCH_POISON", round: 1, phase: "night", evidence: { kind: "witch-poison", poisonedId: ID.wolf } }).effect,
      "WITCH_POISON",
    );
  });

  it("Tiên Tri soi trúng là một tia nối hai nhà", () => {
    const step = one({
      type: "SEER_FOUND_WOLF",
      round: 1,
      phase: "night",
      evidence: { kind: "seer-check", seerId: ID.seer, targetId: ID.wolf },
    });
    assert.equal(step.effect, "SEER_BEAM");
    assert.equal(step.originId, ID.seer);
    assert.deepEqual(step.targetIds, [ID.wolf]);
  });

  it("phát bắn Thợ Săn nối nhà Thợ Săn với mục tiêu", () => {
    for (const type of ["HUNTER_MISFIRE", "HUNTER_REVENGE"] as const) {
      const step = one({
        type,
        round: 2,
        phase: "day",
        evidence: { kind: "hunter-shot", hunterId: ID.hunter, targetId: ID.villager, source: "vote" },
      });
      assert.equal(step.effect, "HUNTER_SHOT");
      assert.equal(step.originId, ID.hunter);
      assert.deepEqual(step.targetIds, [ID.villager]);
    }
  });

  it("treo cổ mang theo bảng kiểm phiếu có cấu trúc", () => {
    for (const type of ["INNOCENT_LYNCHED", "WOLF_LYNCHED"] as const) {
      const step = one({
        type,
        round: 2,
        phase: "day",
        evidence: { kind: "lynch", accusedId: ID.witch, guilty: 5, innocent: 2, abstain: 1 },
      });
      assert.equal(step.effect, "LYNCH");
      assert.deepEqual(step.targetIds, [ID.witch]);
      assert.deepEqual(step.tally, { hang: 5, spare: 2, abstain: 1 });
    }
  });

  it("tha bổng cân theo đúng số phiếu, không bịa thêm", () => {
    const step = one({
      type: "WOLF_ACQUITTED",
      round: 2,
      phase: "day",
      evidence: { kind: "acquittal", accusedId: ID.wolf, guilty: 3, innocent: 4, abstain: 0 },
    });
    assert.equal(step.effect, "TRIAL_SCALES");
    assert.deepEqual(step.tally, { hang: 3, spare: 4, abstain: 0 });
  });

  it("lá phiếu phút chót không có bảng kiểm phiếu thì không dựng cân giả", () => {
    const step = one({
      type: "LATE_VOTE_SWING",
      round: 2,
      phase: "day",
      evidence: { kind: "vote-swing", voterId: ID.guard, accusedId: ID.wolf, castAt: 9, windowEndsAt: 10 },
    });
    assert.equal(step.effect, "TRIAL_SCALES");
    assert.equal(step.tally, null);
    assert.equal(step.originId, ID.guard);
    assert.deepEqual(step.targetIds, [ID.wolf]);
  });

  it("Kẻ Nguyền Rủa đổi phe làm trăng đỏ", () => {
    const step = one({
      type: "CURSED_TURNED",
      round: 2,
      phase: "night",
      evidence: { kind: "cursed-turned", playerId: ID.villager },
    });
    assert.equal(step.effect, "CURSED_MOON");
    assert.deepEqual(step.targetIds, [ID.villager]);
  });

  it("điểm ngoặt chưa có hiệu ứng riêng vẫn thành một bước, không bị bỏ qua", () => {
    const quiet = one({
      type: "QUIET_MATCH",
      round: 3,
      phase: "day",
      title: "Một vụ án khép nhanh",
      description: "Phe Dân Làng thắng sau 3 ngày.",
    });
    assert.equal(quiet.effect, "GENERIC");
    assert.equal(quiet.title, "Một vụ án khép nhanh");
    assert.deepEqual(quiet.targetIds, []);

    const priest = one({
      type: "PRIEST_BACKFIRE",
      round: 1,
      phase: "night",
      participants: [ID.villager, ID.wolf],
      evidence: { kind: "priest", priestId: ID.villager, targetId: ID.wolf, isWolf: false },
    });
    assert.equal(priest.effect, "GENERIC");
    // Không bịa thêm hành động: chỉ soi vào những người có mặt.
    assert.deepEqual(priest.targetIds, [ID.villager, ID.wolf]);
  });
});

// ---- Trạng thái nhà theo dòng thời gian ----

describe("buildVillageMemory · sáng tối theo dòng thời gian", () => {
  const death = (
    round: number,
    phase: "night" | "day",
    playerId: string,
    cause: CaseTimelineEntry["cause"] = "wolf",
  ): CaseTimelineEntry => ({
    round,
    phase,
    kind: "death",
    playerId,
    name: CAST.find((p) => p.id === playerId)!.name,
    cause,
  });

  it("nhà còn sáng trước lúc chết và tắt từ đúng bước chết trở đi", () => {
    const model = build({
      highlights: [
        highlight({ type: "SEER_FOUND_WOLF", round: 1, phase: "night", participants: [ID.seer, ID.wolf], evidence: { kind: "seer-check", seerId: ID.seer, targetId: ID.wolf } }),
        highlight({ type: "BLOODBATH", round: 2, phase: "night", participants: [ID.seer, ID.witch], evidence: { kind: "bloodbath", victimIds: [ID.seer, ID.witch] } }),
        highlight({ type: "WOLF_LYNCHED", round: 3, phase: "day", participants: [ID.hunter], evidence: { kind: "lynch", accusedId: ID.hunter, guilty: 3, innocent: 0, abstain: 0 } }),
      ],
      timeline: [death(2, "night", ID.seer), death(2, "night", ID.witch), death(3, "day", ID.hunter, "lynch")],
    });

    const [check, bloodbath, lynch] = model.steps;
    assert.ok(check.litIds.includes(ID.seer), "trước khi chết thì nhà còn sáng");
    assert.ok(bloodbath.litIds.includes(ID.seer), "đầu bước chết đèn vẫn còn, hiệu ứng mới tắt nó");
    assert.deepEqual([...bloodbath.extinguishIds].sort(), [ID.seer, ID.witch].sort());
    assert.ok(!lynch.litIds.includes(ID.seer), "từ bước sau thì tắt hẳn");
    assert.ok(!lynch.litIds.includes(ID.witch));
    assert.deepEqual(lynch.extinguishIds, [ID.hunter]);
  });

  it("nhiều người chết cùng vòng được xử lý ổn định", () => {
    const patch = {
      highlights: [
        highlight({
          type: "BLOODBATH",
          round: 1,
          phase: "night",
          participants: [ID.seer, ID.witch, ID.hunter],
          evidence: { kind: "bloodbath", victimIds: [ID.seer, ID.witch, ID.hunter] },
        }),
      ],
      timeline: [death(1, "night", ID.witch), death(1, "night", ID.hunter), death(1, "night", ID.seer)],
    };
    assert.deepEqual(build(patch).steps[0].extinguishIds, build(patch).steps[0].extinguishIds);
    assert.equal(build(patch).steps[0].extinguishIds.length, 3);
  });

  it("hoá Sói không phải là chết", () => {
    const model = build({
      highlights: [
        highlight({ type: "CURSED_TURNED", round: 1, phase: "night", participants: [ID.villager], evidence: { kind: "cursed-turned", playerId: ID.villager } }),
        highlight({ type: "WOLF_LYNCHED", round: 2, phase: "day", participants: [ID.wolf], evidence: { kind: "lynch", accusedId: ID.wolf, guilty: 3, innocent: 0, abstain: 0 } }),
      ],
      timeline: [
        { round: 1, phase: "night", kind: "cursed-turned", playerId: ID.villager, name: "Ba" },
        death(2, "day", ID.wolf, "lynch"),
      ],
    });
    assert.deepEqual(model.steps[0].extinguishIds, []);
    assert.ok(model.steps[1].litIds.includes(ID.villager), "đổi phe không tắt đèn");
  });

  it("người sống tới cuối ván sáng ở mọi bước", () => {
    const model = build({
      highlights: [
        highlight({ type: "BLOODBATH", round: 1, phase: "night", evidence: { kind: "bloodbath", victimIds: [ID.seer] } }),
        highlight({ type: "WOLF_LYNCHED", round: 2, phase: "day", evidence: { kind: "lynch", accusedId: ID.witch, guilty: 2, innocent: 0, abstain: 0 } }),
      ],
      timeline: [death(1, "night", ID.seer), death(2, "day", ID.witch, "lynch")],
    });
    for (const step of model.steps) {
      assert.ok(step.litIds.includes(ID.guard), "Chín sống tới cuối ván");
      assert.ok(step.litIds.includes(ID.villager));
    }
  });

  it("chết ở một vòng không có bước nào thì đã tắt sẵn khi bước kế bắt đầu", () => {
    const model = build({
      highlights: [
        highlight({ type: "WOLF_LYNCHED", round: 3, phase: "day", participants: [ID.wolf], evidence: { kind: "lynch", accusedId: ID.wolf, guilty: 2, innocent: 0, abstain: 0 } }),
      ],
      timeline: [death(1, "night", ID.seer), death(3, "day", ID.wolf, "lynch")],
    });
    assert.ok(!model.steps[0].litIds.includes(ID.seer));
    assert.deepEqual(model.steps[0].extinguishIds, [ID.wolf]);
  });

  it("người sống sót cuối cùng chỉ làm nổi bật đúng một nhà", () => {
    const model = build({
      highlights: [
        highlight({
          type: "LONE_SURVIVOR",
          round: 3,
          phase: "day",
          participants: [ID.guard],
          evidence: { kind: "lone-survivor", playerId: ID.guard, team: "village" },
        }),
      ],
    });
    assert.equal(model.steps[0].effect, "LONE_LIGHT");
    assert.deepEqual(model.steps[0].targetIds, [ID.guard]);
  });
});

// ---- Phong thư sau cùng ----

describe("buildVillageMemory · phong thư", () => {
  const letter = (authorId: string, openedRound: number): CaseLastLetter => ({
    authorId,
    authorName: CAST.find((p) => p.id === authorId)!.name,
    text: "Đừng tin người ngồi cạnh tôi.",
    sealedRound: openedRound - 1,
    openedRound,
  });

  const lynchAt = (round: number, accusedId: string) =>
    highlight({
      type: "WOLF_LYNCHED",
      round,
      phase: "day",
      participants: [accusedId],
      evidence: { kind: "lynch", accusedId, guilty: 3, innocent: 0, abstain: 0 },
    });

  it("hồ sơ cũ không có mục thư vẫn chạy", () => {
    const model = build({ highlights: [lynchAt(2, ID.wolf)] });
    assert.deepEqual(model.epilogueLetters, []);
    assert.deepEqual(model.steps[0].letters, []);
  });

  it("thư ghép vào đúng bước mà tác giả tắt đèn, cùng vòng", () => {
    const model = build({
      highlights: [lynchAt(1, ID.seer), lynchAt(2, ID.witch)],
      timeline: [
        { round: 1, phase: "day", kind: "death", playerId: ID.seer, name: "Bảy", cause: "lynch" },
        { round: 2, phase: "day", kind: "death", playerId: ID.witch, name: "Mười", cause: "lynch" },
      ],
      lastLetters: [letter(ID.witch, 2), letter(ID.seer, 1)],
    });
    assert.deepEqual(
      model.steps[0].letters.map((l) => l.authorId),
      [ID.seer],
    );
    assert.deepEqual(
      model.steps[1].letters.map((l) => l.authorId),
      [ID.witch],
    );
    assert.deepEqual(model.epilogueLetters, []);
  });

  it("thư không ghép chắc chắn được thì rơi xuống phần kết", () => {
    const model = build({
      highlights: [lynchAt(2, ID.witch)],
      timeline: [
        { round: 2, phase: "day", kind: "death", playerId: ID.witch, name: "Mười", cause: "lynch" },
        { round: 1, phase: "night", kind: "death", playerId: ID.seer, name: "Bảy", cause: "wolf" },
      ],
      lastLetters: [letter(ID.seer, 1)],
    });
    assert.deepEqual(model.steps[0].letters, []);
    assert.deepEqual(
      model.epilogueLetters.map((l) => l.authorId),
      [ID.seer],
    );
  });

  it("thư của người không có nhà không dựng phong bì trên nền đất", () => {
    const model = build({
      highlights: [lynchAt(1, ID.wolf)],
      timeline: [{ round: 1, phase: "day", kind: "death", playerId: ID.wolf, name: "Tám", cause: "lynch" }],
      lastLetters: [
        { authorId: "pl_KhongCo", authorName: "Người lạ", text: "…", sealedRound: 0, openedRound: 1 },
      ],
    });
    assert.deepEqual(model.steps[0].letters, []);
    assert.equal(model.epilogueLetters.length, 1);
  });
});

// ---- Nối trọn đường từ snapshot thật ----

describe("buildVillageMemory · từ buildCaseFile thật", () => {
  it("dựng được từ một ván có đêm, phiên toà và tấm khiên", () => {
    const snap = snapshot({
      round: 2,
      nightHistory: [
        {
          round: 1,
          wolfTarget: { id: ID.guard, name: "Chín" },
          guardTarget: { id: ID.guard, name: "Chín" },
          seerChecks: [
            { seer: { id: ID.seer, name: "Bảy" }, target: { id: ID.wolf, name: "Tám" }, isWolf: true },
          ],
          witch: { usedHeal: false, healedTarget: null, poisonTarget: null },
          deaths: [],
        },
      ],
      dayVoteHistory: [
        {
          round: 2,
          mutations: [],
          finalBallots: [],
          nomination: { kind: "TRIAL", accusedId: ID.wolf },
          finalJudgment: { ballots: [], guilty: 4, innocent: 1, abstain: 0, lynched: true },
        },
      ],
    });
    const file = buildCaseFile(snap);
    assert.ok(file);
    const model = buildVillageMemory(snap, file);
    assert.ok(model);
    assert.equal(model.steps.length, file.highlights.length);
    assert.ok(model.steps.some((s) => s.effect === "LYNCH"));
    assert.ok(model.steps.some((s) => s.effect === "SHIELD_SAVE"));
  });
});

// ---- Bảng nhà dùng chung cho bản 3D và bản 2D ----

describe("villageLegend", () => {
  const lynchAt = (round: number, accusedId: string) =>
    highlight({
      type: "WOLF_LYNCHED",
      round,
      phase: "day",
      participants: [accusedId],
      evidence: { kind: "lynch", accusedId, guilty: 3, innocent: 0, abstain: 0 },
    });

  const model = build({
    highlights: [lynchAt(1, ID.seer), lynchAt(2, ID.witch)],
    timeline: [
      { round: 1, phase: "day", kind: "death", playerId: ID.seer, name: "Bảy", cause: "lynch" },
      { round: 2, phase: "day", kind: "death", playerId: ID.witch, name: "Mười", cause: "lynch" },
    ],
  });
  const entryFor = (entries: ReturnType<typeof villageLegend>, id: string) =>
    entries.find((entry) => entry.playerId === id)!;

  it("mỗi căn nhà đúng một dòng, mang tên và VAI bằng chữ", () => {
    const entries = villageLegend(model.houses, model.steps[0]);
    assert.equal(entries.length, model.houses.length);
    assert.equal(entryFor(entries, ID.wolf).name, "Tám");
    assert.equal(entryFor(entries, ID.wolf).roleLabel, "Ma Sói");
    assert.equal(entryFor(entries, ID.guard).roleLabel, "Bảo Vệ");
    assert.equal(entryFor(entries, ID.guard).teamLabel, "Dân Làng");
  });

  it("ba trạng thái ánh đèn phân biệt được mà không cần tới màu", () => {
    // Bước 1 treo cổ Bảy: nhà Bảy tắt NGAY ở bước này, Mười thì chưa.
    const first = villageLegend(model.houses, model.steps[0]);
    assert.equal(entryFor(first, ID.seer).state, "extinguishing");
    assert.equal(entryFor(first, ID.witch).state, "lit");

    // Sang bước 2, Bảy đã tắt từ trước còn Mười mới là người vừa ngã xuống.
    const second = villageLegend(model.houses, model.steps[1]);
    assert.equal(entryFor(second, ID.seer).state, "dark");
    assert.equal(entryFor(second, ID.witch).state, "extinguishing");
    assert.equal(entryFor(second, ID.guard).state, "lit");
  });

  it("mỗi trạng thái có một câu chữ riêng, không phải một sắc màu", () => {
    const entries = villageLegend(model.houses, model.steps[0]);
    assert.equal(entryFor(entries, ID.seer).statusLabel, VILLAGE_LIGHT_LABEL.extinguishing);
    assert.equal(entryFor(entries, ID.guard).statusLabel, VILLAGE_LIGHT_LABEL.lit);
    assert.equal(
      new Set(Object.values(VILLAGE_LIGHT_LABEL)).size,
      3,
      "ba trạng thái phải là ba câu khác nhau",
    );
    for (const label of Object.values(VILLAGE_LIGHT_LABEL)) {
      assert.ok(label.trim().length > 0);
    }
  });

  it("người trong cuộc của bước được đánh dấu tâm điểm", () => {
    const entries = villageLegend(model.houses, model.steps[0]);
    assert.equal(entryFor(entries, ID.seer).focused, true);
    assert.equal(entryFor(entries, ID.guard).focused, false);
    assert.equal(entries.filter((entry) => entry.focused).length, 1);
  });

  it("tâm điểm gồm cả nguồn lẫn mục tiêu, không chỉ mục tiêu", () => {
    const beam = build({
      highlights: [
        highlight({
          type: "SEER_FOUND_WOLF",
          round: 1,
          phase: "night",
          participants: [ID.seer, ID.wolf],
          evidence: { kind: "seer-check", seerId: ID.seer, targetId: ID.wolf },
        }),
      ],
    });
    const entries = villageLegend(beam.houses, beam.steps[0]);
    assert.equal(entryFor(entries, ID.seer).focused, true, "nhà Tiên Tri là nơi tia sáng đi ra");
    assert.equal(entryFor(entries, ID.wolf).focused, true);
    assert.equal(entryFor(entries, ID.villager).focused, false);
  });

  it("cảnh mở đầu nói trạng thái CUỐI ván và không có tâm điểm nào", () => {
    const entries = villageLegend(model.houses, null);
    // Ngôi làng lúc màn khép lại - chỗ đứng mà người chơi vừa rời khỏi.
    assert.equal(entryFor(entries, ID.guard).state, "lit");
    assert.equal(entryFor(entries, ID.wolf).state, "lit");
    assert.equal(entryFor(entries, ID.seer).state, "dark");
    assert.equal(entryFor(entries, ID.witch).state, "dark");
    assert.equal(entryFor(entries, ID.hunter).state, "dark");
    assert.ok(entries.every((entry) => !entry.focused));
  });

  it("bảng là hàm THUẦN: cùng đầu vào cho cùng kết quả", () => {
    assert.deepEqual(
      villageLegend(model.houses, model.steps[1]),
      villageLegend(model.houses, model.steps[1]),
    );
  });

  it("không có nhà nào thì không có bảng", () => {
    assert.deepEqual(villageLegend([], model.steps[0]), []);
  });
});
