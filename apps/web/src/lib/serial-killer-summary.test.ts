import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ROOM_CONFIG,
  UNMEASURED_NEUTRAL_WARNING,
  type PersonalWin,
  type RoomSnapshot,
} from "@masoi/shared";
import { personalOutcome, winnerCopy } from "./game-over-summary";
import { cuesFor } from "./audio-cues";
import { roleGoal } from "./role-goal";
import { seerReading } from "./seer-reading";
import { deathCauseClause } from "./death-cause";
import { CONFIG_KEY, NEUTRAL_ROLES, deckCounts, isPresetDeck } from "./lobby-summary";
import { PRESET_DECKS } from "./balance";
import { ROLE_ICON_PATHS } from "./role-art";
import { cinematicFor } from "./cinematic-transition";
import { balanceCopy } from "./balance-copy";

const JESTER_WIN: PersonalWin = {
  playerId: "jester",
  name: "Hề",
  role: "JESTER",
  condition: "JESTER_LYNCHED",
  round: 2,
};

function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "SKILL",
    hostId: "villager",
    phase: "GAME_OVER",
    config: { ...DEFAULT_ROOM_CONFIG, serialKiller: true },
    round: 4,
    phaseEndsAt: null,
    serverNow: 0,
    you: {
      id: "killer",
      name: "Sát",
      ready: false,
      connected: true,
      role: "SERIAL_KILLER",
      alive: true,
    },
    players: [
      { id: "killer", name: "Sát", alive: true, isBot: false, role: "SERIAL_KILLER" },
      { id: "villager", name: "Dân", alive: false, isBot: false, role: "VILLAGER" },
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
    winner: "serial_killer",
    chatLog: [],
    log: [],
    ...overrides,
  };
}

describe("winnerCopy nói đúng cả bốn kết cục", () => {
  it("Sát Nhân thắng MỘT MÌNH, không mượn danh phe trung lập", () => {
    const copy = winnerCopy("serial_killer");
    assert.equal(copy.headline, "Sát Nhân chiến thắng");
    // Sắc hổ phách của phe trung lập, nhưng TÊN là tên vai: Thằng Hề cũng mang
    // nhãn `neutral` và nó không thắng gì trong ván này.
    assert.equal(copy.tone, "neutral");
    assert.equal(copy.name, "Sát Nhân");
    assert.ok(!copy.headline.includes("Phe"));
  });

  it("hoà không có phe nào và không mượn màu của phe nào", () => {
    const copy = winnerCopy("draw");
    assert.equal(copy.tone, "draw");
    assert.equal(copy.team, null);
    assert.equal(copy.name, null);
    assert.ok(copy.headline.includes("hoà"));
  });

  it("hai kết cục cũ giữ nguyên từng chữ", () => {
    assert.equal(winnerCopy("wolves").headline, "Phe Ma Sói chiến thắng");
    assert.equal(winnerCopy("village").headline, "Phe Dân Làng chiến thắng");
    assert.equal(winnerCopy("wolves").tone, "wolves");
    assert.equal(winnerCopy("village").tone, "village");
  });
});

