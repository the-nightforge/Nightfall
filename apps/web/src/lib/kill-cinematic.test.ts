import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROOM_CONFIG, type PlayerView, type RoomSnapshot } from "@masoi/shared";
import { deathCauseClause } from "./death-cause";
import {
  MAX_KILL_PORTRAITS,
  isKillKind,
  killAnnouncement,
  killEyebrow,
  killSceneFor,
  killTitle,
} from "./kill-cinematic";

function player(id: string, patch: Partial<PlayerView> = {}): PlayerView {
  return { id, name: id.toUpperCase(), alive: false, isBot: false, ...patch };
}

function snap(patch: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "MOONS",
    hostId: "a",
    phase: "NIGHT_RESULT",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 2,
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

/** Một đêm có `count` người chết, kèm đủ `players[]` để tra ảnh. */
function nightOf(count: number, avatars: Record<string, string | null> = {}) {
  const ids = Array.from({ length: count }, (_, i) => `p${i + 1}`);
  return snap({
    phase: "NIGHT_RESULT",
    lastNightDeaths: ids.map((id) => ({ playerId: id, name: `Người ${id}` })),
    players: ids.map((id) => player(id, { name: `Người ${id}`, avatarUrl: avatars[id] ?? null })),
  });
}

describe("isKillKind", () => {
  it("đúng hai cảnh có chân dung nạn nhân", () => {
    assert.equal(isKillKind("NIGHT_KILL"), true);
    assert.equal(isKillKind("EXECUTION"), true);
  });

  it("cảnh bình minh và cảnh phán quyết trống KHÔNG phải cảnh kill", () => {
    // Đây chính là cặp mà `phaseKind` chọn khi không ai chết; nhầm ở đây nghĩa
    // là một đêm bình yên cũng dựng khung chân dung rỗng.
    assert.equal(isKillKind("DAWN"), false);
    assert.equal(isKillKind("VERDICT"), false);
    assert.equal(isKillKind("NIGHTFALL"), false);
  });
});

describe("killSceneFor", () => {
  it("cảnh không phải cảnh kill thì không dựng gì, dù snapshot có người chết", () => {
    assert.equal(killSceneFor("DAWN", nightOf(2)), null);
  });

  it("đêm có một người chết: đúng một chân dung, không tràn", () => {
    const view = killSceneFor("NIGHT_KILL", nightOf(1));
    assert.equal(view?.mode, "NIGHT");
    assert.equal(view?.total, 1);
    assert.equal(view?.overflow, 0);
    assert.deepEqual(view?.victims.map((v) => v.name), ["Người p1"]);
  });

  it("lấy avatarUrl từ players[] của đúng người đó", () => {
    const view = killSceneFor("NIGHT_KILL", nightOf(2, { p2: "https://cdn/x.png" }));
    assert.equal(view?.victims[0].avatarUrl, null);
    assert.equal(view?.victims[1].avatarUrl, "https://cdn/x.png");
  });

  it("nạn nhân không có trong players[] vẫn lên hình bằng tên, không làm vỡ cảnh", () => {
    // Snapshot lệch nhau là chuyện có thật giữa hai lần deploy; mất một khuôn
    // mặt còn hơn mất cả mốc công bố.
    const view = killSceneFor(
      "NIGHT_KILL",
      snap({ lastNightDeaths: [{ playerId: "ghost", name: "Vô Danh" }], players: [] }),
    );
    assert.equal(view?.victims.length, 1);
    assert.equal(view?.victims[0].name, "Vô Danh");
    assert.equal(view?.victims[0].avatarUrl, null);
  });

  it("đêm không ai chết thì không có cảnh kill nào - bình minh giữ nguyên", () => {
    assert.equal(killSceneFor("NIGHT_KILL", snap({ lastNightDeaths: [] })), null);
  });

  it(`nhiều hơn ${MAX_KILL_PORTRAITS} người thì cắt bớt chân dung nhưng KHÔNG cắt con số`, () => {
    const view = killSceneFor("NIGHT_KILL", nightOf(5));
    assert.equal(view?.victims.length, MAX_KILL_PORTRAITS);
    assert.equal(view?.total, 5);
    assert.equal(view?.overflow, 5 - MAX_KILL_PORTRAITS);
  });

  it("giữ nguyên thứ tự server, để cả phòng thấy cùng một hàng", () => {
    const view = killSceneFor("NIGHT_KILL", nightOf(3));
    assert.deepEqual(view?.victims.map((v) => v.playerId), ["p1", "p2", "p3"]);
  });

  it("treo cổ: đúng một nạn nhân, lấy từ lastEliminated", () => {
    const view = killSceneFor(
      "EXECUTION",
      snap({
        phase: "ELIMINATION",
        lastEliminated: { playerId: "p9", name: "Bị Cáo" },
        players: [player("p9", { name: "Bị Cáo", avatarUrl: "https://cdn/b.png" })],
      }),
    );
    assert.equal(view?.mode, "EXECUTION");
    assert.equal(view?.total, 1);
    assert.equal(view?.overflow, 0);
    assert.deepEqual(view?.victims, [
      { playerId: "p9", name: "Bị Cáo", avatarUrl: "https://cdn/b.png" },
    ]);
  });

  it("được tha thì không có cảnh treo nào", () => {
    assert.equal(
      killSceneFor("EXECUTION", snap({ phase: "ELIMINATION", lastEliminated: null })),
      null,
    );
  });

  it("cảnh đêm KHÔNG bao giờ đọc lastEliminated, và ngược lại", () => {
    // Hai nguồn dữ liệu tách hẳn nhau: ELIMINATION vẫn còn lastNightDeaths của
    // đêm trước trong một số pha, và trộn hai nguồn sẽ treo nhầm người.
    const mixed = snap({
      phase: "ELIMINATION",
      lastNightDeaths: [{ playerId: "p1", name: "Đêm" }],
      lastEliminated: { playerId: "p2", name: "Ngày" },
      players: [player("p1"), player("p2")],
    });
    assert.deepEqual(killSceneFor("EXECUTION", mixed)?.victims.map((v) => v.name), ["Ngày"]);
    assert.deepEqual(killSceneFor("NIGHT_KILL", mixed)?.victims.map((v) => v.name), ["Đêm"]);
  });
});

describe("killSceneFor: không rò rỉ gì ngoài định danh công khai", () => {
  it("model hiển thị chỉ có ba trường công khai của nạn nhân", () => {
    const view = killSceneFor(
      "NIGHT_KILL",
      snap({
        lastNightDeaths: [{ playerId: "p1", name: "An" }],
        // Snapshot của một con Sói THẤY role đồng bọn; model hiển thị không
        // được mang nó theo chỉ vì nó tình cờ nằm trong players[].
        players: [player("p1", { name: "An", role: "WEREWOLF" })],
      }),
    );
    assert.deepEqual(Object.keys(view!.victims[0]).sort(), [
      "avatarUrl",
      "name",
      "playerId",
    ]);
  });
});

describe("chữ trên cảnh kill", () => {
  it("cảnh đêm không nói nguyên nhân, dù chỉ là một mệnh đề", () => {
    const view = killSceneFor("NIGHT_KILL", nightOf(1))!;
    const text = `${killEyebrow(view)} ${killTitle(view)} ${killAnnouncement(view)}`;
    for (const cause of ["wolf", "poison", "priest", "serial_killer", "hunter"] as const) {
      assert.equal(text.includes(deathCauseClause(cause)), false, cause);
    }
    // Và tuyệt đối không có chữ nào gọi tên một vai.
    for (const word of ["Sói", "Sát Nhân", "Phù Thuỷ", "Phù Thủy", "Thợ Săn", "Linh Mục"]) {
      assert.equal(text.includes(word), false, word);
    }
  });

  it("một người chết thì không có con số; nhiều người thì con số đứng đầu dòng", () => {
    // Tên nằm dưới từng khuôn mặt chứ không nằm trong dòng chữ lớn, nên "một
    // người không qua khỏi đêm nay" là một con số thừa - và ở một trò chơi mà
    // cả ván xoay quanh việc đếm, một con số thừa là một con số bị đọc nhầm.
    assert.equal(killTitle(killSceneFor("NIGHT_KILL", nightOf(1))!), "Không qua khỏi đêm nay");
    assert.match(killTitle(killSceneFor("NIGHT_KILL", nightOf(3))!), /^3 người/);
  });

  it("câu cho trình đọc màn hình luôn gọi đủ tên những người lên hình", () => {
    const view = killSceneFor("NIGHT_KILL", nightOf(3))!;
    const said = killAnnouncement(view);
    for (const victim of view.victims) assert.ok(said.includes(victim.name), victim.name);
  });

  it("người không lên hình vẫn được đếm bằng lời, không biến mất", () => {
    const said = killAnnouncement(killSceneFor("NIGHT_KILL", nightOf(5))!);
    assert.ok(said.includes("5"), said);
    assert.ok(said.includes("2 người nữa"), said);
  });

  it("cảnh treo nói đúng chuyện công khai vừa xảy ra", () => {
    const view = killSceneFor(
      "EXECUTION",
      snap({ lastEliminated: { playerId: "p9", name: "Bị Cáo" }, players: [player("p9")] }),
    )!;
    assert.match(killTitle(view), /treo cổ/);
    assert.ok(killAnnouncement(view).includes("Bị Cáo"));
  });

  it("cảnh treo KHÔNG nói gì về vai trò người vừa bị treo", () => {
    const view = killSceneFor(
      "EXECUTION",
      snap({ lastEliminated: { playerId: "p9", name: "Bị Cáo" }, players: [player("p9")] }),
    )!;
    const text = `${killEyebrow(view)} ${killTitle(view)} ${killAnnouncement(view)}`;
    for (const word of ["Sói", "Dân Làng", "vai trò", "Thằng Hề"]) {
      assert.equal(text.includes(word), false, word);
    }
  });
});
