import { describe, it, expect } from "vitest";
import { buildCaseFile } from "../src/case-file";
import { DEFAULT_ROOM_CONFIG } from "../src/phases";
import type { Role } from "../src/roles";
import type { Phase } from "../src/phases";
import type { DayVoteRecap, HunterShotRecap, NightRecap, PlayerView, RoomSnapshot } from "../src/snapshot";

/**
 * Roster mặc định: đủ để dựng mọi loại điểm ngoặt mà không phải khai lại ở từng test.
 * Vai là vai CUỐI ván, đúng như snapshot ở GAME_OVER trả về.
 */
function cast(): PlayerView[] {
  return [
    { id: "p-soi", name: "Sói Cả", alive: true, isBot: false, role: "WEREWOLF" },
    { id: "p-soicon", name: "Sói Con", alive: false, isBot: false, role: "WOLF_CUB" },
    { id: "p-tientri", name: "Tiên Tri", alive: false, isBot: false, role: "SEER" },
    { id: "p-phuthuy", name: "Phù Thuỷ", alive: true, isBot: false, role: "WITCH" },
    { id: "p-thosan", name: "Thợ Săn", alive: false, isBot: false, role: "HUNTER" },
    { id: "p-baove", name: "Bảo Vệ", alive: true, isBot: false, role: "GUARD" },
    // Vai đã bị xóa cứng (Linh Mục thay bằng Sói Pháp Sư, rồi Sói Alpha - cũng
    // xóa cứng 2026-09-11): ván cũ vẫn mang chuỗi này trong JSON. Giữ nguyên để
    // khóa đường `isRole` fallback - buildCast phải loại khỏi cast thay vì ném
    // lỗi khi tra `ROLE_META`.
    { id: "p-linhmuc", name: "Linh Mục", alive: false, isBot: false, role: "PRIEST" as unknown as Role },
    { id: "p-dan", name: "Dân Làng", alive: false, isBot: false, role: "VILLAGER" },
    { id: "p-he", name: "Thằng Hề", alive: true, isBot: false, role: "JESTER" },
  ];
}

function snap(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "AB12C",
    hostId: "p-soi",
    phase: "GAME_OVER",
    config: DEFAULT_ROOM_CONFIG,
    round: 3,
    phaseEndsAt: null,
    serverNow: 1_700_000_000_000,
    you: null,
    players: cast(),
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
    ...over,
  };
}

/** Một đêm trống, để từng test chỉ phải khai đúng thứ nó quan tâm. */
function night(over: Partial<NightRecap> = {}): NightRecap {
  return {
    round: 1,
    wolfTarget: null,
    guardTarget: null,
    seerChecks: [],
    witch: { usedHeal: false, healedTarget: null, poisonTarget: null },
    deaths: [],
    ...over,
  };
}

/** Một vòng ngày đã chốt có phiên toà và có phán quyết. */
function trialDay(
  round: number,
  accusedId: string,
  lynched: boolean,
  over: Partial<DayVoteRecap> = {},
): DayVoteRecap {
  return {
    round,
    mutations: [],
    finalBallots: [],
    nomination: { kind: "TRIAL", accusedId },
    finalJudgment: { ballots: [], guilty: lynched ? 4 : 1, innocent: lynched ? 1 : 4, abstain: 0, lynched },
    ...over,
  };
}

const typesOf = (file: ReturnType<typeof buildCaseFile>) =>
  (file?.highlights ?? []).map((h) => h.type);

describe("buildCaseFile · cổng bảo mật", () => {
  const midGamePhases: Phase[] = [
    "LOBBY",
    "ROLE_REVEAL",
    "NIGHT",
    "NIGHT_RESULT",
    "DAY_DISCUSSION",
    "VOTING",
    "DEFENSE",
    "FINAL_VOTE",
    "ELIMINATION",
    "HUNTER_SHOT",
    "CHECK_WIN",
  ];

  for (const phase of midGamePhases) {
    it(`không dựng hồ sơ ở pha ${phase}`, () => {
      expect(buildCaseFile(snap({ phase }))).toBeNull();
    });
  }

  it("không dựng hồ sơ khi chưa có phe thắng, dù pha đã là GAME_OVER", () => {
    expect(buildCaseFile(snap({ winner: null }))).toBeNull();
  });

  it("dựng hồ sơ ở GAME_OVER khi đã có phe thắng", () => {
    expect(buildCaseFile(snap())).not.toBeNull();
  });
});