describe("personalOutcome với Sát Nhân và với ván hoà", () => {
  it("Sát Nhân sống tới cuối là THẮNG", () => {
    const outcome = personalOutcome(snapshot());
    assert.ok(outcome);
    /*
     * Phe của vai này là `neutral`, không bao giờ bằng `"serial_killer"`. Một
     * phép so `team === winner` báo "Bạn thua" cho đúng người vừa thắng cả ván.
     */
    assert.equal(outcome.won, true);
    assert.equal(outcome.verdict, "Bạn thắng");
    assert.equal(outcome.roleName, "Sát Nhân");
  });

  it("người làng trong ván Sát Nhân thắng là THUA", () => {
    const view = snapshot({
      you: {
        id: "villager",
        name: "Dân",
        ready: false,
        connected: true,
        role: "VILLAGER",
        alive: false,
      },
    });
    const outcome = personalOutcome(view)!;
    assert.equal(outcome.won, false);
    assert.equal(outcome.verdict, "Bạn thua");
  });

  it("Thằng Hề KHÔNG thắng lây theo kết cục của Sát Nhân", () => {
    const view = snapshot({
      you: { id: "jester", name: "Hề", ready: false, connected: true, role: "JESTER", alive: true },
    });
    // Cùng nhãn phe `neutral`, hai ván khác nhau. Nó chỉ thắng bằng sổ riêng.
    assert.equal(personalOutcome(view)!.won, false);
  });

  it("ván hoà: nhãn nói về KẾT CỤC của ván, không tuyên bố hộ cả bàn", () => {
    const view = snapshot({
      winner: "draw",
      you: { id: "killer", name: "Sát", ready: false, connected: true, role: "SERIAL_KILLER", alive: false },
    });
    const outcome = personalOutcome(view)!;
    assert.equal(outcome.won, false);
    // "Bạn thua" là câu SAI cho một ván hoà: hoà không phải một ván có kẻ thắng
    // người thua. Nhưng "Không ai thắng" cũng sai - nó nói hộ cả những người
    // mà `personalOutcome` không được cấp thông tin để nói hộ.
    assert.equal(outcome.verdict, "Ván đấu hoà");
  });

  it("ván hoà CÓ Hề thắng: người xem ngoài cuộc vẫn chỉ đọc 'Ván đấu hoà'", () => {
    /*
     * Đây là ván mà nhãn cũ tự mâu thuẫn: cùng một màn hình vừa ghi "Không ai
     * thắng" ở thẻ hero, vừa liệt kê Thằng Hề trong khối "Thắng cá nhân" ngay
     * dưới. Sổ riêng của Hề không đổi kết quả của người xem, nhưng nó cấm nhãn
     * kia nói thay cho cả bàn.
     */
    const view = snapshot({
      winner: "draw",
      personalWins: [JESTER_WIN],
      you: {
        id: "villager",
        name: "Dân",
        ready: false,
        connected: true,
        role: "VILLAGER",
        alive: false,
      },
    });
    const outcome = personalOutcome(view)!;
    assert.equal(outcome.won, false);
    assert.equal(outcome.verdict, "Ván đấu hoà");
    // Người xem không có sổ riêng, nhưng sổ của Hề vẫn nguyên trong snapshot.
    assert.equal(outcome.personalWin, null);
  });

  it("thắng lợi cá nhân của Hề vẫn được giữ trong một ván HOÀ", () => {
    const view = snapshot({
      winner: "draw",
      personalWins: [JESTER_WIN],
      you: { id: "jester", name: "Hề", ready: false, connected: true, role: "JESTER", alive: false },
    });
    const outcome = personalOutcome(view)!;
    assert.equal(outcome.won, true);
    assert.equal(outcome.verdict, "Bạn thắng");
    assert.deepEqual(outcome.personalWin, JESTER_WIN);
  });
});

describe("âm thanh cuối ván", () => {
  const before = snapshot({ phase: "CHECK_WIN", winner: null });

  it("Sát Nhân nghe tiếng THẮNG", () => {
    assert.ok(cuesFor(before, snapshot()).includes("win"));
  });

  it("người làng trong ván đó nghe tiếng THUA", () => {
    const view = snapshot({
      you: { id: "villager", name: "Dân", ready: false, connected: true, role: "VILLAGER", alive: false },
    });
    assert.ok(cuesFor({ ...before, you: view.you }, view).includes("lose"));
  });

  it("ván hoà: tiếng thua cho mọi người, TRỪ người có thắng lợi cá nhân", () => {
    const draw = snapshot({
      winner: "draw",
      you: { id: "villager", name: "Dân", ready: false, connected: true, role: "VILLAGER", alive: false },
    });
    assert.ok(cuesFor({ ...before, you: draw.you }, draw).includes("lose"));

    const jesterDraw = snapshot({
      winner: "draw",
      personalWins: [JESTER_WIN],
      you: { id: "jester", name: "Hề", ready: false, connected: true, role: "JESTER", alive: false },
    });
    assert.ok(cuesFor({ ...before, you: jesterDraw.you }, jesterDraw).includes("win"));
  });
});

describe("chuyển cảnh cuối ván", () => {
  const before = snapshot({ phase: "CHECK_WIN", winner: null });

  it("mỗi kết cục có một cảnh riêng, không cảnh nào bị gán nhầm", () => {
    const kindFor = (winner: RoomSnapshot["winner"]) =>
      cinematicFor(before, snapshot({ winner }))?.kind;

    assert.equal(kindFor("wolves"), "WOLVES_WIN");
    assert.equal(kindFor("village"), "VILLAGE_WIN");
    // Biểu thức hai nhánh cũ chiếu màn "Dân Làng chiến thắng" lên đúng những
    // ván mà cả làng vừa chết sạch.
    assert.equal(kindFor("serial_killer"), "KILLER_WIN");
    assert.equal(kindFor("draw"), "DRAW");
  });
});

