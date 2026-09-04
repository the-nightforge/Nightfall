import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROOM_CONFIG, type PlayerView, type RoomSnapshot } from "@masoi/shared";
import { assignAvatars } from "./avatar";
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
    // Và vẫn phải có một khuôn mặt mặc định chứ không phải undefined: chỗ gọi
    // đưa thẳng giá trị này vào `CharacterPortrait`.
    assert.equal(typeof view?.victims[0].avatar, "string");
    assert.ok((view?.victims[0].avatar.length ?? 0) > 0);
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

  it("giữ riêng danh sách ĐỦ tên, không bị cắt theo số chân dung", () => {
    /*
     * `victims` là thứ LÊN HÌNH và nó bị trần màn hình chặn ở ba. Nhưng bản
     * tường thuật cho trình đọc màn hình thì không có màn hình nào để mà chật,
     * nên nó cần một nguồn riêng - nếu không, người thứ tư trở đi biến mất khỏi
     * mọi đường tiếp cận, chứ không chỉ khỏi hàng ảnh.
     */
    const view = killSceneFor("NIGHT_KILL", nightOf(5));
    assert.equal(view?.allVictimNames.length, 5);
    assert.deepEqual(view?.allVictimNames, [
      "Người p1",
      "Người p2",
      "Người p3",
      "Người p4",
      "Người p5",
    ]);
  });

  it("danh sách đủ tên chỉ có TÊN, không kèm gì khác", () => {
    const view = killSceneFor("NIGHT_KILL", nightOf(4));
    for (const name of view!.allVictimNames) assert.equal(typeof name, "string");
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
      {
        playerId: "p9",
        name: "Bị Cáo",
        avatar: assignAvatars(["p9"]).p9,
        avatarUrl: "https://cdn/b.png",
      },
    ]);
    assert.deepEqual(view?.allVictimNames, ["Bị Cáo"]);
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
  it("model hiển thị chỉ có bốn trường công khai của nạn nhân", () => {
    const view = killSceneFor(
      "NIGHT_KILL",
      snap({
        lastNightDeaths: [{ playerId: "p1", name: "An" }],
        // Snapshot của một con Sói THẤY role đồng bọn; model hiển thị không
        // được mang nó theo chỉ vì nó tình cờ nằm trong players[].
        players: [player("p1", { name: "An", role: "WEREWOLF" })],
      }),
    );
    /*
     * `avatar` là trường thứ tư và nó KHÔNG phải một ngoại lệ của luật này:
     * `assignAvatars` chỉ nhận vào tập playerId - thứ mà mọi client đều thấy -
     * và cố ý không dính dáng gì tới vai trò. Xem `lib/avatar.ts`.
     */
    assert.deepEqual(Object.keys(view!.victims[0]).sort(), [
      "avatar",
      "avatarUrl",
      "name",
      "playerId",
    ]);
  });
});

/**
 * Khuôn mặt mặc định phải là khuôn mặt người chơi vẫn thấy trên bàn.
 *
 * `assignAvatars` không phải một hàm băm đơn giản: nó dò chỗ trống để không ai
 * trùng ai, nên kết quả cho một id phụ thuộc vào CẢ TẬP id đưa vào. Tính bảng
 * từ riêng danh sách nạn nhân là tính một bảng khác - và một người vừa chết
 * hiện lên với khuôn mặt lạ ở đúng cái cảnh sinh ra để nói "người này là ai".
 */
