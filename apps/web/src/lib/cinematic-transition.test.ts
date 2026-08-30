import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ROOM_CONFIG,
  PHASES,
  type GameEventId,
  type GameEventView,
  type Phase,
  type RoomSnapshot,
  type Winner,
} from "@masoi/shared";
import { CINEMATIC_CLIPS, cinematicFor, nextClips } from "./cinematic-transition";

function snap(patch: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "MOONS",
    hostId: "a",
    phase: "NIGHT",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 1,
    phaseEndsAt: null,
    serverNow: 0,
    you: null,
    players: [],
    night: null,
    hunterShot: null,
    trial: null,
    lastTrial: null,
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    discussionSkip: null,
    votesRevealed: false,
    dayVoteHistory: [],
    nightHistory: [],
    hunterShots: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
    ...patch,
  };
}

function event(id: GameEventId, round = 1): GameEventView {
  return {
    id,
    name: id,
    description: "",
    targetPhase: "NIGHT",
    round,
    beneficiary: "neutral",
    power: 3,
  };
}

describe("cinematicFor", () => {
  it("snapshot đầu tiên không phát gì: vào phòng giữa pha không phải một cạnh", () => {
    assert.equal(cinematicFor(null, snap({ phase: "NIGHT" })), null);
  });

  it("cùng pha, cùng vòng thì im - đây chính là lần resync sau khi rớt mạng", () => {
    const before = snap({ phase: "VOTING", round: 2 });
    const after = snap({ phase: "VOTING", round: 2, hasVoted: true });
    assert.equal(cinematicFor(before, after), null);
  });

  it("bước vào đêm là NIGHTFALL", () => {
    const played = cinematicFor(snap({ phase: "ROLE_REVEAL" }), snap({ phase: "NIGHT" }));
    assert.equal(played?.kind, "NIGHTFALL");
  });

  it("đêm sang công bố là DAWN", () => {
    const played = cinematicFor(snap({ phase: "NIGHT" }), snap({ phase: "NIGHT_RESULT" }));
    assert.equal(played?.kind, "DAWN");
  });

  it("đề cử xong mở phiên toà là TRIAL, cả khi bỏ qua pha biện hộ", () => {
    for (const to of ["DEFENSE", "FINAL_VOTE"] as const) {
      const played = cinematicFor(snap({ phase: "VOTING" }), snap({ phase: to }));
      assert.equal(played?.kind, "TRIAL", to);
    }
  });

  it("biện hộ sang bỏ phiếu xác nhận là đi tiếp trong cùng phiên toà, không mở màn lại", () => {
    assert.equal(cinematicFor(snap({ phase: "DEFENSE" }), snap({ phase: "FINAL_VOTE" })), null);
  });

  it("bỏ phiếu xác nhận sang công bố là VERDICT", () => {
    const played = cinematicFor(snap({ phase: "FINAL_VOTE" }), snap({ phase: "ELIMINATION" }));
    assert.equal(played?.kind, "VERDICT");
  });

  it("hết ván lấy đúng biến thể của phe thắng", () => {
    const cases: Array<[Winner, string]> = [
      ["wolves", "WOLVES_WIN"],
      ["village", "VILLAGE_WIN"],
    ];
    for (const [winner, kind] of cases) {
      const played = cinematicFor(
        snap({ phase: "CHECK_WIN" }),
        snap({ phase: "GAME_OVER", winner }),
      );
      assert.equal(played?.kind, kind, String(winner));
    }
  });

  it("hết ván mà server chưa kịp gửi phe thắng thì không bịa ra một màn kết thúc", () => {
    const played = cinematicFor(snap({ phase: "CHECK_WIN" }), snap({ phase: "GAME_OVER" }));
    assert.equal(played, null);
  });

  it("sự kiện mới rơi đúng họ của nó", () => {
    const cases: Array<[GameEventId, string]> = [
      ["BLOOD_MOON", "WOLF_THREAT"],
      ["PEACEFUL_NIGHT", "VILLAGE_BOON"],
      ["CURFEW", "RULE_CHANGE"],
      ["DEAD_CAN_SPEAK", "SPIRIT"],
    ];
    for (const [id, kind] of cases) {
      const played = cinematicFor(
        snap({ phase: "NIGHT", activeEvent: null }),
        snap({ phase: "NIGHT", activeEvent: event(id) }),
      );
      assert.equal(played?.kind, kind, id);
    }
  });

  it("vẫn sự kiện đó gửi lại thì không phát lần hai", () => {
    const before = snap({ phase: "NIGHT", activeEvent: event("BLOOD_MOON") });
    const after = snap({ phase: "NIGHT", activeEvent: event("BLOOD_MOON"), round: 1 });
    assert.equal(cinematicFor(before, after), null);
  });

  it("cùng sự kiện nhưng vòng sau là một lần kích hoạt khác", () => {
    const before = snap({ phase: "NIGHT", round: 1, activeEvent: event("BLOOD_MOON", 1) });
    const after = snap({ phase: "NIGHT", round: 3, activeEvent: event("BLOOD_MOON", 3) });
    assert.equal(cinematicFor(before, after)?.kind, "WOLF_THREAT");
  });

  it("sự kiện nổ đúng lúc sang pha thì sự kiện được ưu tiên, vì cạnh pha còn quay lại", () => {
    const played = cinematicFor(
      snap({ phase: "DAY_DISCUSSION", activeEvent: null }),
      snap({ phase: "NIGHT", round: 2, activeEvent: event("MOONLESS_NIGHT", 2) }),
    );
    assert.equal(played?.kind, "WOLF_THREAT");
  });

  it("hết ván thắng mọi thứ khác, kể cả một sự kiện còn treo", () => {
    const played = cinematicFor(
      snap({ phase: "FINAL_VOTE", activeEvent: null }),
      snap({ phase: "GAME_OVER", winner: "village", activeEvent: event("LAST_STAND", 4) }),
    );
    assert.equal(played?.kind, "VILLAGE_WIN");
  });

  it("cùng một cạnh cho ra cùng một khoá, để overlay khỏi phát hai lần", () => {
    const a = cinematicFor(snap({ phase: "NIGHT" }), snap({ phase: "NIGHT_RESULT" }));
    const b = cinematicFor(snap({ phase: "NIGHT" }), snap({ phase: "NIGHT_RESULT" }));
    assert.equal(a?.key, b?.key);
  });

  it("hai vòng khác nhau thì khoá khác nhau", () => {
    const a = cinematicFor(snap({ phase: "NIGHT", round: 1 }), snap({ phase: "NIGHT_RESULT", round: 1 }));
    const b = cinematicFor(snap({ phase: "NIGHT", round: 2 }), snap({ phase: "NIGHT_RESULT", round: 2 }));
    assert.notEqual(a?.key, b?.key);
  });
});

describe("nextClips", () => {
  it("không sót pha nào, và chỉ trả về clip có thật", () => {
    for (const phase of PHASES as readonly Phase[]) {
      for (const clip of nextClips(phase)) {
        assert.ok(CINEMATIC_CLIPS.includes(clip), `${phase} -> ${clip}`);
      }
    }
  });

  it("nạp trước rất ít, không phải cả bộ", () => {
    for (const phase of PHASES as readonly Phase[]) {
      assert.ok(nextClips(phase).length <= 3, phase);
    }
  });

  it("hết ván thì không còn gì để nạp", () => {
    assert.deepEqual(nextClips("GAME_OVER"), []);
  });
});
