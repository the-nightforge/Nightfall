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
import {
  CINEMATIC_CLIPS,
  EVENT_CLIPS,
  EVENT_DETAIL_MAX,
  cinematicFor,
  nextClips,
  prefetchPlan,
  shortDetail,
} from "./cinematic-transition";

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

function event(
  id: GameEventId,
  round = 1,
  patch: Partial<GameEventView> = {},
): GameEventView {
  return {
    id,
    name: id,
    description: "",
    targetPhase: "NIGHT",
    round,
    beneficiary: "neutral",
    power: 3,
    ...patch,
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

describe("cinematicFor: chữ trên màn hình", () => {
  it("cảnh sự kiện nói tên THẬT của sự kiện, không phải nhãn của họ hình ảnh", () => {
    const played = cinematicFor(
      snap({ phase: "NIGHT", activeEvent: null }),
      snap({
        phase: "NIGHT",
        activeEvent: event("CURFEW", 1, { name: "Giới Nghiêm" }),
      }),
    );
    assert.equal(played?.title, "Giới Nghiêm");
    // Nhãn họ vẫn còn, nhưng tụt xuống làm dòng nhỏ - nó chọn clip và màu sắc.
    assert.equal(played?.kind, "RULE_CHANGE");
    assert.equal(played?.label, "Luật làng thay đổi");
  });

  it("năm sự kiện cùng họ RULE_CHANGE cho ra năm tiêu đề khác nhau", () => {
    const family: Array<[GameEventId, string]> = [
      ["CURFEW", "Giới Nghiêm"],
      ["SILENT_NIGHT", "Đêm Câm Lặng"],
      ["AMNESTY_DAY", "Ngày Ân Xá"],
      ["LAST_STAND", "Kháng Cự Cuối Cùng"],
      ["DAY_OF_TRUTH", "Ngày Sự Thật"],
    ];
    const titles = new Set<string>();
    for (const [id, name] of family) {
      const played = cinematicFor(
        snap({ phase: "NIGHT", activeEvent: null }),
        snap({ phase: "NIGHT", activeEvent: event(id, 1, { name }) }),
      );
      assert.equal(played?.kind, "RULE_CHANGE", id);
      assert.equal(played?.title, name, id);
      titles.add(played!.title);
    }
    assert.equal(titles.size, family.length, "mỗi sự kiện phải có một tiêu đề riêng");
  });

  it("cạnh pha không có sự kiện thì tiêu đề chính là nhãn cảnh, không kèm icon", () => {
    const played = cinematicFor(snap({ phase: "NIGHT" }), snap({ phase: "NIGHT_RESULT" }));
    assert.equal(played?.title, played?.label);
    assert.equal(played?.icon, null);
    assert.equal(played?.detail, null);
  });

  it("sự kiện mang theo ký hiệu của chính nó", () => {
    const played = cinematicFor(
      snap({ phase: "NIGHT", activeEvent: null }),
      snap({ phase: "NIGHT", activeEvent: event("DEAD_CAN_SPEAK") }),
    );
    assert.equal(played?.icon, "👻");
  });

  it("announcement được ưu tiên hơn description: đó là chuyện VỪA xảy ra", () => {
    const played = cinematicFor(
      snap({ phase: "DAY_DISCUSSION", activeEvent: null }),
      snap({
        phase: "DAY_DISCUSSION",
        activeEvent: event("JUDGMENT_DAY", 2, {
          name: "Ngày Phán Xét",
          description: "Công khai kết quả soi gần nhất của Thám Tử.",
          announcement: "Kết quả Thám Tử: Khải và Linh là KHÁC PHE!",
          targetPhase: "DAY",
        }),
      }),
    );
    assert.equal(played?.detail, "Kết quả Thám Tử: Khải và Linh là KHÁC PHE!");
  });

  it("không có announcement thì lấy description", () => {
    const played = cinematicFor(
      snap({ phase: "NIGHT", activeEvent: null }),
      snap({
        phase: "NIGHT",
        activeEvent: event("MOONLESS_NIGHT", 1, { description: "Tiên Tri mất khả năng soi." }),
      }),
    );
    assert.equal(played?.detail, "Tiên Tri mất khả năng soi.");
  });

  it("mô tả rỗng không sinh ra một dòng phụ trống", () => {
    const played = cinematicFor(
      snap({ phase: "NIGHT", activeEvent: null }),
      snap({ phase: "NIGHT", activeEvent: event("BLOOD_MOON", 1, { description: "   " }) }),
    );
    assert.equal(played?.detail, null);
  });

  it("sự kiện không tên thì lùi về nhãn họ chứ không hiện một dòng trống", () => {
    const played = cinematicFor(
      snap({ phase: "NIGHT", activeEvent: null }),
      snap({ phase: "NIGHT", activeEvent: event("BLOOD_MOON", 1, { name: "  " }) }),
    );
    assert.equal(played?.title, "Bầy Sói trỗi dậy");
  });

  it("thêm chữ vào cinematic không phá luật chống phát lại trên cùng lần kích hoạt", () => {
    // Cùng một lần kích hoạt, nhưng server gửi lại kèm announcement vừa tính
    // xong: đây vẫn là MỘT lần kích hoạt, không được phát thêm lần nữa.
    const before = snap({ phase: "DAY_DISCUSSION", activeEvent: event("JUDGMENT_DAY", 2) });
    const after = snap({
      phase: "DAY_DISCUSSION",
      activeEvent: event("JUDGMENT_DAY", 2, { announcement: "Kết quả Thám Tử: ..." }),
    });
    assert.equal(cinematicFor(before, after), null);
  });
});

describe("shortDetail", () => {
  it("giữ nguyên đoạn ngắn", () => {
    assert.equal(shortDetail("Tiên Tri mất khả năng soi."), "Tiên Tri mất khả năng soi.");
  });

  it("bỏ trắng thừa, và coi chuỗi trắng là không có gì", () => {
    assert.equal(shortDetail("  Giới nghiêm.  "), "Giới nghiêm.");
    assert.equal(shortDetail("   "), null);
    assert.equal(shortDetail(undefined), null);
    assert.equal(shortDetail(null), null);
  });

  it("đoạn dài bị cắt về đúng một dòng phụ và kết bằng dấu lược", () => {
    const long = "Ma Sói ".repeat(40);
    const cut = shortDetail(long)!;
    assert.ok(cut.length <= EVENT_DETAIL_MAX + 1, `dài ${cut.length}`);
    assert.ok(cut.endsWith("…"));

    // Không được cắt giữa một từ: phần giữ lại phải là một tiền tố của bản gốc
    // và phải dừng ngay trước một khoảng trắng.
    const body = cut.slice(0, -1);
    const source = long.trim();
    assert.ok(source.startsWith(body), cut);
    assert.equal(source[body.length], " ", cut);
  });

  it("chuỗi dài không có khoảng trắng nào vẫn bị cắt chứ không tràn màn hình", () => {
    const cut = shortDetail("a".repeat(400))!;
    assert.equal(cut.length, EVENT_DETAIL_MAX + 1);
  });
});

describe("prefetchPlan", () => {
  const base = { phase: "NIGHT" as Phase, mode: "video" as const, saveData: false, effectiveType: "4g" };

  it("clip của pha kế tiếp vẫn được nạp ngay như cũ", () => {
    assert.deepEqual(prefetchPlan(base).now, nextClips("NIGHT"));
  });

  it("bốn clip sự kiện đi ở luồng rảnh sau khi ván đã bắt đầu", () => {
    assert.deepEqual(prefetchPlan(base).idle, EVENT_CLIPS);
  });

  it("phòng chờ chỉ nạp theo pha: chưa có ván thì chưa có sự kiện nào nổ được", () => {
    assert.deepEqual(prefetchPlan({ ...base, phase: "LOBBY" }).idle, []);
  });

  it("hết ván thì không nạp thêm gì nữa", () => {
    assert.deepEqual(prefetchPlan({ ...base, phase: "GAME_OVER" }), { now: [], idle: [] });
  });

  it("Save-Data thì không tải một byte nào", () => {
    assert.deepEqual(prefetchPlan({ ...base, saveData: true }), { now: [], idle: [] });
  });

  it("chế độ CSS và chế độ tắt cũng không tải gì", () => {
    for (const mode of ["css", "none"] as const) {
      assert.deepEqual(prefetchPlan({ ...base, mode }), { now: [], idle: [] }, mode);
    }
  });

  it("2G bỏ luồng phụ nhưng vẫn giữ clip của pha kế tiếp", () => {
    for (const effectiveType of ["2g", "slow-2g"]) {
      const plan = prefetchPlan({ ...base, effectiveType });
      assert.deepEqual(plan.idle, [], effectiveType);
      assert.deepEqual(plan.now, nextClips("NIGHT"), effectiveType);
    }
  });

  it("trình duyệt không báo tốc độ thì cứ nạp bình thường, không đoán là mạng xấu", () => {
    assert.deepEqual(prefetchPlan({ ...base, effectiveType: null }).idle, EVENT_CLIPS);
  });

  it("một clip không bao giờ nằm cả ở luồng ngay lẫn luồng rảnh", () => {
    for (const phase of PHASES as readonly Phase[]) {
      const plan = prefetchPlan({ ...base, phase });
      for (const clip of plan.idle) {
        assert.ok(!plan.now.includes(clip), `${phase} -> ${clip}`);
      }
    }
  });

  it("chỉ trả về clip có thật trong bộ", () => {
    for (const phase of PHASES as readonly Phase[]) {
      const plan = prefetchPlan({ ...base, phase });
      for (const clip of [...plan.now, ...plan.idle]) {
        assert.ok(CINEMATIC_CLIPS.includes(clip), `${phase} -> ${clip}`);
      }
    }
  });

  it("tổng số clip nạp trước không bao giờ chạm cả bộ mười", () => {
    for (const phase of PHASES as readonly Phase[]) {
      const plan = prefetchPlan({ ...base, phase });
      assert.ok(plan.now.length + plan.idle.length < CINEMATIC_CLIPS.length, phase);
    }
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

describe("prefetchPlan khi máy dựng được cảnh 3D", () => {
  // ELIMINATION chu KHONG phai NIGHT: nextClips("NIGHT") tra ["dawn"], khong he
  // chua "nightfall", nen mot test dat o do se pass du ban sua co chay hay
  // khong. nextClips("ELIMINATION") tra ["nightfall","wolves-win","village-win"]
  // - dung ca hai ve can chung minh: nightfall bi bo, hai clip kia con nguyen.
  const base = {
    phase: "ELIMINATION" as const,
    mode: "video" as const,
    saveData: false,
    effectiveType: "4g",
  };

  it("bỏ clip của cảnh có bản 3D, GIỮ mọi clip còn lại", () => {
    const withWebgl = prefetchPlan({ ...base, webgl: true });
    const without = prefetchPlan({ ...base, webgl: false });

    assert.ok(!withWebgl.now.includes("nightfall"));
    // Đây là hồi quy đáng sợ nhất: nếu cờ webgl vô tình tắt cả prefetch thì
    // chín cảnh kia im lặng tụt về CSS, và không có gì báo.
    assert.ok(withWebgl.now.length > 0 || without.now.length === 0);
    for (const clip of without.now) {
      if (clip !== "nightfall") assert.ok(withWebgl.now.includes(clip));
    }
    assert.deepEqual(withWebgl.idle, without.idle);
  });

  it("không truyền cờ thì hành vi y như cũ", () => {
    assert.deepEqual(prefetchPlan(base), prefetchPlan({ ...base, webgl: false }));
  });
});
