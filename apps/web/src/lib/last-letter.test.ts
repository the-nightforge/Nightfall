import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROOM_CONFIG, LAST_LETTER_MAX_LENGTH } from "@masoi/shared";
import type { CaseFile, OpenedLastLetter, RoomSnapshot } from "@masoi/shared";
import {
  EMPTY_REVEAL_STATE,
  caseFileLetters,
  composerIntent,
  composerState,
  counterState,
  dismissReveal,
  isConfirmed,
  lastLetterToggle,
  nextReveal,
  observeSnapshot,
  pendingRevealCount,
  revealCard,
  revealMotion,
} from "./last-letter";

/**
 * Logic phía web của Phong thư sau cùng.
 *
 * Test của web chạy bằng `node:test` và không có DOM, nên mọi quyết định đáng
 * khẳng định đều nằm trong module thuần này chứ không trong component. Điều đó
 * cũng đúng về mặt thiết kế: component chỉ được VẼ, không được quyết ai thấy gì.
 */

function snapshot(patch: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "host",
    phase: "DAY_DISCUSSION",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 2,
    phaseEndsAt: null,
    serverNow: 0,
    you: { id: "me", name: "Tôi", ready: true, connected: true, alive: true },
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

function letter(patch: Partial<OpenedLastLetter> = {}): OpenedLastLetter {
  return {
    id: "last-letter:p1",
    authorId: "p1",
    authorName: "An",
    text: "Hãy để mắt tới Bình",
    sealedRound: 2,
    openedRound: 3,
    openedAt: 1_000,
    ...patch,
  };
}

describe("công tắc trong phòng chờ", () => {
  it("chủ phòng gạt được", () => {
    const state = lastLetterToggle(
      snapshot({ phase: "LOBBY", hostId: "me", config: { ...DEFAULT_ROOM_CONFIG, lastLetter: true } }),
      "me",
    );
    assert.deepEqual(state, { on: true, canToggle: true });
  });

  it("người khác THẤY trạng thái nhưng không gạt được", () => {
    const state = lastLetterToggle(
      snapshot({ phase: "LOBBY", hostId: "host", config: { ...DEFAULT_ROOM_CONFIG, lastLetter: true } }),
      "me",
    );
    assert.deepEqual(state, { on: true, canToggle: false });
  });

  it("mặc định tắt", () => {
    assert.equal(lastLetterToggle(snapshot({ phase: "LOBBY", hostId: "me" }), "me").on, false);
  });

  it("trận đã bắt đầu thì chủ phòng cũng không đổi được", () => {
    for (const phase of ["NIGHT", "DAY_DISCUSSION", "GAME_OVER"] as const) {
      const state = lastLetterToggle(snapshot({ phase, hostId: "me" }), "me");
      assert.equal(state.canToggle, false, `phase ${phase}`);
    }
  });

  it("chưa có snapshot thì không gạt được gì", () => {
    assert.deepEqual(lastLetterToggle(null, "me"), { on: false, canToggle: false });
  });
});

describe("ô soạn thư chỉ hiện đúng lúc", () => {
  const withView = (patch: Partial<RoomSnapshot["lastLetter"] & object>) =>
    snapshot({
      lastLetter: {
        enabled: true,
        mine: { text: null, updatedRound: null, canEdit: true },
        opened: [],
        ...patch,
      } as RoomSnapshot["lastLetter"],
    });

  it("hiện khi server nói được sửa", () => {
    assert.equal(composerState(withView({})).visible, true);
  });

  it("không hiện khi add-on tắt - server gửi null", () => {
    assert.equal(composerState(snapshot({ lastLetter: null })).visible, false);
  });

  it("không hiện khi server nói không được sửa", () => {
    const state = composerState(
      withView({ mine: { text: null, updatedRound: null, canEdit: false } }),
    );
    assert.equal(state.visible, false);
  });

  it("không hiện với server cũ chưa có trường này", () => {
    assert.equal(composerState(snapshot()).visible, false);
  });

  it("chưa có snapshot thì không hiện", () => {
    assert.deepEqual(composerState(null), { visible: false, saved: null, sealedRound: null });
  });

  it("mang theo bản server đang giữ và vòng niêm phong", () => {
    const state = composerState(
      withView({ mine: { text: "đã lưu", updatedRound: 3, canEdit: true } }),
    );
    assert.equal(state.saved, "đã lưu");
    assert.equal(state.sealedRound, 3);
  });
});

describe("bộ đếm", () => {
  it("đếm trên nội dung đã trim", () => {
    assert.equal(counterState("  abc  ").used, 3);
    assert.equal(counterState("  abc  ").label, `3/${LAST_LETTER_MAX_LENGTH}`);
  });

  it("đúng trần thì chưa vượt", () => {
    const state = counterState("a".repeat(LAST_LETTER_MAX_LENGTH));
    assert.equal(state.over, false);
  });

  it("quá trần thì báo vượt", () => {
    assert.equal(counterState("a".repeat(LAST_LETTER_MAX_LENGTH + 1)).over, true);
  });

  it("khoảng trắng thừa không đẩy bộ đếm vượt trần", () => {
    const padded = `   ${"a".repeat(LAST_LETTER_MAX_LENGTH)}   `;
    assert.equal(counterState(padded).over, false);
  });
});

describe("bấm Niêm phong gửi cái gì", () => {
  it("lưu bản đã trim", () => {
    const action = composerIntent({ draft: "  nội dung  ", saved: null, pending: false });
    assert.deepEqual(action, { kind: "save", text: "nội dung" });
  });

  it("sửa thư là một lần lưu mới", () => {
    const action = composerIntent({ draft: "bản mới", saved: "bản cũ", pending: false });
    assert.deepEqual(action, { kind: "save", text: "bản mới" });
  });

  it("xoá hết chữ khi ĐANG có thư là lệnh xoá", () => {
    assert.deepEqual(composerIntent({ draft: "   ", saved: "bản cũ", pending: false }), {
      kind: "clear",
    });
  });

  it("ô trống khi chưa có thư thì không gửi gì", () => {
    assert.deepEqual(composerIntent({ draft: "", saved: null, pending: false }), { kind: "idle" });
  });

  it("nội dung y hệt bản đang có thì không gửi lại", () => {
    assert.deepEqual(composerIntent({ draft: " giống hệt ", saved: "giống hệt", pending: false }), {
      kind: "idle",
    });
  });

  it("đang chờ xác nhận thì CHẶN gửi lặp", () => {
    assert.deepEqual(composerIntent({ draft: "bấm nhanh", saved: null, pending: true }), {
      kind: "idle",
    });
  });

  it("vượt trần thì không gửi", () => {
    const draft = "a".repeat(LAST_LETTER_MAX_LENGTH + 1);
    assert.deepEqual(composerIntent({ draft, saved: null, pending: false }), { kind: "idle" });
  });
});

describe("chỉ snapshot mới xác nhận được", () => {
  it("chưa khớp thì vẫn là đang chờ - không giả lập lưu thành công", () => {
    assert.equal(isConfirmed({ kind: "save", text: "mới" }, null), false);
    assert.equal(isConfirmed({ kind: "save", text: "mới" }, "cũ"), false);
  });

  it("snapshot mang đúng nội dung vừa gửi thì hết chờ", () => {
    assert.equal(isConfirmed({ kind: "save", text: "mới" }, "mới"), true);
  });

  it("lệnh xoá chỉ xong khi server thật sự không còn giữ gì", () => {
    assert.equal(isConfirmed({ kind: "clear" }, "còn đây"), false);
    assert.equal(isConfirmed({ kind: "clear" }, null), true);
  });
});

describe("hàng đợi mở thư", () => {
  const l1 = letter({ id: "l1", authorId: "p1", authorName: "An" });
  const l2 = letter({ id: "l2", authorId: "p2", authorName: "Bình" });
  const l3 = letter({ id: "l3", authorId: "p3", authorName: "Cường" });

  const withOpened = (opened: OpenedLastLetter[], patch: Partial<RoomSnapshot> = {}) =>
    snapshot({
      lastLetter: {
        enabled: true,
        mine: { text: null, updatedRound: null, canEdit: false },
        opened,
      },
      ...patch,
    });

  /** Nhận lần lượt một dãy snapshot, đúng như component làm trong một phiên. */
  const observeAll = (...snapshots: Array<RoomSnapshot | null>) =>
    snapshots.reduce(observeSnapshot, EMPTY_REVEAL_STATE);

  /**
   * BASELINE là toàn bộ ý nghĩa của bài này.
   *
   * Một người bấm F5 giữa trận nhận ngay một snapshot mang đủ thư đã mở từ đầu
   * ván. Không có baseline thì cả xâu thư đó được trình chiếu lại lần nữa - và
   * "mỗi thư chỉ mở một lần" thành ra chỉ đúng với người không bao giờ tải lại
   * trang.
   */
  it("snapshot ĐẦU TIÊN chỉ làm mốc: không thư nào được trình chiếu", () => {
    const first = withOpened([l1, l2, l3]);
    const state = observeAll(first);

    assert.equal(nextReveal(state, first), null);
    assert.equal(pendingRevealCount(state, first), 0);
  });

  it("sau baseline, thư MỚI xuất hiện thì trình chiếu đúng thư đó", () => {
    const first = withOpened([l1, l2]);
    const second = withOpened([l1, l2, l3]);
    const state = observeAll(first, second);

    assert.equal(nextReveal(state, second)!.id, "l3");
    assert.equal(pendingRevealCount(state, second), 0);
  });

  it("nhiều thư mới cùng lúc vẫn xếp hàng theo thứ tự server gửi", () => {
    const first = withOpened([l1]);
    const second = withOpened([l1, l2, l3]);
    const state = observeAll(first, second);

    assert.equal(nextReveal(state, second)!.id, "l2");
    assert.equal(pendingRevealCount(state, second), 1);

    const afterFirst = dismissReveal(state, "l2");
    assert.equal(nextReveal(afterFirst, second)!.id, "l3");
    assert.equal(pendingRevealCount(afterFirst, second), 0);

    const afterAll = dismissReveal(afterFirst, "l3");
    assert.equal(nextReveal(afterAll, second), null);
  });

  it("thư đã đóng không quay lại khi nhận lại cùng snapshot", () => {
    const first = withOpened([]);
    const second = withOpened([l1]);
    const dismissed = dismissReveal(observeAll(first, second), "l1");

    // Snapshot lặp lại là chuyện thường: mỗi thao tác của bất kỳ ai trong phòng
    // đều đẩy một snapshot mới với cùng danh sách thư.
    const again = observeSnapshot(dismissed, second);
    assert.equal(nextReveal(again, second), null);
  });

  it("baseline chỉ lấy từ snapshot THẬT, không phải từ lúc chưa có gì", () => {
    const first = withOpened([l1]);
    // Trước khi socket kịp trả snapshot đầu tiên, component render với null.
    const state = observeAll(null, first);
    assert.equal(nextReveal(state, first), null, "l1 thuộc snapshot đầu tiên nên là thư cũ");

    const second = withOpened([l1, l2]);
    assert.equal(nextReveal(observeSnapshot(state, second), second)!.id, "l2");
  });

  it("về LOBBY rồi vào ván mới thì thư của ván mới VẪN hiện", () => {
    const old = withOpened([l1, l2]);
    const played = dismissReveal(observeAll(withOpened([]), old), "l1");

    const lobby = snapshot({ phase: "LOBBY" });
    const fresh = withOpened([], { phase: "ROLE_REVEAL" });
    const newLetter = withOpened([l3]);

    const afterReset = [lobby, fresh, newLetter].reduce(observeSnapshot, played);
    assert.equal(nextReveal(afterReset, newLetter)!.id, "l3");
  });

  it("id trùng lại ở ván mới vẫn hiện - danh sách đã đóng bị dọn ở LOBBY", () => {
    // Id thư ổn định theo playerId, nên cùng một người chết ở hai ván liên tiếp
    // sẽ cho ra cùng id. Không dọn thì lá thư của ván MỚI bị nuốt mất.
    const opened = withOpened([l1]);
    const played = dismissReveal(observeAll(withOpened([]), opened), "l1");

    const afterReset = [snapshot({ phase: "LOBBY" }), withOpened([], { phase: "NIGHT" }), opened]
      .reduce(observeSnapshot, played);
    assert.equal(nextReveal(afterReset, opened)!.id, "l1");
  });

  it("không có thư nào thì im lặng", () => {
    const empty = snapshot();
    assert.equal(nextReveal(observeAll(empty), empty), null);
    assert.equal(pendingRevealCount(EMPTY_REVEAL_STATE, null), 0);
  });

  /**
   * Ở màn kết thúc, mục "Những phong thư đã mở" đã liệt kê trọn vẹn. Một thẻ
   * hàng đợi ở đó là bản thứ hai của cùng nội dung, chen ngay giữa thẻ hero và
   * bảng vai trò.
   */
  it("không xếp hàng nữa ở GAME_OVER", () => {
    const during = withOpened([]);
    const done = withOpened([l1, l2, l3], { phase: "GAME_OVER" });
    const state = observeAll(during, done);

    assert.equal(nextReveal(state, done), null);
    assert.equal(pendingRevealCount(state, done), 0);
  });
});

describe("thẻ mở thư", () => {
  it("đủ ba dòng: tên, nội dung, vòng niêm phong", () => {
    const card = revealCard(letter({ authorName: "An", text: "Bình rất lạ", sealedRound: 2 }));
    assert.equal(card.title, "Phong thư sau cùng của An");
    assert.equal(card.text, "Bình rất lạ");
    assert.equal(card.sealedLabel, "Được niêm phong ở vòng 2");
  });

  /**
   * Vai không nằm trong `OpenedLastLetter` ngay từ kiểu dữ liệu, nên bài này
   * khẳng định một điều mạnh hơn "component quên vẽ vai": không có gì để vẽ.
   */
  it("không có chỗ nào cho vai trò", () => {
    const card = revealCard(letter());
    assert.deepEqual(Object.keys(card).sort(), ["id", "sealedLabel", "text", "title"]);
    assert.equal(JSON.stringify(card).includes("role"), false);
  });
});

describe("giảm chuyển động", () => {
  it("bật giảm chuyển động là tắt hẳn, không phải làm chậm", () => {
    const motion = revealMotion(true);
    assert.equal(motion.transition.duration, 0);
    assert.deepEqual(motion.initial, { opacity: 1, y: 0 });
    assert.deepEqual(motion.exit, { opacity: 1, y: 0 });
  });

  it("bình thường thì có trượt và mờ dần", () => {
    const motion = revealMotion(false);
    assert.ok(motion.transition.duration > 0);
    assert.equal(motion.initial.opacity, 0);
  });
});

describe("hồ sơ vụ án", () => {
  const base: CaseFile = {
    version: 1,
    caseId: "HS-ABCDE",
    winner: "village",
    rounds: 3,
    cast: [],
    highlights: [],
    timeline: [],
    fallback: false,
  };

  it("đọc được các lá thư đã mở", () => {
    const file: CaseFile = {
      ...base,
      lastLetters: [
        { authorId: "p1", authorName: "An", text: "lời cuối", sealedRound: 2, openedRound: 3 },
      ],
    };
    assert.equal(caseFileLetters(file).length, 1);
    assert.equal(caseFileLetters(file)[0].authorName, "An");
  });

  it("hồ sơ CŨ không có trường này vẫn đọc bình thường", () => {
    assert.deepEqual(caseFileLetters(base), []);
  });

  it("hồ sơ méo mó không làm vỡ trang", () => {
    const broken = { ...base, lastLetters: "không phải mảng" } as unknown as CaseFile;
    assert.deepEqual(caseFileLetters(broken), []);

    const partial = { ...base, lastLetters: [{ text: 12 }] } as unknown as CaseFile;
    assert.deepEqual(caseFileLetters(partial), []);
  });

  it("không có hồ sơ thì rỗng", () => {
    assert.deepEqual(caseFileLetters(null), []);
  });
});