describe("buildCaseFile · tất định", () => {
  it("cùng snapshot cho ra hồ sơ giống hệt nhau", () => {
    const input = snap({
      nightHistory: [night({ round: 1, deaths: [{ player: { id: "p-dan", name: "Dân Làng" }, cause: "wolf" }] })],
      dayVoteHistory: [trialDay(2, "p-soicon", true)],
    });
    expect(JSON.stringify(buildCaseFile(input))).toBe(JSON.stringify(buildCaseFile(input)));
  });

  it("caseId không đổi khi serverNow đổi - reconnect phải ra cùng hồ sơ", () => {
    const a = buildCaseFile(snap({ serverNow: 1 }));
    const b = buildCaseFile(snap({ serverNow: 999_999 }));
    expect(a?.caseId).toBe(b?.caseId);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("caseId khác nhau giữa hai ván khác kết quả", () => {
    const village = buildCaseFile(snap({ winner: "village" }));
    const wolves = buildCaseFile(snap({ winner: "wolves" }));
    expect(village?.caseId).not.toBe(wolves?.caseId);
  });

  it("caseId có tiền tố ổn định và không chứa mã phòng", () => {
    const file = buildCaseFile(snap({ code: "ZZZZZ" }));
    expect(file?.caseId).toMatch(/^HS-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(file?.caseId).not.toContain("ZZZZZ");
  });

  it("hồ sơ không mang mã phòng ở bất kỳ đâu", () => {
    const file = buildCaseFile(snap({ code: "QQQQQ" }));
    expect(JSON.stringify(file)).not.toContain("QQQQQ");
  });
});

describe("buildCaseFile · không bịa dữ liệu", () => {
  it("chỉ nhắc tới người có thật trong roster", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [night({ round: 1, deaths: [{ player: { id: "p-dan", name: "Dân Làng" }, cause: "wolf" }] })],
      }),
    );
    const ids = new Set(file!.cast.map((p) => p.id));
    for (const highlight of file!.highlights) {
      for (const participant of highlight.participants) expect(ids.has(participant)).toBe(true);
    }
  });

  it("không sinh điểm ngoặt ở vòng chưa từng diễn ra", () => {
    const file = buildCaseFile(
      snap({ round: 2, nightHistory: [night({ round: 1, deaths: [] })], dayVoteHistory: [] }),
    );
    for (const highlight of file!.highlights) expect(highlight.round).toBeLessThanOrEqual(2);
  });

  it("cast giữ nguyên biệt danh gốc, không cắt chữ", () => {
    const long = "Người Chơi Có Biệt Danh Rất Dài Không Ai Đọc Hết";
    const players = cast();
    players[0] = { ...players[0], name: long };
    expect(buildCaseFile(snap({ players }))!.cast[0].name).toBe(long);
  });
});

