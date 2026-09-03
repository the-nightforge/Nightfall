import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROOM_CONFIG, type PersonalWin, type RoomSnapshot } from "@masoi/shared";
import { personalOutcome, personalWinLabel } from "./game-over-summary";
import { cuesFor } from "./audio-cues";

const JESTER_WIN: PersonalWin = {
  playerId: "jester",
  name: "Hề",
  role: "JESTER",
  condition: "JESTER_LYNCHED",
  round: 2,
};

function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "JEST1",
    hostId: "villager",
    phase: "GAME_OVER",
    config: { ...DEFAULT_ROOM_CONFIG, jester: true },
    round: 3,
    phaseEndsAt: null,
    serverNow: 0,
    you: {
      id: "jester",
      name: "Hề",
      ready: false,
      connected: true,
      role: "JESTER",
      alive: false,
    },
    players: [
      { id: "jester", name: "Hề", alive: false, isBot: false, role: "JESTER" },
      { id: "villager", name: "Dân", alive: true, isBot: false, role: "VILLAGER" },
      { id: "wolf", name: "Sói", alive: false, isBot: false, role: "WEREWOLF" },
    ],
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
    personalWins: [JESTER_WIN],
    chatLog: [],
    log: [],
    ...overrides,
  };
}

describe("personalOutcome với thắng lợi cá nhân", () => {
  it("Thằng Hề bị treo là THẮNG, dù phe thắng chung là phe khác", () => {
    // Đây là toàn bộ điểm của tính năng ở phía giao diện: chỉ đọc `team ===
    // winner` sẽ ghi "Bạn thua" cho đúng người vừa đạt mục tiêu của mình.
    const outcome = personalOutcome(snapshot())!;

    assert.equal(outcome.won, true);
    assert.equal(outcome.verdict, "Bạn thắng");
    assert.equal(outcome.team, "neutral");
    assert.equal(outcome.teamName, "Trung lập");
    assert.deepEqual(outcome.personalWin, JESTER_WIN);
  });

  it("Hề sống tới cuối ván là THUA, và không có dòng thắng cá nhân nào", () => {
    const outcome = personalOutcome(
      snapshot({
        personalWins: [],
        you: {
          id: "jester",
          name: "Hề",
          ready: false,
          connected: true,
          role: "JESTER",
          alive: true,
        },
      }),
    )!;

    assert.equal(outcome.won, false);
    assert.equal(outcome.verdict, "Bạn thua");
    assert.equal(outcome.personalWin, null);
  });

  it("thành tích của NGƯỜI KHÁC không làm người xem thắng theo", () => {
    const outcome = personalOutcome(
      snapshot({
        you: {
          id: "wolf",
          name: "Sói",
          ready: false,
          connected: true,
          role: "WEREWOLF",
          alive: false,
        },
      }),
    )!;

    assert.equal(outcome.won, false);
    assert.equal(outcome.personalWin, null);
  });

  it("phe thắng chung vẫn nói theo phe, không bị thành tích cá nhân ghi đè", () => {
    // Hai câu cùng đúng trong một ván, và màn kết thúc phải giữ được cả hai.
    const snap = snapshot();
    assert.equal(snap.winner, "village");
    assert.equal(personalWinLabel(JESTER_WIN), "Thắng cá nhân: Thằng Hề - bị treo cổ");
  });

  it("server cũ không gửi personalWins thì không vỡ, chỉ là không có thành tích", () => {
    const snap = snapshot();
    delete (snap as { personalWins?: unknown }).personalWins;

    const outcome = personalOutcome(snap)!;
    assert.equal(outcome.won, false);
    assert.equal(outcome.personalWin, null);
  });
});

describe("tiếng kết ván", () => {
  it("phát tiếng THẮNG cho Thằng Hề đã đạt mục tiêu, dù phe khác về nhất", () => {
    // Tiếng là thứ người chơi nhận trước cả khi kịp đọc dòng chữ nào, nên nó
    // phải theo đúng luật mà `personalOutcome` dùng.
    const before = snapshot({ phase: "ELIMINATION", winner: null, personalWins: [] });
    const cues = cuesFor(before, snapshot());

    assert.ok(cues.includes("win"));
    assert.ok(!cues.includes("lose"));
  });

  it("Hề không đạt mục tiêu thì vẫn là tiếng THUA", () => {
    const before = snapshot({ phase: "ELIMINATION", winner: null, personalWins: [] });
    const cues = cuesFor(before, snapshot({ personalWins: [] }));

    assert.ok(cues.includes("lose"));
    assert.ok(!cues.includes("win"));
  });
});