describe("Sát Nhân trong phòng chờ và trên thẻ vai", () => {
  it("đứng ở nhóm TRUNG LẬP, không nằm dưới nhãn phe Dân Làng", () => {
    assert.ok(NEUTRAL_ROLES.includes("SERIAL_KILLER"));
    assert.equal(CONFIG_KEY.SERIAL_KILLER, "serialKiller");
  });

  it("chiếm một ghế trong bộ bài, đúng như mọi vai đặc biệt khác", () => {
    const on = deckCounts({ ...DEFAULT_ROOM_CONFIG, serialKiller: true }, 9);
    const off = deckCounts({ ...DEFAULT_ROOM_CONFIG, serialKiller: false }, 9);

    assert.equal(on.specials, off.specials + 1);
    assert.equal(on.villagers, off.villagers - 1);
    assert.equal(on.wolves, off.wolves);
  });

  it("bật Sát Nhân là rời khỏi preset chuẩn", () => {
    // `isPresetDeck` so từng khoá trong `CONFIG_KEY`; thiếu khoá mới ở đó là
    // một bộ bài có Sát Nhân vẫn được chấm là "preset chuẩn".
    const preset = PRESET_DECKS[6];
    assert.equal(isPresetDeck(preset, 6), true);
    assert.equal(isPresetDeck({ ...preset, serialKiller: true }, 6), false);
  });

  it("có biểu tượng riêng, không dùng chung với vai nào khác", () => {
    const path = ROLE_ICON_PATHS.SERIAL_KILLER;
    assert.ok(path && path.length > 0);
    const duplicates = Object.entries(ROLE_ICON_PATHS).filter(
      ([role, value]) => role !== "SERIAL_KILLER" && value === path,
    );
    assert.deepEqual(duplicates, []);
  });

  it("mục tiêu trên thẻ vai nói đúng luật thắng của nó", () => {
    const goal = roleGoal("SERIAL_KILLER");
    assert.ok(goal.includes("một mình"));
    // Và KHÔNG được là câu mục tiêu của Thằng Hề.
    assert.notEqual(goal, roleGoal("JESTER"));
  });
});

describe("thẻ cân bằng nói đúng về một lá ngoài thang đo", () => {
  const warning = (over: Partial<Parameters<typeof balanceCopy>[0]> = {}) =>
    balanceCopy(
      {
        score: 50,
        warnings: [UNMEASURED_NEUTRAL_WARNING],
        blocking: false,
        villagePower: 12,
        wolfPower: 10,
        ...over,
      },
      9,
    );

  it("KHÔNG gọi đó là một đội hình lệch", () => {
    const copy = warning();
    /*
     * Bộ bài này cân đúng như mọi bộ bài khác - chỉ là phép chấm không với tới
     * một lá của nó. "Đội hình hơi lệch" sẽ đẩy host đi sửa một thứ không hỏng.
     */
    assert.equal(copy.headline, "Bộ bài có vai ngoài thang đo");
    assert.equal(copy.blocksStart, false);
  });

  it("nói bằng tiếng người, và KHÔNG khuyên chỉnh lại vai nào", () => {
    const advice = warning().advice.join(" ");
    assert.match(advice, /Sát Nhân/);
    assert.doesNotMatch(advice, /Hãy (thêm|bật|chỉnh)/);
  });

  it("một cảnh báo lệch THẬT đi kèm thì tiêu đề quay về câu cũ", () => {
    const copy = warning({
      score: 62,
      warnings: [UNMEASURED_NEUTRAL_WARNING, "Cân bằng lệch: BalanceScore 62 ngoài ngưỡng 40-60"],
    });
    assert.equal(copy.headline, "Đội hình hơi lệch");
  });
});

describe("câu chữ không tiết lộ nguồn cái chết", () => {
  it("kết quả soi đọc ra PHE TRUNG LẬP, không đọc ra tên vai", () => {
    const reading = seerReading("neutral", false);
    assert.ok(reading.label.toLowerCase().includes("trung lập"));
    assert.ok(!reading.label.includes("Sát Nhân"));
    // Và nó KHÔNG mang màu xanh của "an toàn".
    assert.notEqual(reading.className, seerReading("village", false).className);
  });

  it("mệnh đề cái chết mô tả nhát dao mà không gọi tên vai", () => {
    const clause = deathCauseClause("serial_killer");
    assert.ok(clause.length > 0);
    assert.ok(!clause.includes("Sát Nhân"));
    // Và nó khác hẳn nhát cắn của Sói: hai nguồn, hai câu.
    assert.notEqual(clause, deathCauseClause("wolf"));
  });
});