describe("highlight · treo cổ", () => {
  it("treo trúng Sói thì là WOLF_LYNCHED", () => {
    const file = buildCaseFile(snap({ dayVoteHistory: [trialDay(2, "p-soicon", true)] }));
    expect(typesOf(file)).toContain("WOLF_LYNCHED");
    expect(typesOf(file)).not.toContain("INNOCENT_LYNCHED");
  });

  it("treo nhầm Dân Làng thì là INNOCENT_LYNCHED", () => {
    const file = buildCaseFile(snap({ dayVoteHistory: [trialDay(2, "p-dan", true)] }));
    expect(typesOf(file)).toContain("INNOCENT_LYNCHED");
  });

  it("treo một vai TRUNG LẬP thì là NEUTRAL_LYNCHED, không phải hai loại kia", () => {
    /*
     * Trước khi có phe thứ ba, "không phải phe làng" đồng nghĩa với "là Sói",
     * nên nhánh else nói thẳng "Làng tóm đúng Sói". Câu đó sẽ gọi Thằng Hề là
     * một con Sói bị tóm - vừa sai vừa che mất đúng khoảnh khắc quyết định của
     * cả ván có Hề.
     */
    const file = buildCaseFile(snap({ dayVoteHistory: [trialDay(2, "p-he", true)] }));
    const types = typesOf(file);
    expect(types).toContain("NEUTRAL_LYNCHED");
    expect(types).not.toContain("WOLF_LYNCHED");
    expect(types).not.toContain("INNOCENT_LYNCHED");

    const highlight = file!.highlights.find((h) => h.type === "NEUTRAL_LYNCHED")!;
    expect(highlight.description).toContain("Thằng Hề");
    // KHÔNG được nói nó thuộc phe Dân Làng - đó là cả điểm của phe thứ ba.
    expect(highlight.description).not.toContain("phe Dân Làng");
  });

  it("Thợ Săn bắn trúng vai trung lập vẫn là một phát đạn LẠC", () => {
    // Làng không thu được gì từ nó, nên nó không thể là "phát đạn cuối cùng".
    const shots: HunterShotRecap[] = [
      {
        round: 2,
        hunter: { id: "p-thosan", name: "Thợ Săn" },
        target: { id: "p-he", name: "Thằng Hề" },
        source: "night",
      },
    ];
    const types = typesOf(buildCaseFile(snap({ hunterShots: shots })));
    expect(types).toContain("HUNTER_MISFIRE");
    expect(types).not.toContain("HUNTER_REVENGE");
  });

  it("evidence mang đúng số phiếu để test không phải so chuỗi", () => {
    const file = buildCaseFile(snap({ dayVoteHistory: [trialDay(2, "p-dan", true)] }));
    const highlight = file!.highlights.find((h) => h.type === "INNOCENT_LYNCHED")!;
    expect(highlight.evidence).toEqual({
      kind: "lynch",
      accusedId: "p-dan",
      guilty: 4,
      innocent: 1,
      abstain: 0,
    });
    expect(highlight.round).toBe(2);
    expect(highlight.phase).toBe("day");
  });

  it("hoà phiếu KHÔNG phải xử oan", () => {
    const file = buildCaseFile(
      snap({
        dayVoteHistory: [
          { round: 2, mutations: [], finalBallots: [], nomination: { kind: "NONE", reason: "tie" }, finalJudgment: null },
        ],
      }),
    );
    expect(typesOf(file)).not.toContain("INNOCENT_LYNCHED");
    expect(typesOf(file)).not.toContain("WOLF_LYNCHED");
  });

  it("làng chọn không treo ai KHÔNG phải xử oan", () => {
    const file = buildCaseFile(
      snap({
        dayVoteHistory: [
          {
            round: 2,
            mutations: [],
            finalBallots: [],
            nomination: { kind: "NONE", reason: "no-elimination" },
            finalJudgment: null,
          },
        ],
      }),
    );
    expect(typesOf(file)).not.toContain("INNOCENT_LYNCHED");
  });

  it("không ai bỏ phiếu KHÔNG phải xử oan", () => {
    const file = buildCaseFile(
      snap({
        dayVoteHistory: [
          {
            round: 2,
            mutations: [],
            finalBallots: [],
            nomination: { kind: "NONE", reason: "no-votes" },
            finalJudgment: null,
          },
        ],
      }),
    );
    expect(typesOf(file)).not.toContain("INNOCENT_LYNCHED");
  });

  it("bị cáo được tha thì không phải xử oan, và tha nhầm Sói mới là điểm ngoặt", () => {
    const file = buildCaseFile(snap({ dayVoteHistory: [trialDay(2, "p-soi", false)] }));
    expect(typesOf(file)).not.toContain("INNOCENT_LYNCHED");
    expect(typesOf(file)).not.toContain("WOLF_LYNCHED");
    expect(typesOf(file)).toContain("WOLF_ACQUITTED");
  });

  it("tha đúng Dân Làng thì không sinh điểm ngoặt nào", () => {
    const file = buildCaseFile(snap({ dayVoteHistory: [trialDay(2, "p-dan", false)] }));
    expect(typesOf(file)).not.toContain("WOLF_ACQUITTED");
  });
});

describe("highlight · Thợ Săn", () => {
  const shot = (target: HunterShotRecap["target"]): HunterShotRecap => ({
    round: 2,
    hunter: { id: "p-thosan", name: "Thợ Săn" },
    target,
    source: "night",
  });

  it("bắn trúng Sói là HUNTER_REVENGE", () => {
    const file = buildCaseFile(snap({ hunterShots: [shot({ id: "p-soi", name: "Sói Cả" })] }));
    expect(typesOf(file)).toContain("HUNTER_REVENGE");
  });

  it("bắn nhầm Dân Làng là HUNTER_MISFIRE", () => {
    const file = buildCaseFile(snap({ hunterShots: [shot({ id: "p-dan", name: "Dân Làng" })] }));
    expect(typesOf(file)).toContain("HUNTER_MISFIRE");
  });

  it("Thợ Săn không bắn ai thì KHÔNG phải bắn nhầm", () => {
    const file = buildCaseFile(snap({ hunterShots: [shot(null)] }));
    expect(typesOf(file)).not.toContain("HUNTER_MISFIRE");
    expect(typesOf(file)).not.toContain("HUNTER_REVENGE");
  });
});