describe("killSceneFor: khuôn mặt mặc định khớp với bàn chơi", () => {
  /** Đúng cách `PlayerGrid` và `TrialStage` tính bảng: từ TOÀN BỘ players[]. */
  const roster = Array.from({ length: 20 }, (_, i) => `p${i + 1}`);
  const table = assignAvatars(roster);

  function roomOf(deadIds: string[]): RoomSnapshot {
    return snap({
      phase: "NIGHT_RESULT",
      lastNightDeaths: deadIds.map((id) => ({ playerId: id, name: `Người ${id}` })),
      players: roster.map((id) => player(id, { name: `Người ${id}` })),
    });
  }

  it("p4 trên bàn là `bandit`, và trong cảnh kill cũng phải là `bandit`", () => {
    // Ca va chạm CỤ THỂ đã tái hiện được: tính riêng một mình `p4` ra `cultist`.
    assert.equal(table.p4, "bandit");
    assert.equal(assignAvatars(["p4"]).p4, "cultist");

    const view = killSceneFor("NIGHT_KILL", roomOf(["p4"]));
    assert.equal(view?.victims[0].avatar, "bandit");
  });

  it("mọi id trong phòng 20 người đều khớp bảng của bàn chơi", () => {
    // Sáu trong hai mươi id đổi mặt khi tính riêng, nên quét cả roster chứ
    // không chỉ khẳng định đúng một ca.
    for (const id of roster) {
      const view = killSceneFor("NIGHT_KILL", roomOf([id]));
      assert.equal(view?.victims[0].avatar, table[id], id);
    }
  });

  it("khớp cả khi chết nhiều người cùng lúc", () => {
    const dead = ["p4", "p7", "p9"];
    const view = killSceneFor("NIGHT_KILL", roomOf(dead));
    assert.deepEqual(
      view?.victims.map((v) => v.avatar),
      dead.map((id) => table[id]),
    );
  });

  it("người bị treo cũng lấy mặt từ bàn, không phải từ một mình họ", () => {
    const room = snap({
      phase: "ELIMINATION",
      lastEliminated: { playerId: "p9", name: "Người p9" },
      players: roster.map((id) => player(id, { name: `Người ${id}` })),
    });
    assert.notEqual(table.p9, assignAvatars(["p9"]).p9);
    assert.equal(killSceneFor("EXECUTION", room)?.victims[0].avatar, table.p9);
  });

  it("ảnh tự tải lên vẫn được ưu tiên, và mặt mặc định vẫn được chốt sẵn", () => {
    const room = snap({
      phase: "NIGHT_RESULT",
      lastNightDeaths: [{ playerId: "p4", name: "Người p4" }],
      players: roster.map((id) =>
        player(id, { name: `Người ${id}`, avatarUrl: id === "p4" ? "https://cdn/x.png" : null }),
      ),
    });
    const victim = killSceneFor("NIGHT_KILL", room)!.victims[0];
    assert.equal(victim.avatarUrl, "https://cdn/x.png");
    // Mặt mặc định vẫn đúng bảng: nó là đường lui khi ảnh custom hỏng.
    assert.equal(victim.avatar, table.p4);
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

  it("năm người chết thì đọc đủ NĂM tên, không phải ba tên và một con số", () => {
    /*
     * Đây là hồi quy của một lỗi thật: bản đầu duyệt `victims`, vốn đã bị cắt
     * còn ba, rồi bù bằng "và 2 người nữa". Người dùng trình đọc màn hình vì
     * thế không có đường nào biết hai người còn lại là ai - trong khi mọi người
     * khác chỉ cần nhìn xuống thẻ pha ngay bên dưới là đọc được đủ tên.
     */
    const view = killSceneFor("NIGHT_KILL", nightOf(5))!;
    const said = killAnnouncement(view);
    assert.equal(view.victims.length, MAX_KILL_PORTRAITS);
    for (const name of view.allVictimNames) assert.ok(said.includes(name), `${name} | ${said}`);
    assert.ok(said.includes("5"), said);
    // Và không còn cái vế đếm trống rỗng của bản cũ.
    assert.equal(said.includes("người nữa"), false, said);
  });

  it("tám người chết trong một đêm vẫn đọc đủ tám tên", () => {
    const view = killSceneFor("NIGHT_KILL", nightOf(8))!;
    const said = killAnnouncement(view);
    assert.equal(view.allVictimNames.length, 8);
    for (const name of view.allVictimNames) assert.ok(said.includes(name), `${name} | ${said}`);
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
