import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOM_CONFIG,
  PERSONAL_WIN_CONDITIONS,
  PERSONAL_WIN_LABELS,
  PRESET_DECKS,
  ROLE_META,
  ROLE_POWER,
  ROLES,
  UNMEASURED_EXECUTIONER_WARNING,
  UNMEASURED_NEUTRAL_WARNING,
  buildCaseFile,
  calculateBalanceScore,
  generateWarnings,
  isPersonalWinCondition,
  isRole,
  roleTeam,
  roleWonOutcome,
  sameFaction,
  specialRoleList,
  validateRoomConfig,
  type RoomConfig,
  type RoomSnapshot,
} from "../src/index";

const CONFIG: RoomConfig = { ...DEFAULT_ROOM_CONFIG, executioner: true };

describe("Kẻ Báo Thù trong bảng vai", () => {
  it("là vai TRUNG LẬP không có hành động đêm", () => {
    expect(ROLE_META.EXECUTIONER.team).toBe("neutral");
    // Không `nightOrder` là điều kiện để `hasNightAction` trả false - cùng hình
    // dạng với Thằng Hề, và đó là toàn bộ cách "không có hành động đêm" được
    // biểu diễn trong dự án này.
    expect(ROLE_META.EXECUTIONER.nightOrder).toBeUndefined();
  });

  it("nằm trong ROLES và đọc ngược được từ chuỗi", () => {
    expect(ROLES).toContain("EXECUTIONER");
    expect(isRole("EXECUTIONER")).toBe(true);
  });

  it("tên tiếng Việt là Kẻ Báo Thù", () => {
    expect(ROLE_META.EXECUTIONER.name).toBe("Kẻ Báo Thù");
  });
});

describe("sameFaction - ba vai trung lập, không ai đứng cùng ai", () => {
  it("Kẻ Báo Thù khác phe với Dân, Sói và hai vai trung lập kia", () => {
    expect(sameFaction("EXECUTIONER", "VILLAGER")).toBe(false);
    expect(sameFaction("EXECUTIONER", "SEER")).toBe(false);
    expect(sameFaction("EXECUTIONER", "WEREWOLF")).toBe(false);
    expect(sameFaction("EXECUTIONER", "JESTER")).toBe(false);
    expect(sameFaction("EXECUTIONER", "SERIAL_KILLER")).toBe(false);
  });

  it("HAI Thằng Hề cũng KHÔNG cùng phe", () => {
    /*
     * Ca mà bản cũ trả lời sai. `sameFaction` từng kết thúc bằng `a === b` với
     * lý do "mỗi vai trung lập tối đa một lá mỗi ván" - đúng cho tới khi Kẻ Báo
     * Thù hoá Thằng Hề giữa ván và bàn có hai con Hề. Hai người đó thắng bằng
     * hai cái chết khác nhau và không giúp được nhau, nên Thám Tử phải đọc ra
     * KHÁC PHE.
     */
    expect(roleTeam("JESTER")).toBe("neutral");
    expect(sameFaction("JESTER", "JESTER")).toBe(false);
    expect(sameFaction("SERIAL_KILLER", "SERIAL_KILLER")).toBe(false);
    expect(sameFaction("EXECUTIONER", "EXECUTIONER")).toBe(false);
  });

  it("hai vai cùng phe THẬT vẫn là cùng phe", () => {
    expect(sameFaction("SEER", "VILLAGER")).toBe(true);
    expect(sameFaction("WEREWOLF", "WOLF_CUB")).toBe(true);
    expect(sameFaction("CURSED", "VILLAGER")).toBe(true);
  });
});