describe("highlight · vai đêm", () => {
  it("Kẻ Nguyền Rủa đổi phe được mô tả đúng chiều", () => {
    const players = cast();
    players[7] = { ...players[7], role: "WEREWOLF", cursedTurned: true, alive: true };
    const file = buildCaseFile(
      snap({
        players,
        nightHistory: [night({ round: 1, cursedTurned: { id: "p-dan", name: "Dân Làng" } })],
      }),
    );
    const highlight = file!.highlights.find((h) => h.type === "CURSED_TURNED")!;
    expect(highlight.participants).toEqual(["p-dan"]);
    expect(highlight.description).toContain("hoá Ma Sói");

    const turned = file!.cast.find((p) => p.id === "p-dan")!;
    expect(turned.originRole).toBe("CURSED");
    expect(turned.role).toBe("WEREWOLF");
    expect(turned.team).toBe("wolves");
  });

  it("Phù Thuỷ cứu đúng nạn nhân là WITCH_SAVE", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 1,
            wolfTarget: { id: "p-dan", name: "Dân Làng" },
            witch: { usedHeal: true, healedTarget: { id: "p-dan", name: "Dân Làng" }, poisonTarget: null },
            deaths: [],
          }),
        ],
      }),
    );
    expect(typesOf(file)).toContain("WITCH_SAVE");
  });

  it("đốt bình cứu mà người đó vẫn chết thì không phải cứu được", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 1,
            witch: { usedHeal: true, healedTarget: { id: "p-dan", name: "Dân Làng" }, poisonTarget: null },
            deaths: [{ player: { id: "p-dan", name: "Dân Làng" }, cause: "poison" }],
          }),
        ],
      }),
    );
    expect(typesOf(file)).not.toContain("WITCH_SAVE");
  });

  it("Bảo Vệ đỡ đúng mục tiêu của Sói là GUARD_SAVE", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 1,
            wolfTarget: { id: "p-dan", name: "Dân Làng" },
            guardTarget: { id: "p-dan", name: "Dân Làng" },
            deaths: [],
          }),
        ],
      }),
    );
    expect(typesOf(file)).toContain("GUARD_SAVE");
  });

  it("đỡ đúng người nhưng người đó vẫn chết thì không phải đỡ được", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 1,
            wolfTarget: { id: "p-dan", name: "Dân Làng" },
            guardTarget: { id: "p-dan", name: "Dân Làng" },
            deaths: [{ player: { id: "p-dan", name: "Dân Làng" }, cause: "wolf" }],
          }),
        ],
      }),
    );
    expect(typesOf(file)).not.toContain("GUARD_SAVE");
  });

  it("Thiên Thần Hộ Mệnh chắn đúng mục tiêu của Sói là ANGEL_SAVE", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 1,
            wolfTarget: { id: "p-dan", name: "Dân Làng" },
            guardianAngelTarget: { id: "p-dan", name: "Dân Làng" },
            deaths: [],
          }),
        ],
      }),
    );
    expect(typesOf(file)).toContain("ANGEL_SAVE");
  });

  it("chắn đúng người nhưng người đó vẫn chết thì không phải chắn được", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 1,
            wolfTarget: { id: "p-dan", name: "Dân Làng" },
            guardianAngelTarget: { id: "p-dan", name: "Dân Làng" },
            deaths: [{ player: { id: "p-dan", name: "Dân Làng" }, cause: "wolf" }],
          }),
        ],
      }),
    );
    expect(typesOf(file)).not.toContain("ANGEL_SAVE");
  });

  it("chắn nhầm người không bị Sói nhắm thì không phải điểm ngoặt", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 1,
            wolfTarget: { id: "p-dan", name: "Dân Làng" },
            guardianAngelTarget: { id: "p-phuthuy", name: "Phù Thuỷ" },
            deaths: [{ player: { id: "p-dan", name: "Dân Làng" }, cause: "wolf" }],
          }),
        ],
      }),
    );
    expect(typesOf(file)).not.toContain("ANGEL_SAVE");
  });

  it("hai tấm khiên cùng chắn một người chỉ tính MỘT lần cứu", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 1,
            wolfTarget: { id: "p-dan", name: "Dân Làng" },
            guardTarget: { id: "p-dan", name: "Dân Làng" },
            guardianAngelTarget: { id: "p-dan", name: "Dân Làng" },
            deaths: [],
          }),
        ],
      }),
    );
    const saves = typesOf(file).filter((type) => type === "ANGEL_SAVE" || type === "GUARD_SAVE");
    expect(saves).toEqual(["ANGEL_SAVE"]);
  });

  it("hai tấm khiên chắn hai người khác nhau thì vẫn là hai lần cứu", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 1,
            wolfTarget: { id: "p-dan", name: "Dân Làng" },
            guardTarget: { id: "p-dan", name: "Dân Làng" },
            deaths: [],
          }),
          night({
            round: 2,
            wolfTarget: { id: "p-phuthuy", name: "Phù Thuỷ" },
            guardianAngelTarget: { id: "p-phuthuy", name: "Phù Thuỷ" },
            deaths: [],
          }),
        ],
      }),
    );
    expect(typesOf(file)).toContain("GUARD_SAVE");
    expect(typesOf(file)).toContain("ANGEL_SAVE");
  });

  it("một đêm nhiều người chết là BLOODBATH", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 1,
            deaths: [
              { player: { id: "p-dan", name: "Dân Làng" }, cause: "wolf" },
              { player: { id: "p-tientri", name: "Tiên Tri" }, cause: "poison" },
            ],
          }),
        ],
      }),
    );
    expect(typesOf(file)).toContain("BLOODBATH");
  });
});

