import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ROOM_CONFIG,
  type CaseFile,
  type CaseHighlight,
  type PersonalWin,
  type RoomSnapshot,
} from "@masoi/shared";
import { decisiveHighlight, drawNote, personalOutcome, winnerCopy } from "./game-over-summary";

function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "OVER1",
    hostId: "seer",
    phase: "GAME_OVER",
    config: DEFAULT_ROOM_CONFIG,
    round: 3,
    phaseEndsAt: null,
    serverNow: 0,
    you: {
      id: "seer",
      name: "Tiên Tri",
      ready: false,
      connected: true,
      role: "SEER",
      alive: true,
    },
    players: [
      { id: "seer", name: "Tiên Tri", alive: true, isBot: false, role: "SEER" },
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
    chatLog: [],
    log: [],
    ...overrides,
  };
}

function highlight(patch: Partial<CaseHighlight>): CaseHighlight {
  return {
    type: "WOLF_LYNCHED",
    round: 1,
    phase: "day",
    title: "Làng bắt đúng Sói",
    description: "",
    participants: [],
    importance: 10,
    evidence: { kind: "quiet-match", rounds: 1 },
    ...patch,
  };
}

function caseFile(highlights: CaseHighlight[], fallback = false): CaseFile {
  return {
    version: 1,
    caseId: "MS-0001",
    winner: "village",
    rounds: 3,
    cast: [],
    highlights,
    timeline: [],
    fallback,
  };
}

describe("winnerCopy", () => {
  it("gọi đúng tên hai phe", () => {
    assert.equal(winnerCopy("village").headline, "Phe Dân Làng chiến thắng");
    assert.equal(winnerCopy("wolves").headline, "Phe Ma Sói chiến thắng");
    assert.equal(winnerCopy("wolves").teamName, "Ma Sói");
  });
});

describe("drawNote", () => {
  const jesterWin: PersonalWin = {
    playerId: "jester",
    name: "Thằng Hề",
    role: "JESTER",
    condition: "JESTER_LYNCHED",
    round: 2,
  };

  it("hoà mà sổ thắng cá nhân RỖNG thì nói thẳng là không ai đạt mục tiêu", () => {
    const note = drawNote([]);
    assert.match(note, /Không còn ai sống sót/);
    assert.match(note, /không ai đạt được mục tiêu/);
  });

  it("hoà mà Thằng Hề đã thắng thì KHÔNG được phủ nhận thành tích đó", () => {
    /*
     * Khối "Thắng cá nhân" hiện ngay dưới câu này. Bản cũ luôn ghi "không ai
     * đạt được mục tiêu của mình", nên hai khối cạnh nhau nói ngược nhau về
     * đúng một người - và người đó vừa thắng thật, engine đã ghi vào
     * `personalWins` từ lúc búa gõ.
     */
    const note = drawNote([jesterWin]);
    assert.doesNotMatch(note, /không ai đạt được mục tiêu/);
    // Vế "không phe nào thắng" vẫn phải còn: hoà vẫn là hoà.
    assert.match(note, /không phe nào thắng/);
    assert.match(note, /mục tiêu riêng/);
  });

  it("nhiều người thắng cá nhân thì câu chữ không nói nhầm thành một người", () => {
    const note = drawNote([jesterWin, { ...jesterWin, playerId: "jester2", name: "Hề 2" }]);
    assert.doesNotMatch(note, /một người/);
    assert.match(note, /có người đạt được mục tiêu riêng/);
  });
});

describe("personalOutcome", () => {
  it("người cùng phe với bên thắng thì thắng", () => {
    const outcome = personalOutcome(snapshot());
    assert.equal(outcome?.won, true);
    assert.equal(outcome?.verdict, "Bạn thắng");
    assert.equal(outcome?.roleName, "Tiên Tri");
    assert.equal(outcome?.statusLabel, "Sống sót");
  });

  it("sống sót vẫn có thể là thua - phe mới quyết định, không phải mạng sống", () => {
    const outcome = personalOutcome(
      snapshot({
        winner: "wolves",
        you: { id: "seer", name: "Tiên Tri", ready: false, connected: true, role: "SEER", alive: true },
      }),
    );
    assert.equal(outcome?.won, false);
    assert.equal(outcome?.verdict, "Bạn thua");
    assert.equal(outcome?.statusLabel, "Sống sót");
  });

  it("chết mà phe thắng thì vẫn là thắng", () => {
    const outcome = personalOutcome(
      snapshot({
        you: { id: "seer", name: "Tiên Tri", ready: false, connected: true, role: "SEER", alive: false },
      }),
    );
    assert.equal(outcome?.won, true);
    assert.equal(outcome?.statusLabel, "Đã bị loại");
  });

  it("Kẻ Nguyền Rủa đã hoá Sói đứng về phe Sói và mang đúng tên vai gốc", () => {
    const outcome = personalOutcome(
      snapshot({
        winner: "wolves",
        you: {
          id: "seer",
          name: "Nạn nhân",
          ready: false,
          connected: true,
          role: "WEREWOLF",
          cursedTurned: true,
          alive: true,
        },
      }),
    );
    assert.equal(outcome?.won, true);
    assert.equal(outcome?.team, "wolves");
    assert.equal(outcome?.roleName, "Kẻ Nguyền Rủa (đã hoá Ma Sói)");
  });

  it("trả null khi snapshot chưa lộ vai của người xem", () => {
    assert.equal(personalOutcome(snapshot({ you: null })), null);
    assert.equal(
      personalOutcome(
        snapshot({
          you: { id: "x", name: "X", ready: false, connected: true, alive: true },
        }),
      ),
      null,
    );
  });
});

describe("decisiveHighlight", () => {
  it("chọn theo độ quan trọng chứ không theo thứ tự thời gian", () => {
    const picked = decisiveHighlight(
      caseFile([
        highlight({ round: 1, importance: 40, title: "Mở màn" }),
        highlight({ round: 2, importance: 90, title: "Bước ngoặt" }),
        highlight({ round: 3, importance: 55, title: "Kết" }),
      ]),
    );
    assert.equal(picked?.title, "Bước ngoặt");
  });

  it("bằng điểm thì lấy sự kiện xảy ra sớm hơn", () => {
    const picked = decisiveHighlight(
      caseFile([
        highlight({ round: 1, phase: "night", importance: 70, title: "Sớm" }),
        highlight({ round: 2, phase: "day", importance: 70, title: "Muộn" }),
      ]),
    );
    assert.equal(picked?.title, "Sớm");
  });

  it("cùng vòng thì đêm đứng trước ngày", () => {
    const picked = decisiveHighlight(
      caseFile([
        highlight({ round: 2, phase: "day", importance: 70, title: "Ngày" }),
        highlight({ round: 2, phase: "night", importance: 70, title: "Đêm" }),
      ]),
    );
    assert.equal(picked?.title, "Đêm");
  });

  it("ván không có điểm ngoặt thì không bịa ra một cái", () => {
    assert.equal(
      decisiveHighlight(
        caseFile([highlight({ type: "QUIET_MATCH", title: "Ván yên ả" })], true),
      ),
      null,
    );
  });
});