describe("thắng lợi cá nhân của Kẻ Báo Thù", () => {
  it("là một điều kiện RIÊNG, không dùng lại của Thằng Hề", () => {
    expect(PERSONAL_WIN_CONDITIONS).toContain("EXECUTIONER_TARGET_LYNCHED");
    expect(isPersonalWinCondition("EXECUTIONER_TARGET_LYNCHED")).toBe(true);
    expect(PERSONAL_WIN_LABELS.EXECUTIONER_TARGET_LYNCHED).not.toBe(
      PERSONAL_WIN_LABELS.JESTER_LYNCHED,
    );
  });

  it("nhãn nói rõ đây là ai và thắng bằng gì", () => {
    expect(PERSONAL_WIN_LABELS.EXECUTIONER_TARGET_LYNCHED).toContain("Kẻ Báo Thù");
    expect(PERSONAL_WIN_LABELS.EXECUTIONER_TARGET_LYNCHED).toContain("mục tiêu");
  });

  it("chuỗi lạ từ ván cũ vẫn bị chặn ở biên", () => {
    expect(isPersonalWinCondition("EXECUTIONER_WINS")).toBe(false);
  });

  it("KHÔNG thắng theo phe ở bất kỳ kết cục chung nào", () => {
    // Đây là hệ quả phải giữ: sổ thắng cá nhân là một sổ RIÊNG, và
    // `roleWonOutcome` không được biết gì về nó.
    expect(roleWonOutcome("EXECUTIONER", "village")).toBe(false);
    expect(roleWonOutcome("EXECUTIONER", "wolves")).toBe(false);
    expect(roleWonOutcome("EXECUTIONER", "serial_killer")).toBe(false);
    expect(roleWonOutcome("EXECUTIONER", "draw")).toBe(false);
  });
});

describe("bộ bài và số ghế", () => {
  it("bật lên là thêm ĐÚNG một lá vào bộ bài", () => {
    expect(specialRoleList(CONFIG).filter((r) => r === "EXECUTIONER")).toHaveLength(1);
    expect(specialRoleList(DEFAULT_ROOM_CONFIG)).not.toContain("EXECUTIONER");
  });

  it("chiếm một ghế như mọi vai đặc biệt khác", () => {
    const base = specialRoleList(DEFAULT_ROOM_CONFIG).length;
    expect(specialRoleList(CONFIG).length).toBe(base + 1);
  });

  it("KHÔNG có trong preset nào", () => {
    for (const deck of Object.values(PRESET_DECKS)) {
      expect(deck.executioner).toBe(false);
    }
  });

  it("mặc định TẮT", () => {
    expect(DEFAULT_ROOM_CONFIG.executioner).toBeUndefined();
  });

  it("cấu hình hợp lệ vẫn hợp lệ khi bật vai này", () => {
    // 9 chứ không phải 8: từ khi `villagers` do host đặt, bật thêm một lá là
    // bộ bài dày thêm một ghế, nên phòng cũng phải đông thêm một người.
    expect(validateRoomConfig(CONFIG, 9)).toBeNull();
  });

  it("ghế bị lấy được đếm: bộ bài chật thì bị từ chối", () => {
    const tight: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      werewolves: 2,
      seer: true,
      guard: true,
      witch: true,
      hunter: true,
      cursed: true,
      executioner: true,
    };
    // 2 Sói + 5 vai đặc biệt + 1 Kẻ Báo Thù = 8 ghế đã bị lấy. Bộ bài chật giờ
    // hỏng theo HAI đường, và cả hai đều phải bị chặn.
    //
    // Không còn Dân Làng nào:
    expect(validateRoomConfig({ ...tight, villagers: 0 }, 8)).toBe("Phải còn chỗ cho Dân Làng");
    // Còn một Dân Làng thì bộ bài dày 9, không mở được ở phòng 8 người:
    expect(validateRoomConfig({ ...tight, villagers: 1 }, 8)).toBe(
      "Bộ bài cần 9 người, phòng đang có 8",
    );
  });
});