describe("câu chữ không tự lặp", () => {
  it("mô tả đêm đẫm máu không lặp lại nhãn thời điểm", () => {
    // Mọi chỗ hiển thị đều đã vẽ sẵn "Đêm 2" từ `round` + `phase`, nên mô tả
    // mở đầu bằng đúng chuỗi đó là nói hai lần cùng một điều.
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 2,
            deaths: [
              { player: { id: "p-dan", name: "Dân Làng" }, cause: "wolf" },
              { player: { id: "p-tientri", name: "Tiên Tri" }, cause: "poison" },
            ],
          }),
        ],
      }),
    );
    const highlight = file!.highlights.find((h) => h.type === "BLOODBATH")!;
    expect(highlight.description.startsWith("Đêm 2")).toBe(false);
    expect(highlight.description).toContain("2 người");
  });

  it("đêm đẫm máu không khẳng định nguyên nhân mà nó chưa kiểm tra", () => {
    // Hai người cùng chết vì Sói: nhắc tới Bình Độc ở đây là bịa.
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 2,
            deaths: [
              { player: { id: "p-dan", name: "Dân Làng" }, cause: "wolf" },
              { player: { id: "p-tientri", name: "Tiên Tri" }, cause: "wolf" },
            ],
          }),
        ],
      }),
    );
    const highlight = file!.highlights.find((h) => h.type === "BLOODBATH")!;
    expect(highlight.description).not.toContain("Bình Độc");
    expect(highlight.description).not.toContain("Nước thánh");
    expect(highlight.description).toContain("Dân Làng");
    expect(highlight.description).toContain("Tiên Tri");
  });

  it("treo nhầm Dân Làng không nói 'Dân Làng, phe Dân Làng'", () => {
    const file = buildCaseFile(snap({ dayVoteHistory: [trialDay(2, "p-dan", true)] }));
    const highlight = file!.highlights.find((h) => h.type === "INNOCENT_LYNCHED")!;
    expect(highlight.description).not.toContain("Dân Làng, phe Dân Làng");
  });

  it("treo nhầm vai chức năng vẫn nói rõ đó là phe Dân Làng", () => {
    const file = buildCaseFile(snap({ dayVoteHistory: [trialDay(2, "p-tientri", true)] }));
    const highlight = file!.highlights.find((h) => h.type === "INNOCENT_LYNCHED")!;
    expect(highlight.description).toContain("Tiên Tri");
    expect(highlight.description).toContain("phe Dân Làng");
  });
});

