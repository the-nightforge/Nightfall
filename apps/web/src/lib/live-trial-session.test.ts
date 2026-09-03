import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RoomSnapshot, TrialView } from "@masoi/shared";
import {
  EMPTY_LIVE_TRIAL_SESSION,
  advanceLiveTrial,
  consumeLiveTrialBeats,
  pendingBeats,
  type LiveTrialSession,
} from "./live-trial";

/**
 * Bộ test VÒNG ĐỜI, không phải bộ test phép tính.
 *
 * Hai lỗi nặng nhất của "Phiên toà sống" đều lọt qua bộ test hàm thuần cũ, vì
 * cả hai chỉ hiện ra ở CHUỖI lời gọi mà React tạo ra chứ không ở một lời gọi
 * đơn lẻ:
 *
 *   A. Effect của hook chạy lần đầu lúc socket còn đang bắt tay, `snapshot` khi
 *      ấy là `null`. Bản cũ coi đó là một trạng thái thật và bật `booted`, nên
 *      snapshot THẬT đầu tiên - dù là một phiên toà đã diễn từ trước khi người
 *      chơi mở tab - lại lĩnh trọn màn mở đầu.
 *   B. Một lô nhịp diễn nằm lại trong state của hook sau khi phát xong. Tắt rồi
 *      bật sân khấu, hay chỉ cần xoay ngang điện thoại rồi xoay lại, là canvas
 *      dựng lại và nhận LẠI đúng lô đó.
 *
 * `node:test` không có DOM nên không mount được React. Cách chữa là dồn toàn bộ
 * quyết định vòng đời xuống `advanceLiveTrial`/`consumeLiveTrialBeats` - hai
 * hàm thuần - rồi ở đây mô phỏng đúng chuỗi mà hook tạo ra: mount, snapshot
 * tới, gạt công tắc, sân khấu dựng lại, rớt mạng rồi nối lại.
 *
 * Phần React còn lại (`useLiveTrial`) mỏng tới mức chỉ còn ba việc: gọi
 * `advanceLiveTrial` trong một effect, cất kết quả vào state, và đưa
 * `consumeLiveTrialBeats` xuống cho sân khấu.
 */

type Player = RoomSnapshot["players"][number];

function trial(patch: Partial<TrialView> = {}): TrialView {
  return {
    accusedId: "acc",
    accusedName: "Bị Cáo",
    guiltyVotes: 0,
    innocentVotes: 0,
    guiltyRequired: 4,
    canVote: false,
    hasVoted: false,
    myVote: null,
    canSpeak: false,
    ...patch,
  };
}

const players: Player[] = [
  { id: "a", name: "A", alive: true, isBot: false },
  { id: "acc", name: "Bị Cáo", alive: true, isBot: false },
];

/** Mỗi lời gọi trả một OBJECT MỚI, đúng như một gói tin từ socket. */
function snapshot(patch: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    phase: "DAY_DISCUSSION",
    round: 1,
    players,
    dayVoteHistory: [{ round: 1 }],
    trial: null,
    lastTrial: null,
    ...patch,
  } as unknown as RoomSnapshot;
}

const defense = (patch: Partial<TrialView> = {}) =>
  snapshot({ phase: "DEFENSE", trial: trial(patch) });
const finalVote = (patch: Partial<TrialView> = {}) =>
  snapshot({ phase: "FINAL_VOTE", trial: trial(patch) });
const elimination = (lynched: boolean) =>
  snapshot({
    phase: "ELIMINATION",
    lastTrial: { accused: { id: "acc", name: "Bị Cáo" }, guilty: 4, innocent: 1, abstain: 0, lynched },
  });

/**
 * Bản mô phỏng của hook.
 *
 * `render()` là một lần effect chạy; `mountStage()` là một lần sân khấu được
 * dựng và nhận lô đang chờ - đúng việc mà `TrialStage` làm trong effect của nó.
 */
function harness(initial: Partial<{ connected: boolean }> = {}) {
  let session: LiveTrialSession = EMPTY_LIVE_TRIAL_SESSION;
  let connected = initial.connected ?? false;

  return {
    get session() {
      return session;
    },
    /** Một lần hook chạy với đúng hai đầu vào của nó. */
    render(snapshotValue: RoomSnapshot | null, patch: Partial<{ connected: boolean }> = {}) {
      if (patch.connected !== undefined) connected = patch.connected;
      session = advanceLiveTrial(session, { snapshot: snapshotValue, connected });
      return pendingBeats(session);
    },
    /** Sân khấu được dựng: nó lấy lô đang chờ rồi báo đã nhận. */
    mountStage() {
      const taken = pendingBeats(session);
      session = consumeLiveTrialBeats(session, session.beatsId);
      return taken;
    },
    pending() {
      return pendingBeats(session);
    },
  };
}