describe("bảng cân bằng nói rõ giới hạn của chính nó", () => {
  it("sức mạnh 0 vì thang đo hai phe không đo được lá này", () => {
    expect(ROLE_POWER.EXECUTIONER).toBe(0);
  });

  it("không cộng vào villagePower cũng không cộng vào wolfPower", () => {
    const off = calculateBalanceScore({ ...DEFAULT_ROOM_CONFIG }, 8);
    const on = calculateBalanceScore(CONFIG, 8);
    expect(on.wolfPower).toBe(off.wolfPower);
    /*
     * Ảnh hưởng DUY NHẤT mà thang đo bắt được là một ghế Dân Làng bị lấy đi -
     * đúng 0.5 điểm. Con số đó nói lên chính giới hạn của thang đo, vì trên bàn
     * thật lá này nặng hơn thế nhiều.
     */
    expect(on.villagePower).toBeCloseTo(off.villagePower - ROLE_POWER.VILLAGER, 5);
  });

  it("bật lên thì có một cảnh báo RIÊNG", () => {
    expect(generateWarnings(CONFIG, 8).warnings).toContain(UNMEASURED_EXECUTIONER_WARNING);
  });

  it("cảnh báo đó KHÔNG tự nó chặn nút bắt đầu", () => {
    /*
     * Bộ bài này hợp lệ và host được quyền mở nó; thứ bị chặn là việc đọc một
     * con số 40-60 thành "đã cân bằng". So với bộ bài y hệt nhưng TẮT vai này
     * chứ không khẳng định `blocking === false` trên một con số tuyệt đối: điểm
     * cân bằng của một bộ bài tuỳ ý có thể đã lệch sẵn vì lý do khác, và một
     * khẳng định như vậy đo nhầm đại lượng.
     */
    const preset = PRESET_DECKS[9];
    const withExec = generateWarnings({ ...preset, executioner: true }, 9);
    const withoutExec = generateWarnings(preset, 9);

    expect(withExec.warnings).toContain(UNMEASURED_EXECUTIONER_WARNING);
    expect(withExec.blocking).toBe(withoutExec.blocking);
    expect(withoutExec.blocking).toBe(false);
  });

  it("cảnh báo của Kẻ Báo Thù KHÁC cảnh báo của Sát Nhân", () => {
    // Hai lá nằm ngoài thang đo vì hai lý do khác nhau, nên một câu dùng chung
    // sẽ nói sai về một trong hai.
    expect(UNMEASURED_EXECUTIONER_WARNING).not.toBe(UNMEASURED_NEUTRAL_WARNING);
    expect(UNMEASURED_EXECUTIONER_WARNING).toContain("Kẻ Báo Thù");
    const both = generateWarnings({ ...CONFIG, serialKiller: true }, 9);
    expect(both.warnings).toContain(UNMEASURED_EXECUTIONER_WARNING);
    expect(both.warnings).toContain(UNMEASURED_NEUTRAL_WARNING);
  });

  it("không bật thì không có cảnh báo nào của vai này", () => {
    expect(generateWarnings(DEFAULT_ROOM_CONFIG, 8).warnings).not.toContain(
      UNMEASURED_EXECUTIONER_WARNING,
    );
  });
});