describe("highlight · phiếu phút chót", () => {
  const swingDay = (castAt: number): DayVoteRecap => ({
    round: 2,
    mutations: [
      {
        id: "2:nomination:1",
        round: 2,
        voterId: "p-baove",
        previousChoice: { type: "PLAYER", targetId: "p-phuthuy" },
        choice: { type: "PLAYER", targetId: "p-dan" },
        castAt,
        phaseStartedAt: 0,
        phaseEndsAt: 100,
        sequence: 1,
      },
    ],
    finalBallots: [],
    nomination: { kind: "TRIAL", accusedId: "p-dan" },
    finalJudgment: { ballots: [], guilty: 1, innocent: 4, abstain: 0, lynched: false },
  });

  it("đổi phiếu ở 25% cuối cửa sổ và trúng bị cáo thì được ghi nhận", () => {
    expect(typesOf(buildCaseFile(snap({ dayVoteHistory: [swingDay(90)] })))).toContain("LATE_VOTE_SWING");
  });

  it("đổi phiếu sớm thì không phải phút chót", () => {
    expect(typesOf(buildCaseFile(snap({ dayVoteHistory: [swingDay(10)] })))).not.toContain("LATE_VOTE_SWING");
  });

  it("chỉ mô tả thứ tự đã ghi lại, không khẳng định lá phiếu gây ra kết quả", () => {
    const file = buildCaseFile(snap({ dayVoteHistory: [swingDay(90)] }));
    const highlight = file!.highlights.find((h) => h.type === "LATE_VOTE_SWING")!;
    expect(highlight.description).not.toMatch(/quyết định|khiến|làm cho|dẫn tới/);
  });

  it("bỏ phiếu lần đầu không phải là đổi phiếu", () => {
    const day = swingDay(90);
    day.mutations[0].previousChoice = null;
    expect(typesOf(buildCaseFile(snap({ dayVoteHistory: [day] })))).not.toContain("LATE_VOTE_SWING");
  });

  it("cửa sổ phiếu suy biến thì không đoán bừa", () => {
    const day = swingDay(0);
    day.mutations[0].phaseEndsAt = 0;
    expect(typesOf(buildCaseFile(snap({ dayVoteHistory: [day] })))).not.toContain("LATE_VOTE_SWING");
  });
});

describe("chọn lọc · ưu tiên, chống trùng, thứ tự", () => {
  it("giữ tối đa 5 điểm ngoặt", () => {
    const file = buildCaseFile(
      snap({
        round: 6,
        nightHistory: [1, 2, 3, 4, 5, 6].map((round) =>
          night({
            round,
            deaths: [
              { player: { id: "p-dan", name: "Dân Làng" }, cause: "wolf" },
              { player: { id: "p-tientri", name: "Tiên Tri" }, cause: "poison" },
            ],
          }),
        ),
        dayVoteHistory: [trialDay(1, "p-dan", true), trialDay(2, "p-soi", true), trialDay(3, "p-soicon", true)],
      }),
    );
    expect(file!.highlights.length).toBeLessThanOrEqual(5);
    expect(file!.highlights.length).toBeGreaterThanOrEqual(3);
  });

  it("một lần treo cổ chỉ sinh đúng một điểm ngoặt", () => {
    const file = buildCaseFile(snap({ dayVoteHistory: [trialDay(2, "p-dan", true)] }));
    const lynchHighlights = file!.highlights.filter(
      (h) => h.type === "INNOCENT_LYNCHED" || h.type === "WOLF_LYNCHED" || h.type === "WOLF_ACQUITTED",
    );
    expect(lynchHighlights).toHaveLength(1);
  });

  it("không quá 2 điểm ngoặt cùng loại", () => {
    const file = buildCaseFile(
      snap({
        round: 5,
        nightHistory: [1, 2, 3, 4, 5].map((round) =>
          night({
            round,
            deaths: [
              { player: { id: "p-dan", name: "Dân Làng" }, cause: "wolf" },
              { player: { id: "p-tientri", name: "Tiên Tri" }, cause: "poison" },
            ],
          }),
        ),
      }),
    );
    const bloodbaths = file!.highlights.filter((h) => h.type === "BLOODBATH");
    expect(bloodbaths.length).toBeLessThanOrEqual(2);
  });

  it("xử oan được ưu tiên hơn Tiên Tri soi trúng", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 1,
            seerChecks: [
              {
                seer: { id: "p-tientri", name: "Tiên Tri" },
                target: { id: "p-soi", name: "Sói Cả" },
                isWolf: true,
              },
            ],
          }),
        ],
        dayVoteHistory: [trialDay(2, "p-dan", true)],
      }),
    );
    const innocent = file!.highlights.findIndex((h) => h.type === "INNOCENT_LYNCHED");
    expect(innocent).toBeGreaterThanOrEqual(0);
    expect(file!.highlights.find((h) => h.type === "INNOCENT_LYNCHED")!.importance).toBeGreaterThan(
      file!.highlights.find((h) => h.type === "SEER_FOUND_WOLF")?.importance ?? 0,
    );
  });

  it("hiển thị theo thứ tự thời gian, không theo độ quan trọng", () => {
    const file = buildCaseFile(
      snap({
        round: 4,
        nightHistory: [
          night({
            round: 3,
            deaths: [
              { player: { id: "p-dan", name: "Dân Làng" }, cause: "wolf" },
              { player: { id: "p-tientri", name: "Tiên Tri" }, cause: "poison" },
            ],
          }),
        ],
        dayVoteHistory: [trialDay(1, "p-soicon", true)],
      }),
    );
    const rounds = file!.highlights.map((h) => h.round);
    expect([...rounds]).toEqual([...rounds].sort((a, b) => a - b));
  });

  it("trong cùng một vòng thì đêm đứng trước ngày", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 2,
            deaths: [
              { player: { id: "p-dan", name: "Dân Làng" }, cause: "wolf" },
              { player: { id: "p-tientri", name: "Tiên Tri" }, cause: "poison" },
            ],
          }),
        ],
        dayVoteHistory: [trialDay(2, "p-soicon", true)],
      }),
    );
    const sameRound = file!.highlights.filter((h) => h.round === 2).map((h) => h.phase);
    expect(sameRound.indexOf("night")).toBeLessThan(sameRound.indexOf("day"));
  });
});