// ---------------------------------------------------------------------------

describe("A. mount lúc chưa có snapshot", () => {
  it("effect đầu tiên với snapshot=null KHÔNG được coi là một trạng thái thật", () => {
    const app = harness();
    app.render(null);
    assert.equal(app.session.memory.booted, false, "chưa thấy trạng thái nào của ván");
    assert.deepEqual(app.pending(), []);
  });

  it("vào giữa pha biện hộ: snapshot thật đầu tiên chỉ dựng trạng thái", () => {
    const app = harness();
    // Đúng chuỗi của một lần mở tab: effect chạy trước khi socket trả lời.
    app.render(null);
    app.render(null, { connected: true });
    const beats = app.render(defense());

    assert.deepEqual(beats, [], "không có màn mở đầu cho một phiên đã diễn từ trước");
    assert.equal(app.session.view?.act, "DEFENSE");
  });

  it("vào giữa vòng xác nhận cũng chỉ dựng trạng thái, giữ nguyên số phiếu", () => {
    const app = harness();
    app.render(null);
    const beats = app.render(finalVote({ guiltyVotes: 3, innocentVotes: 2, hasVoted: true, myVote: false }));

    assert.deepEqual(beats, []);
    assert.equal(app.session.view?.guilty, 3);
    assert.equal(app.session.view?.hasVoted, true);
    assert.equal(app.session.view?.myVote, false, "myVote=false vẫn là phiếu Tha đã bỏ");
  });

  it("phiên toà mở ra TRƯỚC MẮT người chơi thì vẫn có màn mở đầu, đúng một lần", () => {
    const app = harness();
    app.render(null);
    app.render(snapshot({ phase: "VOTING" }), { connected: true });
    const beats = app.render(defense());

    assert.deepEqual(beats, [{ kind: "OPENING" }]);
    app.mountStage();
    assert.deepEqual(app.pending(), [], "đã có người nhận thì không còn chờ nữa");
  });
});

describe("B. dựng lại sân khấu", () => {
  it("dựng lại sân khấu mà chưa có snapshot mới thì KHÔNG phát lại lô cũ", () => {
    const app = harness();
    app.render(null);
    app.render(snapshot({ phase: "VOTING" }), { connected: true });
    assert.deepEqual(app.render(defense()), [{ kind: "OPENING" }]);
    app.mountStage();

    // Hook chạy thêm vài lượt trên đúng snapshot đó - chuyện xảy ra suốt, vì
    // trang render lại vì nhiều lý do khác ngoài "có snapshot mới".
    app.render(app.session.lastSnapshot);
    app.render(app.session.lastSnapshot);
    assert.deepEqual(app.mountStage(), [], "màn mở đầu đã tiêu thụ, không được diễn lần hai");
  });

  it("xoay ngang rồi xoay lại (sân khấu dựng lại) cũng không phát lại", () => {
    const app = harness();
    app.render(null);
    app.render(snapshot({ phase: "VOTING" }), { connected: true });
    app.render(defense());
    app.mountStage();
    // Màn hình thấp thì sân khấu rơi về bản 2D và canvas bị THÁO; xoay dọc lại
    // là một lần dựng mới.
    assert.deepEqual(app.mountStage(), []);
    assert.deepEqual(app.mountStage(), []);
  });

  it("dựng lại giữa phiên không làm mất phiếu, quyền bỏ phiếu hay lá phiếu của mình", () => {
    const app = harness();
    app.render(null);
    app.render(snapshot({ phase: "VOTING" }), { connected: true });
    app.render(finalVote({ guiltyVotes: 3, innocentVotes: 1, hasVoted: true, myVote: false, canVote: false }));

    const before = app.session.view;
    app.render(app.session.lastSnapshot);
    app.render(app.session.lastSnapshot);

    assert.deepEqual(app.session.view, before, "trạng thái sân khấu không đổi vì một lần render thừa");
  });

  it("render thừa xong mới có phiếu mới thì lô mới VẪN được phát", () => {
    const app = harness();
    app.render(null);
    app.render(snapshot({ phase: "VOTING" }), { connected: true });
    app.render(finalVote({ guiltyVotes: 1 }));
    app.render(finalVote({ guiltyVotes: 1 }));

    const beats = app.render(finalVote({ guiltyVotes: 2 }));
    assert.deepEqual(beats, [{ kind: "STAMP", side: "guilty" }]);
  });

  it("hook chạy lại mà không có snapshot mới thì không sinh hiệu ứng", () => {
    const app = harness();
    app.render(null);
    app.render(snapshot({ phase: "VOTING" }), { connected: true });
    app.render(defense());
    app.mountStage();

    const same = app.session.lastSnapshot;
    for (let i = 0; i < 5; i += 1) {
      assert.deepEqual(app.render(same), [], "cùng một snapshot không sinh thêm gì");
    }
  });

  it("nhận lô muộn một nhịp không nuốt mất lô mới", () => {
    const app = harness();
    app.render(null);
    app.render(snapshot({ phase: "VOTING" }), { connected: true });
    app.render(finalVote());
    app.render(finalVote({ guiltyVotes: 1 }));
    const staleId = app.session.beatsId - 1;

    // Sân khấu báo nhận một lô đã cũ: lô hiện tại phải còn nguyên.
    const after = consumeLiveTrialBeats(app.session, staleId);
    assert.deepEqual(pendingBeats(after), [{ kind: "STAMP", side: "guilty" }]);
  });
});