describe("hồ sơ vụ án kể lại được người đã đổi vai", () => {
  function gameOverSnapshot(): RoomSnapshot {
    return {
      code: "EXEC1",
      hostId: "villager",
      phase: "GAME_OVER",
      config: CONFIG,
      round: 3,
      phaseEndsAt: null,
      serverNow: 0,
      you: { id: "villager", name: "Dân", ready: false, connected: true, alive: true },
      players: [
        { id: "wolf", name: "Sói", alive: false, isBot: false, role: "WEREWOLF" },
        {
          id: "exec",
          name: "Báo Thù",
          alive: true,
          isBot: false,
          role: "JESTER",
          executionerTurned: true,
        },
        { id: "villager", name: "Dân", alive: true, isBot: false, role: "VILLAGER" },
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
    };
  }

  it("originRole giữ lại vai lúc chia bài của người đã hoá Thằng Hề", () => {
    const file = buildCaseFile(gameOverSnapshot())!;
    const exec = file.cast.find((p) => p.id === "exec")!;

    expect(exec.role).toBe("JESTER");
    expect(exec.originRole).toBe("EXECUTIONER");
    // Phe vẫn đọc theo vai CUỐI ván, đúng như với Kẻ Nguyền Rủa đã hoá Sói.
    expect(exec.team).toBe("neutral");
  });

  it("bị treo thì hồ sơ KHÔNG nói đó là thứ họ đi tìm", () => {
    /*
     * "Kẻ trung lập toại nguyện" là câu đúng cho Thằng Hề và SAI cho Kẻ Báo
     * Thù: bị treo là mất luôn cả nhiệm vụ lẫn đường lui hoá Hề. Một câu chung
     * cho cả nhãn `neutral` lặp lại đúng cái lỗi mà nhánh NEUTRAL_LYNCHED sinh
     * ra để chữa, chỉ lùi vào sâu hơn một bậc.
     */
    const snapshot = gameOverSnapshot();
    snapshot.players = [
      { id: "wolf", name: "Sói", alive: false, isBot: false, role: "WEREWOLF" },
      { id: "exec", name: "Báo Thù", alive: false, isBot: false, role: "EXECUTIONER" },
      { id: "villager", name: "Dân", alive: true, isBot: false, role: "VILLAGER" },
      { id: "villager2", name: "Dân 2", alive: true, isBot: false, role: "VILLAGER" },
    ];
    snapshot.dayVoteHistory = [
      {
        round: 2,
        mutations: [],
        finalBallots: [],
        nomination: { kind: "TRIAL", accusedId: "exec" },
        finalJudgment: { ballots: [], guilty: 3, innocent: 1, abstain: 0, lynched: true },
      },
    ];

    const file = buildCaseFile(snapshot)!;
    const highlight = file.highlights.find((h) => h.type === "NEUTRAL_LYNCHED")!;

    expect(highlight.description).toContain("Kẻ Báo Thù");
    expect(highlight.description).toContain("không hề muốn kết cục này");
    expect(highlight.description).not.toContain("thứ họ đi tìm");
    // Và cũng không bị gọi là một con Sói bị tóm hay một án oan của làng.
    expect(file.highlights.map((h) => h.type)).not.toContain("WOLF_LYNCHED");
    expect(file.highlights.map((h) => h.type)).not.toContain("INNOCENT_LYNCHED");
  });

  it("một Thằng Hề bị treo VẪN đọc là toại nguyện", () => {
    // Nhánh cũ không được đổi nghĩa cho vai mà nó viết ra để phục vụ.
    const snapshot = gameOverSnapshot();
    snapshot.players = [
      { id: "wolf", name: "Sói", alive: false, isBot: false, role: "WEREWOLF" },
      { id: "exec", name: "Hề", alive: false, isBot: false, role: "JESTER" },
      { id: "villager", name: "Dân", alive: true, isBot: false, role: "VILLAGER" },
      { id: "villager2", name: "Dân 2", alive: true, isBot: false, role: "VILLAGER" },
    ];
    snapshot.dayVoteHistory = [
      {
        round: 2,
        mutations: [],
        finalBallots: [],
        nomination: { kind: "TRIAL", accusedId: "exec" },
        finalJudgment: { ballots: [], guilty: 3, innocent: 1, abstain: 0, lynched: true },
      },
    ];

    const highlight = buildCaseFile(snapshot)!.highlights.find(
      (h) => h.type === "NEUTRAL_LYNCHED",
    )!;
    expect(highlight.description).toContain("thứ họ đi tìm");
  });

  it("người KHÔNG đổi vai thì originRole trùng role", () => {
    const file = buildCaseFile(gameOverSnapshot())!;
    const villager = file.cast.find((p) => p.id === "villager")!;
    expect(villager.originRole).toBe(villager.role);
  });
});