describe("fallback · ván không có điểm ngoặt", () => {
  it("ván phẳng vẫn trả về đúng một mục và bật cờ fallback", () => {
    const file = buildCaseFile(snap({ round: 1, nightHistory: [night({ round: 1 })] }));
    expect(file!.fallback).toBe(true);
    expect(file!.highlights).toHaveLength(1);
    expect(file!.highlights[0].type).toBe("QUIET_MATCH");
  });

  it("fallback không khẳng định điều gì ngoài phe thắng và số vòng", () => {
    const file = buildCaseFile(snap({ round: 1, dayVoteHistory: [trialDay(1, "p-dan", false)] }));
    expect(file!.fallback).toBe(true);
    expect(file!.highlights[0].description).toContain("Dân Làng");
    expect(file!.highlights[0].description).not.toContain("phiên toà");
  });

  it("ván có điểm ngoặt thì không bật cờ fallback", () => {
    const file = buildCaseFile(snap({ dayVoteHistory: [trialDay(2, "p-dan", true)] }));
    expect(file!.fallback).toBe(false);
    expect(typesOf(file)).not.toContain("QUIET_MATCH");
  });
});

describe("chịu được dữ liệu từ server cũ", () => {
  it("NightRecap thiếu mọi trường optional vẫn dựng được hồ sơ", () => {
    const legacy = {
      round: 1,
      wolfTarget: null,
      guardTarget: null,
      seerChecks: [],
      witch: { usedHeal: false, healedTarget: null, poisonTarget: null },
      deaths: [{ player: { id: "p-dan", name: "Dân Làng" }, cause: "wolf" as const }],
    };
    expect(() => buildCaseFile(snap({ nightHistory: [legacy] }))).not.toThrow();
  });

  it("snapshot thiếu hẳn các mảng lịch sử không làm vỡ hồ sơ", () => {
    const bare = snap();
    delete (bare as Partial<RoomSnapshot>).nightHistory;
    delete (bare as Partial<RoomSnapshot>).dayVoteHistory;
    delete (bare as Partial<RoomSnapshot>).hunterShots;
    expect(() => buildCaseFile(bare)).not.toThrow();
    expect(buildCaseFile(bare)!.fallback).toBe(true);
  });

  it("người chơi thiếu vai (server cũ chưa lộ bài) bị loại khỏi cast thay vì đoán bừa", () => {
    const players = cast();
    players[0] = { id: "p-soi", name: "Sói Cả", alive: true, isBot: false };
    const file = buildCaseFile(snap({ players }));
    expect(file!.cast.find((p) => p.id === "p-soi")).toBeUndefined();
  });

  it("lịch sử nhắc tới người không còn trong roster thì không nổ", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({ round: 1, deaths: [{ player: { id: "p-bien-mat", name: "Đã rời" }, cause: "wolf" }] }),
        ],
      }),
    );
    expect(file).not.toBeNull();
  });

  it("vai đã bị xóa (ván cũ) bị loại khỏi cast thay vì làm vỡ hồ sơ", () => {
    const players = cast();
    expect(players.find((p) => p.id === "p-linhmuc")!.role as unknown as string).toBe("PRIEST");
    const file = buildCaseFile(snap({ players }));
    expect(file).not.toBeNull();
    expect(file!.cast.find((p) => p.id === "p-linhmuc")).toBeUndefined();
  });

  it("lịch sử Nước thánh cũ (cause priest) vẫn dựng được PRIEST_STRIKE", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 1,
            priest: {
              priest: { id: "p-linhmuc", name: "Linh Mục" },
              target: { id: "p-soi", name: "Sói Cả" },
              isWolf: true,
            },
            deaths: [{ player: { id: "p-soi", name: "Sói Cả" }, cause: "priest" }],
          }),
        ],
      }),
    );
    expect(typesOf(file)).toContain("PRIEST_STRIKE");
  });

  it("lịch sử Nước thánh phản vệ (cause priest_backfire) vẫn dựng được PRIEST_BACKFIRE", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [
          night({
            round: 1,
            priest: {
              priest: { id: "p-linhmuc", name: "Linh Mục" },
              target: { id: "p-dan", name: "Dân Làng" },
              isWolf: false,
            },
            deaths: [{ player: { id: "p-linhmuc", name: "Linh Mục" }, cause: "priest_backfire" }],
          }),
        ],
      }),
    );
    expect(typesOf(file)).toContain("PRIEST_BACKFIRE");
  });
});