describe("mất kết nối rồi nối lại", () => {
  it("snapshot bù sau khi nối lại chỉ dựng trạng thái, không diễn", () => {
    const app = harness();
    app.render(null);
    app.render(snapshot({ phase: "VOTING" }), { connected: true });
    app.render(finalVote({ guiltyVotes: 1 }));
    app.mountStage();

    // Rớt mạng. Socket báo mất kết nối, snapshot đứng yên.
    app.render(app.session.lastSnapshot, { connected: false });
    // Nối lại: sự kiện connect tới TRƯỚC gói snapshot bù.
    app.render(app.session.lastSnapshot, { connected: true });
    // Gói bù nhảy vọt bốn phiếu - đó là dữ liệu bù, không phải chuyện vừa xảy ra.
    const beats = app.render(finalVote({ guiltyVotes: 4, innocentVotes: 1 }));

    assert.deepEqual(beats, []);
    assert.equal(app.session.view?.guilty, 4, "bảng số vẫn phải đúng ngay");
    assert.equal(app.session.view?.innocent, 1);
  });

  it("sau gói bù thì mọi thứ lại diễn bình thường", () => {
    const app = harness();
    app.render(null);
    app.render(snapshot({ phase: "VOTING" }), { connected: true });
    app.render(finalVote({ guiltyVotes: 1 }));
    app.render(app.session.lastSnapshot, { connected: false });
    app.render(app.session.lastSnapshot, { connected: true });
    app.render(finalVote({ guiltyVotes: 4 }));

    assert.deepEqual(app.render(finalVote({ guiltyVotes: 4, innocentVotes: 1 })), [
      { kind: "STAMP", side: "innocent" },
    ]);
  });

  it("phán quyết rơi đúng vào gói bù thì không diễn, nhưng vẫn hiện kết quả", () => {
    const app = harness();
    app.render(null);
    app.render(snapshot({ phase: "VOTING" }), { connected: true });
    app.render(defense());
    app.mountStage();
    app.render(finalVote({ guiltyVotes: 4 }));
    app.mountStage();

    app.render(app.session.lastSnapshot, { connected: false });
    app.render(app.session.lastSnapshot, { connected: true });
    const beats = app.render(elimination(true));

    assert.deepEqual(beats, [], "không diễn lại một bản án đã tuyên lúc mình đang mất mạng");
    assert.equal(app.session.view?.verdict, "LYNCHED", "nhưng kết quả vẫn phải đọc được");
  });

  it("lần nối đầu tiên của phiên KHÔNG bị coi là nối lại", () => {
    const app = harness();
    app.render(null);
    // false -> true ở đây là lần bắt tay đầu tiên, chưa từng có trạng thái nào.
    app.render(null, { connected: true });
    app.render(snapshot({ phase: "VOTING" }));
    assert.deepEqual(app.render(defense()), [{ kind: "OPENING" }]);
  });
});

describe("phiên toà kết thúc", () => {
  it("sang pha khác thì bỏ hẳn bị cáo và kết quả cũ khỏi màn hình", () => {
    const app = harness();
    app.render(null);
    app.render(snapshot({ phase: "VOTING" }), { connected: true });
    app.render(defense());
    app.render(snapshot({ phase: "HUNTER_SHOT" }));

    assert.equal(app.session.view, null);
    assert.deepEqual(app.pending(), []);
  });

  it("phiên sau vẫn có màn mở đầu riêng", () => {
    const app = harness();
    app.render(null);
    app.render(snapshot({ phase: "VOTING" }), { connected: true });
    app.render(defense());
    app.mountStage();
    app.render(finalVote({ guiltyVotes: 4 }));
    app.mountStage();
    app.render(elimination(true));
    app.mountStage();
    app.render(snapshot({ phase: "NIGHT", round: 2 }));

    const day2 = snapshot({
      phase: "DEFENSE",
      round: 2,
      dayVoteHistory: [{}, {}] as never,
      trial: trial(),
    });
    assert.deepEqual(app.render(day2), [{ kind: "OPENING" }]);
  });
});
