import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOM_CONFIG,
  PRESET_DECKS,
  ROLE_META,
  ROLE_POWER,
  buildCaseFile,
  calculateBalanceScore,
  generateWarnings,
  isMatchOutcome,
  outcomeHeadline,
  outcomeName,
  outcomeTeam,
  roleTeam,
  roleWonOutcome,
  sameFaction,
  specialRoleList,
  validateRoomConfig,
  type RoomConfig,
  type RoomSnapshot,
} from "../src/index";

const CONFIG: RoomConfig = { ...DEFAULT_ROOM_CONFIG, serialKiller: true };

describe("Sát Nhân trong bảng vai", () => {
  it("là vai TRUNG LẬP có hành động đêm", () => {
    expect(ROLE_META.SERIAL_KILLER.team).toBe("neutral");
    // Có `nightOrder` là điều kiện để `hasNightAction` trả true - và đó là chỗ
    // khác biệt duy nhất về cơ chế so với Thằng Hề.
    expect(ROLE_META.SERIAL_KILLER.nightOrder).toBeTypeOf("number");
    expect(ROLE_META.JESTER.nightOrder).toBeUndefined();
  });

  it("KHÔNG phải vai quyền lực của phe làng", () => {
    // `isPowerRole` lọc theo `team === "village"`, nên đây là hệ quả chứ không
    // phải một loại trừ chép tay - nhưng nó là hệ quả đáng khoá lại: tập đó
    // trả lời câu "bầy Sói có lý do cắn ngay khi lộ mặt không".
    expect(roleTeam("SERIAL_KILLER")).toBe("neutral");
  });
});

describe("sameFaction - hai vai trung lập KHÔNG chung phe", () => {
  it("Sát Nhân khác phe với Dân, Sói và Thằng Hề", () => {
    expect(sameFaction("SERIAL_KILLER", "VILLAGER")).toBe(false);
    expect(sameFaction("SERIAL_KILLER", "SEER")).toBe(false);
    expect(sameFaction("SERIAL_KILLER", "WEREWOLF")).toBe(false);
    /*
     * Ca quan trọng nhất của cả tập này.
     *
     * `roleTeam("SERIAL_KILLER") === roleTeam("JESTER")` là TRUE - cả hai mang
     * nhãn `neutral`. Thám Tử đọc kết quả ấy thành "cùng phe" và làng dựng cả
     * một ngày lên trên một kết luận sai về đúng hai lá bài nguy hiểm nhất.
     */
    expect(roleTeam("SERIAL_KILLER")).toBe(roleTeam("JESTER"));
    expect(sameFaction("SERIAL_KILLER", "JESTER")).toBe(false);
  });

  it("hai vai cùng phe THẬT vẫn là cùng phe", () => {
    expect(sameFaction("SEER", "VILLAGER")).toBe(true);
    expect(sameFaction("WEREWOLF", "WOLF_CUB")).toBe(true);
    // Kẻ Nguyền Rủa đã hoá Sói được engine ghi đè hẳn `role`, nên phép so này
    // đọc đúng phe MỚI.
    expect(sameFaction("CURSED", "VILLAGER")).toBe(true);
  });
});

describe("bộ bài và cấu hình", () => {
  it("chiếm đúng MỘT ghế, và tối đa một lá", () => {
    const deck = specialRoleList(CONFIG);
    expect(deck.filter((role) => role === "SERIAL_KILLER")).toHaveLength(1);
    expect(specialRoleList({ ...CONFIG, serialKiller: false })).not.toContain("SERIAL_KILLER");
  });

  it("ghế của Sát Nhân được tính vào tổng vai đặc biệt", () => {
    // 9 người, 2 Sói + Tiên Tri + Bảo Vệ + Phù Thuỷ = 5 ghế; thêm Sát Nhân là
    // 6, vẫn còn chỗ cho Dân Làng.
    expect(validateRoomConfig(CONFIG, 9)).toBeNull();
    // Bàn nhỏ nhất mở được là 8 người; 7 ghế đã kín thì lá Sát Nhân là lá thứ
    // tám và không còn chỗ cho Dân Làng.
    const tight: RoomConfig = { ...CONFIG, hunter: true, cursed: true, villagers: 0 };
    expect(validateRoomConfig(tight, 8)).toBe("Phải còn chỗ cho Dân Làng");
    // Gỡ Sát Nhân ra là ghế thứ tám trống lại, vừa đúng một Dân Làng.
    expect(validateRoomConfig({ ...tight, serialKiller: false, villagers: 1 }, 8)).toBeNull();
  });

  it("không preset chuẩn nào chứa Sát Nhân", () => {
    for (const [count, preset] of Object.entries(PRESET_DECKS)) {
      expect(preset.serialKiller, `preset ${count}`).toBe(false);
    }
  });
});