describe("timeline", () => {
  it("gom mọi cái chết theo đúng thứ tự thời gian", () => {
    const file = buildCaseFile(
      snap({
        round: 2,
        nightHistory: [
          night({ round: 1, deaths: [{ player: { id: "p-dan", name: "Dân Làng" }, cause: "wolf" }] }),
          night({ round: 2, deaths: [{ player: { id: "p-tientri", name: "Tiên Tri" }, cause: "poison" }] }),
        ],
        dayVoteHistory: [trialDay(1, "p-soicon", true)],
        hunterShots: [
          { round: 2, hunter: { id: "p-thosan", name: "Thợ Săn" }, target: { id: "p-soi", name: "Sói Cả" }, source: "vote" },
        ],
      }),
    );
    expect(file!.timeline.map((entry) => [entry.round, entry.phase, entry.playerId])).toEqual([
      [1, "night", "p-dan"],
      [1, "day", "p-soicon"],
      [2, "night", "p-tientri"],
      [2, "day", "p-soi"],
    ]);
  });

  it("ghi nhận nguyên nhân chết theo từng nguồn", () => {
    const file = buildCaseFile(
      snap({
        nightHistory: [night({ round: 1, deaths: [{ player: { id: "p-dan", name: "Dân Làng" }, cause: "wolf" }] })],
        dayVoteHistory: [trialDay(1, "p-soicon", true)],
      }),
    );
    expect(file!.timeline.map((entry) => entry.cause)).toEqual(["wolf", "lynch"]);
  });

  it("Thợ Săn không bắn ai thì không thêm dòng nào vào timeline", () => {
    const file = buildCaseFile(
      snap({
        hunterShots: [{ round: 1, hunter: { id: "p-thosan", name: "Thợ Săn" }, target: null, source: "night" }],
      }),
    );
    expect(file!.timeline).toHaveLength(0);
  });
});

describe("biệt danh tiếng Việt và Unicode", () => {
  it("giữ nguyên dấu tiếng Việt trong câu chữ", () => {
    const players = cast();
    players[7] = { ...players[7], name: "Nguyễn Thị Ánh Nguyệt" };
    const file = buildCaseFile(snap({ players, dayVoteHistory: [trialDay(2, "p-dan", true)] }));
    expect(file!.highlights[0].description).toContain("Nguyễn Thị Ánh Nguyệt");
  });

  it("biệt danh emoji không làm vỡ hồ sơ", () => {
    const players = cast();
    players[7] = { ...players[7], name: "🐺 sói giả danh 🌙" };
    const file = buildCaseFile(snap({ players, dayVoteHistory: [trialDay(2, "p-dan", true)] }));
    expect(file!.highlights[0].description).toContain("🐺 sói giả danh 🌙");
  });

  it("biệt danh rất dài không bị cắt trong CaseFile", () => {
    const long = "A".repeat(200);
    const players = cast();
    players[7] = { ...players[7], name: long };
    const file = buildCaseFile(snap({ players, dayVoteHistory: [trialDay(2, "p-dan", true)] }));
    expect(file!.highlights[0].description).toContain(long);
  });
});