/*
 * Bộ bài cho khối cân bằng: bật thêm Thợ Săn và Thám Tử để đứng GẦN preset
 * 9 người.
 *
 * Khối này cần một bộ bài mà điểm cân bằng nằm gọn trong vùng 40-60 - đó
 * chính là cái bẫy mà cảnh báo Sát Nhân sinh ra để chặn. `CONFIG` trần ở 9
 * người chỉ được 41, và Sát Nhân lấy mất một ghế Dân Làng là rơi xuống 39.5:
 * điểm đỏ vì lệch preset, không phải vì lá bài đang thử. Kể từ khi preset 9
 * đổi Sói Con thành Sói thường, khoảng cách đó không còn đủ. Riêng một fixture
 * chứ không sửa `CONFIG`: khối đếm ghế ở trên dựa vào việc `CONFIG` có đúng
 * năm lá đặc biệt.
 */
const BALANCED: RoomConfig = { ...CONFIG, hunter: true, detective: true };

describe("bảng cân bằng KHÔNG đo được Sát Nhân", () => {
  it("không cộng vào sức mạnh của phe nào", () => {
    expect(ROLE_POWER.SERIAL_KILLER).toBe(0);

    const without = calculateBalanceScore({ ...BALANCED, serialKiller: false }, 9);
    const with_ = calculateBalanceScore(BALANCED, 9);

    // Sói không đổi: lá này không nằm ở vế đó.
    expect(with_.wolfPower).toBe(without.wolfPower);
    /*
     * Làng giảm ĐÚNG một lá Dân Làng (0.5), không hơn không kém.
     *
     * Đây là toàn bộ ảnh hưởng mà thang đo hai phe nhìn thấy được: nó lấy mất
     * một ghế. Việc nó giết một người mỗi đêm thì bảng này không có chỗ nào để
     * ghi, và đó chính là lý do có cảnh báo ở test dưới.
     */
    expect(without.villagePower - with_.villagePower).toBeCloseTo(ROLE_POWER.VILLAGER, 5);
  });

  it("phát một cảnh báo RIÊNG thay vì để điểm số đứng ra bảo lãnh", () => {
    const warning = generateWarnings(BALANCED, 9);
    const without = generateWarnings({ ...BALANCED, serialKiller: false }, 9);

    // Điểm vẫn nằm gọn trong ngưỡng "cân bằng" - đúng cái bẫy mà cảnh báo này
    // sinh ra để chặn.
    expect(warning.score).toBeGreaterThanOrEqual(40);
    expect(warning.score).toBeLessThanOrEqual(60);
    expect(warning.warnings.some((line) => line.includes("Sát Nhân"))).toBe(true);
    /*
     * CẢNH BÁO, không phải cổng chặn: bộ bài này hợp lệ và host được mở nó.
     *
     * So với CHÍNH bộ bài đó khi tắt Sát Nhân chứ không khẳng định `false`
     * tuyệt đối: `blocking` của một bộ bài tuỳ chỉnh còn phụ thuộc những lệch
     * lạc khác (ở đây là năng lực soi so với preset 9 người), và một khẳng định
     * tuyệt đối sẽ đỏ vì một lý do chẳng liên quan gì tới lá bài đang thử.
     */
    expect(warning.blocking).toBe(without.blocking);
  });

  it("ván không bật Sát Nhân không mọc thêm cảnh báo nào", () => {
    const off = generateWarnings({ ...BALANCED, serialKiller: false }, 9);
    expect(off.warnings.some((line) => line.includes("Sát Nhân"))).toBe(false);
  });
});

describe("kết cục của ván", () => {
  it("isMatchOutcome nhận đúng bốn giá trị", () => {
    expect(["wolves", "village", "serial_killer", "draw"].every(isMatchOutcome)).toBe(true);
    expect(isMatchOutcome("unknown")).toBe(false);
    expect(isMatchOutcome(null)).toBe(false);
    expect(isMatchOutcome("VILLAGE")).toBe(false);
  });

  it("Sát Nhân thắng MỘT MÌNH, nên nhãn là tên vai chứ không phải tên phe", () => {
    expect(outcomeTeam("serial_killer")).toBe("neutral");
    expect(outcomeName("serial_killer")).toBe("Sát Nhân");
    expect(outcomeHeadline("serial_killer")).toBe("Sát Nhân chiến thắng");
    // KHÔNG được là "Phe Trung lập chiến thắng": Thằng Hề cũng mang nhãn đó và
    // nó không thắng gì trong ván ấy.
    expect(outcomeName("serial_killer")).not.toContain("Phe");
  });

  it("hoà không có phe nào và không có tên nào", () => {
    expect(outcomeTeam("draw")).toBeNull();
    expect(outcomeName("draw")).toBeNull();
    expect(outcomeHeadline("draw")).toContain("hoà");
  });

  it("roleWonOutcome không trao chiến thắng nhầm", () => {
    expect(roleWonOutcome("SERIAL_KILLER", "serial_killer")).toBe(true);
    // Thằng Hề mang cùng nhãn phe nhưng KHÔNG thắng theo kết cục này.
    expect(roleWonOutcome("JESTER", "serial_killer")).toBe(false);
    expect(roleWonOutcome("VILLAGER", "serial_killer")).toBe(false);
    // Sát Nhân KHÔNG thắng theo phe làng dù nó không phải Sói.
    expect(roleWonOutcome("SERIAL_KILLER", "village")).toBe(false);
    // Hoà: không ai thắng theo phe, kể cả người còn sống.
    for (const role of ["VILLAGER", "WEREWOLF", "SERIAL_KILLER", "JESTER"] as const) {
      expect(roleWonOutcome(role, "draw"), role).toBe(false);
    }
    // Luật cũ giữ nguyên từng bit.
    expect(roleWonOutcome("VILLAGER", "village")).toBe(true);
    expect(roleWonOutcome("WOLF_CUB", "wolves")).toBe(true);
  });
});

function endedSnapshot(winner: RoomSnapshot["winner"]): RoomSnapshot {
  return {
    code: "SK001",
    hostId: "villager",
    phase: "GAME_OVER",
    config: CONFIG,
    round: 4,
    phaseEndsAt: null,
    serverNow: 0,
    you: { id: "killer", name: "Sát", ready: false, connected: true, role: "SERIAL_KILLER", alive: true },
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
    winner,
    chatLog: [],
    log: [],
  };
}

describe("hồ sơ vụ án nhận cả bốn kết cục", () => {
  it("dựng được hồ sơ cho ván Sát Nhân thắng", () => {
    const file = buildCaseFile(endedSnapshot("serial_killer"));
    expect(file).not.toBeNull();
    expect(file!.winner).toBe("serial_killer");
    // Không có "người sống sót cuối cùng của phe thắng": kẻ thắng đứng một
    // mình, và `outcomeTeam` là thứ giữ cho phép lọc đó không bao giờ khớp
    // nhầm sang phe làng.
    expect(file!.highlights.length).toBeGreaterThan(0);
  });

  it("dựng được hồ sơ cho ván hoà", () => {
    const draw = endedSnapshot("draw");
    draw.players = draw.players.map((player) => ({ ...player, alive: false }));
    const file = buildCaseFile({ ...draw, you: { ...draw.you!, alive: false } });
    expect(file).not.toBeNull();
    expect(file!.winner).toBe("draw");
    // Câu đường lui KHÔNG được nói "Phe undefined thắng".
    expect(file!.highlights[0].description).not.toContain("undefined");
  });

  it("vẫn từ chối một snapshot chưa kết thúc hoặc mang kết cục lạ", () => {
    expect(buildCaseFile({ ...endedSnapshot("village"), phase: "NIGHT" })).toBeNull();
    expect(
      buildCaseFile({ ...endedSnapshot("village"), winner: "nonsense" as RoomSnapshot["winner"] }),
    ).toBeNull();
  });
});
