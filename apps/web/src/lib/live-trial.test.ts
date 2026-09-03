import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RoomSnapshot, TrialRecap, TrialView } from "@masoi/shared";
import {
  EMPTY_TRIAL_STAGE_MEMORY,
  actLabel,
  myVoteLabel,
  scaleTilt,
  stepTrialStage,
  tallyAnnouncement,
  trialKey,
  trialStageCandidate,
  trialStageInput,
  verdictLabel,
  type TrialStageMemory,
  type TrialStageView,
} from "./live-trial";

/*
 * Bộ test này chạy trên các HÀM THUẦN, và đó là chỗ mọi luật của "Phiên toà
 * sống" thật sự nằm. Phần Three.js có bộ test riêng (`live-trial-scene.test.ts`)
 * chạy trên một `THREE.Scene` thật; phần React chỉ còn việc nối hai bên lại.
 */

type Player = RoomSnapshot["players"][number];

function player(id: string): Player {
  return { id, name: id, alive: true, isBot: false };
}

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

function recap(patch: Partial<TrialRecap> = {}): TrialRecap {
  return {
    accused: { id: "acc", name: "Bị Cáo" },
    guilty: 0,
    innocent: 0,
    abstain: 0,
    lynched: false,
    ...patch,
  };
}

/** Một snapshot vừa đủ cho `trialStageCandidate`: pha, vòng, lịch sử, người chơi. */
function snapshot(patch: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    phase: "DEFENSE",
    round: 1,
    players: [player("a"), player("b"), player("acc")],
    dayVoteHistory: [{ round: 1 }],
    trial: null,
    lastTrial: null,
    ...patch,
  } as unknown as RoomSnapshot;
}

/** Chạy một chuỗi snapshot qua sân khấu, trả về từng bước để soi. */
function run(snapshots: Array<RoomSnapshot | null>, from = EMPTY_TRIAL_STAGE_MEMORY) {
  let memory: TrialStageMemory = from;
  return snapshots.map((item) => {
    const step = stepTrialStage(memory, trialStageInput(item));
    memory = step.memory;
    return step;
  });
}

const defense = (patch: Partial<TrialView> = {}) =>
  snapshot({ phase: "DEFENSE", trial: trial(patch) });
const finalVote = (patch: Partial<TrialView> = {}) =>
  snapshot({ phase: "FINAL_VOTE", trial: trial(patch) });
const elimination = (patch: Partial<TrialRecap> = {}) =>
  snapshot({ phase: "ELIMINATION", lastTrial: recap(patch) });

// ---------------------------------------------------------------------------

describe("trialStageCandidate", () => {
  it("chỉ dựng sân khấu ở DEFENSE, FINAL_VOTE và ELIMINATION", () => {
    for (const phase of ["VOTING", "DAY_DISCUSSION", "NIGHT", "CHECK_WIN", "GAME_OVER"] as const) {
      assert.equal(
        trialStageCandidate(snapshot({ phase, trial: trial(), lastTrial: recap() })),
        null,
        `${phase} không được có sân khấu`,
      );
    }
  });

  it("HUNTER_SHOT huỷ hẳn sân khấu: pha mới có thao tác riêng phải ưu tiên", () => {
    const steps = run([finalVote({ guiltyVotes: 4 }), snapshot({ phase: "HUNTER_SHOT" })]);
    assert.equal(steps[1].view, null);
  });

  it("đọc nguyên quyền nói và quyền bỏ phiếu từ server, không tự suy", () => {
    const view = trialStageCandidate(defense({ canSpeak: true, canVote: false }))!;
    assert.equal(view.canSpeak, true);
    assert.equal(view.canVote, false);

    const voting = trialStageCandidate(finalVote({ canSpeak: false, canVote: true }))!;
    assert.equal(voting.canSpeak, false);
    assert.equal(voting.canVote, true);
  });

  it("myVote === false là một phiếu Tha đã bỏ, không phải chưa bỏ", () => {
    const view = trialStageCandidate(finalVote({ hasVoted: true, myVote: false, canVote: false }))!;
    assert.equal(view.hasVoted, true);
    assert.equal(myVoteLabel(view), "Tha");
  });

  it("chưa bỏ phiếu thì không có nhãn nào", () => {
    const view = trialStageCandidate(finalVote({ hasVoted: false, myVote: null }))!;
    assert.equal(myVoteLabel(view), null);
  });

  it("ngưỡng kết án đọc từ guiltyRequired, không tự tính lại", () => {
    const view = trialStageCandidate(finalVote({ guiltyRequired: 7, guiltyVotes: 6 }))!;
    assert.equal(view.required, 7);
    assert.equal(view.thresholdReached, false);
  });

  it("phiếu có trọng số: chạm ngưỡng bằng đúng con số server gửi", () => {
    // Thị Trưởng bỏ Treo là +2 điểm chứ không phải hai người bỏ phiếu.
    const view = trialStageCandidate(finalVote({ guiltyRequired: 4, guiltyVotes: 4 }))!;
    assert.equal(view.thresholdReached, true);
    assert.equal(view.verdict, null, "chạm ngưỡng KHÔNG phải là đã có phán quyết");
  });

  it("pha đúng mà trial rỗng thì không dựng bị cáo rỗng", () => {
    assert.equal(trialStageCandidate(snapshot({ phase: "FINAL_VOTE", trial: null })), null);
  });

  it("ELIMINATION không có phiên toà nào (hoà phiếu) thì không có sân khấu", () => {
    assert.equal(trialStageCandidate(snapshot({ phase: "ELIMINATION", lastTrial: null })), null);
  });

  it("số khán giả lấy từ sĩ số phòng và không đổi theo phiếu", () => {
    const before = trialStageCandidate(finalVote({ guiltyVotes: 0 }))!;
    const after = trialStageCandidate(finalVote({ guiltyVotes: 3, innocentVotes: 2 }))!;
    assert.equal(before.audience, 3);
    assert.equal(after.audience, before.audience);
  });
});

describe("khoá phiên toà", () => {
  it("không dùng riêng accusedId: hai phiên khác nhau cùng một bị cáo là hai khoá", () => {
    const first = trialKey(snapshot({ round: 2, dayVoteHistory: [{}, {}] as never }), "acc");
    const second = trialKey(snapshot({ round: 2, dayVoteHistory: [{}, {}, {}] as never }), "acc");
    assert.notEqual(first, second);
  });

  it("giữ NGUYÊN suốt biện hộ → xác nhận → phán quyết của cùng một phiên", () => {
    const steps = run([defense(), finalVote(), elimination({ lynched: true })]);
    const keys = new Set(steps.map((step) => step.view?.key));
    assert.equal(keys.size, 1);
    assert.equal(steps[2].view?.act, "VERDICT");
  });
});

describe("chưa nhận snapshot KHÁC với pha không có phiên toà", () => {
  /*
   * Hai thứ này từng đi chung một nhánh, và đó là cả cái lỗi.
   *
   * Effect của hook chạy lần đầu lúc socket còn đang bắt tay: `snapshot` khi ấy
   * là `null`. Nhánh chung bật `booted = true`, nên snapshot THẬT đầu tiên - dù
   * là một phiên toà đã diễn từ trước khi người chơi mở tab - lại bị coi là một
   * cạnh mới và lĩnh trọn màn mở đầu.
   */
  it("NO_SNAPSHOT không đụng vào trí nhớ, đặc biệt là không bật booted", () => {
    const step = stepTrialStage(EMPTY_TRIAL_STAGE_MEMORY, { kind: "NO_SNAPSHOT" });
    assert.equal(step.memory.booted, false);
    assert.equal(step.memory, EMPTY_TRIAL_STAGE_MEMORY, "trí nhớ phải nguyên vẹn");
    assert.equal(step.view, null);
    assert.deepEqual(step.beats, []);
  });

  it("NO_TRIAL thì ngược lại: đó là một trạng thái thật, và nó bật booted", () => {
    const step = stepTrialStage(EMPTY_TRIAL_STAGE_MEMORY, { kind: "NO_TRIAL" });
    assert.equal(step.memory.booted, true);
    assert.equal(step.view, null);
  });

  it("null -> DEFENSE KHÔNG sinh màn mở đầu; VOTING -> DEFENSE thì có", () => {
    const view = trialStageCandidate(defense())!;

    // Đường của người mở tab đúng giữa pha biện hộ.
    const coldBoot = stepTrialStage(EMPTY_TRIAL_STAGE_MEMORY, { kind: "NO_SNAPSHOT" });
    const joined = stepTrialStage(coldBoot.memory, { kind: "TRIAL", view });
    assert.deepEqual(joined.beats, [], "phiên toà đã diễn từ trước khi họ tới");

    // Đường của người đã ngồi sẵn ở bàn.
    const watching = stepTrialStage(EMPTY_TRIAL_STAGE_MEMORY, { kind: "NO_TRIAL" });
    const opened = stepTrialStage(watching.memory, { kind: "TRIAL", view });
    assert.deepEqual(opened.beats, [{ kind: "OPENING" }]);
  });

  it("mọi snapshot null đều là NO_SNAPSHOT, mọi pha không có toà đều là NO_TRIAL", () => {
    assert.deepEqual(trialStageInput(null), { kind: "NO_SNAPSHOT" });
    assert.deepEqual(trialStageInput(snapshot({ phase: "NIGHT" })), { kind: "NO_TRIAL" });
    assert.equal(trialStageInput(defense()).kind, "TRIAL");
  });
});

describe("snapshot đầu, snapshot trùng và reconnect", () => {
  it("snapshot đầu tiên chỉ dựng trạng thái, không diễn màn mở đầu", () => {
    const [step] = run([defense()]);
    assert.deepEqual(step.beats, []);
    assert.equal(step.view?.act, "DEFENSE");
  });

  it("vào giữa vòng xác nhận không phát lại từng lá phiếu đã có", () => {
    const [step] = run([finalVote({ guiltyVotes: 5, innocentVotes: 3 })]);
    assert.deepEqual(step.beats, []);
    assert.equal(step.view?.guilty, 5);
    assert.equal(step.view?.innocent, 3);
  });

  it("cạnh VOTING → DEFENSE mới là màn mở đầu", () => {
    const steps = run([snapshot({ phase: "VOTING" }), defense()]);
    assert.deepEqual(steps[1].beats, [{ kind: "OPENING" }]);
  });

  it("bắt gặp phiên toà lần đầu ở vòng xác nhận thì không có màn mở đầu", () => {
    const steps = run([snapshot({ phase: "VOTING" }), finalVote({ guiltyVotes: 2 })]);
    assert.deepEqual(steps[1].beats, []);
  });

  it("snapshot trùng không phát lại hiệu ứng nào", () => {
    const same = finalVote({ guiltyVotes: 2 });
    const steps = run([snapshot({ phase: "VOTING" }), same, same, same]);
    assert.deepEqual(steps[2].beats, []);
    assert.deepEqual(steps[3].beats, []);
  });

  it("reconnect giữa ELIMINATION không tuyên lại một phán quyết chưa ai xem", () => {
    const [step] = run([elimination({ lynched: true })]);
    assert.deepEqual(step.beats, []);
    assert.equal(step.view, null, "chưa từng theo phiên này thì không dựng sân khấu");
  });

  it("phán quyết chỉ diễn ĐÚNG MỘT LẦN dù server đẩy lại snapshot", () => {
    const verdict = elimination({ lynched: true });
    const steps = run([defense(), finalVote(), verdict, verdict, verdict]);
    assert.deepEqual(steps[2].beats, [{ kind: "VERDICT", verdict: "LYNCHED" }]);
    assert.deepEqual(steps[3].beats, []);
    assert.deepEqual(steps[4].beats, []);
  });
});

describe("phiếu vào bảng đếm", () => {
  it("mỗi lần một bên tăng là ĐÚNG MỘT con dấu, kể cả phiếu trọng số x2", () => {
    const steps = run([
      snapshot({ phase: "VOTING" }),
      finalVote({ guiltyVotes: 0 }),
      // Thị Trưởng bỏ Treo: +2 điểm, nhưng vẫn chỉ một người bỏ phiếu.
      finalVote({ guiltyVotes: 2 }),
    ]);
    assert.deepEqual(steps[2].beats, [{ kind: "STAMP", side: "guilty" }]);
  });

  it("hai bên cùng tăng trong một snapshot thì mỗi bên một con dấu", () => {
    const steps = run([
      snapshot({ phase: "VOTING" }),
      finalVote(),
      finalVote({ guiltyVotes: 1, innocentVotes: 1 }),
    ]);
    assert.deepEqual(steps[2].beats, [
      { kind: "STAMP", side: "guilty" },
      { kind: "STAMP", side: "innocent" },
    ]);
  });

  it("nhiều snapshot dồn dập: mỗi bước chỉ mô tả chính bước đó, không dồn hàng đợi", () => {
    const steps = run([
      snapshot({ phase: "VOTING" }),
      finalVote(),
      finalVote({ guiltyVotes: 1 }),
      finalVote({ guiltyVotes: 2 }),
      finalVote({ guiltyVotes: 3 }),
    ]);
    for (const step of steps.slice(2)) assert.equal(step.beats.length, 1);
    assert.equal(steps.at(-1)!.view?.guilty, 3);
  });

  it("tổng phiếu GIẢM thì cập nhật đúng, không giả làm một phiếu mới", () => {
    // Có thật: một cử tri chết vì phát bắn của Thợ Săn giữa phiên toà.
    const steps = run([
      snapshot({ phase: "VOTING" }),
      finalVote({ guiltyVotes: 3, innocentVotes: 2 }),
      finalVote({ guiltyVotes: 2, innocentVotes: 2 }),
    ]);
    assert.deepEqual(steps[2].beats, []);
    assert.equal(steps[2].view?.guilty, 2);
  });

  it("ngưỡng đổi giữa phiên vẫn đọc từ server", () => {
    const steps = run([
      snapshot({ phase: "VOTING" }),
      finalVote({ guiltyRequired: 5 }),
      finalVote({ guiltyRequired: 4, guiltyVotes: 4 }),
    ]);
    assert.equal(steps[2].view?.required, 4);
    assert.equal(steps[2].view?.thresholdReached, true);
  });

  it("đạt ngưỡng nhưng chưa có kết quả thì KHÔNG có nhịp phán quyết nào", () => {
    const steps = run([
      snapshot({ phase: "VOTING" }),
      finalVote({ guiltyRequired: 3, guiltyVotes: 4 }),
    ]);
    assert.deepEqual(steps[1].beats, []);
    assert.equal(steps[1].view?.verdict, null);
  });
});

describe("hai phiên toà khác nhau", () => {
  it("phiên sau có trạng thái hiệu ứng riêng, kể cả khi cùng bị cáo", () => {
    const day2 = () =>
      snapshot({
        phase: "ELIMINATION",
        round: 4,
        dayVoteHistory: [{}, {}] as never,
        lastTrial: recap({ lynched: true }),
      });
    const steps = run([
      defense(),
      finalVote(),
      elimination({ lynched: false }),
      // Ngày sau, cùng một người bị đưa ra toà lần nữa.
      snapshot({ phase: "DEFENSE", round: 4, dayVoteHistory: [{}, {}] as never, trial: trial() }),
      snapshot({ phase: "FINAL_VOTE", round: 4, dayVoteHistory: [{}, {}] as never, trial: trial() }),
      day2(),
    ]);
    assert.deepEqual(steps[3].beats, [{ kind: "OPENING" }], "phiên mới có màn mở đầu riêng");
    assert.deepEqual(steps[5].beats, [{ kind: "VERDICT", verdict: "LYNCHED" }]);
  });

  it("phán quyết của một phiên KHÁC không được diễn trên sân khấu đang mở", () => {
    const steps = run([
      defense(),
      finalVote(),
      // Snapshot lạc: kết quả của một vòng khác hẳn.
      snapshot({
        phase: "ELIMINATION",
        round: 9,
        dayVoteHistory: [{}, {}, {}] as never,
        lastTrial: recap({ lynched: true }),
      }),
    ]);
    assert.equal(steps[2].view, null);
    assert.deepEqual(steps[2].beats, []);
  });
});

describe("tắt rồi bật lại giữa phiên", () => {
  it("bơm tiếp từ trạng thái đã nhớ thì không có hiệu ứng nào bị phát lại", () => {
    // Tắt tính năng không xoá trí nhớ: bên gọi vẫn bơm snapshot vào đây, chỉ
    // không vẽ. Bật lại giữa chừng vì thế là dựng thẳng trạng thái hiện tại.
    const steps = run([
      snapshot({ phase: "VOTING" }),
      defense(),
      finalVote({ guiltyVotes: 2 }),
      finalVote({ guiltyVotes: 2 }),
    ]);
    assert.deepEqual(steps[3].beats, []);
    assert.equal(steps[3].view?.guilty, 2);
  });

  it("phán quyết đã diễn thì bật lại không diễn thêm lần nữa", () => {
    const verdict = elimination({ lynched: false });
    const steps = run([defense(), finalVote(), verdict, verdict]);
    assert.deepEqual(steps[3].beats, []);
    assert.equal(steps[3].view?.verdict, "SPARED");
  });
});

describe("phán quyết", () => {
  it("giữ lại ngưỡng của phiên để giải thích vì sao đủ hay không đủ phiếu", () => {
    const steps = run([
      defense(),
      finalVote({ guiltyRequired: 6, guiltyVotes: 5 }),
      elimination({ guilty: 5, innocent: 4, lynched: false }),
    ]);
    assert.equal(steps[2].view?.required, 6);
    assert.equal(steps[2].view?.thresholdReached, false);
    assert.equal(steps[2].view?.verdict, "SPARED");
  });

  it("được tha KHÔNG nói gì về vai trò thật", () => {
    assert.equal(verdictLabel("SPARED"), "Phán quyết: Được tha");
    assert.match(verdictLabel("LYNCHED"), /Treo cổ/);
  });

  it("sân khấu chặng phán quyết không còn cho ai nói hay bỏ phiếu", () => {
    const steps = run([defense({ canSpeak: true }), finalVote({ canVote: true }), elimination()]);
    assert.equal(steps[2].view?.canSpeak, false);
    assert.equal(steps[2].view?.canVote, false);
  });
});

describe("cán cân", () => {
  it("chưa có phiếu nào thì cân bằng", () => {
    assert.equal(scaleTilt(0, 0), 0);
  });

  it("nghiêng theo TƯƠNG QUAN hai bên, không theo ngưỡng kết án", () => {
    assert.equal(scaleTilt(3, 0), 1);
    assert.equal(scaleTilt(0, 3), -1);
    assert.equal(scaleTilt(2, 2), 0);
    assert.ok(scaleTilt(3, 1) > 0 && scaleTilt(3, 1) < 1);
  });

  it("luôn nằm trong [-1, 1] kể cả với số liệu lạ", () => {
    for (const [g, i] of [[100, 0], [0, 100], [7, 3], [1, 9]]) {
      const tilt = scaleTilt(g, i);
      assert.ok(tilt >= -1 && tilt <= 1);
    }
  });
});

describe("thông báo cho trình đọc màn hình", () => {
  it("một câu cho cả bảng số, không phải một câu cho mỗi lá phiếu", () => {
    const view = trialStageCandidate(finalVote({ guiltyVotes: 3, innocentVotes: 1 }))!;
    assert.equal(tallyAnnouncement(view), "Treo 3, Tha 1. Cần 4 phiếu Treo để kết án.");
  });

  it("không rò rỉ gì ngoài những con số server đã gửi", () => {
    const view = trialStageCandidate({
      ...finalVote({ guiltyVotes: 2, innocentVotes: 2, hasVoted: true, myVote: true }),
      players: [
        { id: "v1", name: "Kẻ Bỏ Phiếu Một", alive: true, isBot: false },
        { id: "v2", name: "Kẻ Bỏ Phiếu Hai", alive: true, isBot: false },
      ],
    })!;
    const text = tallyAnnouncement(view);
    for (const name of ["Kẻ Bỏ Phiếu Một", "Kẻ Bỏ Phiếu Hai"]) {
      assert.ok(!text.includes(name), "không được nhắc tên người bỏ phiếu");
    }
    // Cũng không được nói lá phiếu của chính người xem ra loa: vùng aria-live
    // đọc lên cho cả phòng nghe nếu ai đó đang chia sẻ màn hình hay dùng loa.
    assert.ok(!text.includes("Treo cổ"));
  });

  it("nhãn chặng nói đúng pha đang diễn", () => {
    assert.equal(actLabel("DEFENSE"), "Đang biện hộ");
    assert.equal(actLabel("FINAL_VOTE"), "Bỏ phiếu xác nhận");
    assert.equal(actLabel("VERDICT"), "Phán quyết");
  });
});

describe("không rò rỉ thông tin riêng tư", () => {
  it("sân khấu không bao giờ chạm tới danh tính người bỏ phiếu xác nhận", () => {
    /*
     * `finalJudgment.ballots` CÓ danh tính, và ở pha ELIMINATION nó đã nằm sẵn
     * trong `dayVoteHistory` của snapshot. Đây là khẳng định rằng sân khấu không
     * đọc tới nó: đổi hẳn nội dung ballots mà mọi thứ nhìn thấy vẫn y nguyên.
     */
    const withBallots = snapshot({
      phase: "ELIMINATION",
      lastTrial: recap({ guilty: 3, innocent: 1, lynched: true }),
      dayVoteHistory: [
        {
          round: 1,
          finalJudgment: {
            ballots: [
              { voterId: "a", guilty: true },
              { voterId: "b", guilty: false },
            ],
            guilty: 3,
            innocent: 1,
            abstain: 0,
            lynched: true,
          },
        },
      ] as never,
    });
    const plain = snapshot({
      phase: "ELIMINATION",
      lastTrial: recap({ guilty: 3, innocent: 1, lynched: true }),
      dayVoteHistory: [{ round: 1, finalJudgment: null }] as never,
    });

    assert.deepEqual(trialStageCandidate(withBallots), trialStageCandidate(plain));
  });

  it("view chỉ mang đúng những trường công khai của phiên toà", () => {
    const view = trialStageCandidate(finalVote({ guiltyVotes: 1 }))!;
    assert.deepEqual(
      Object.keys(view).sort(),
      (
        [
          "key",
          "act",
          "accusedId",
          "accusedName",
          "guilty",
          "innocent",
          "required",
          "thresholdReached",
          "verdict",
          "canSpeak",
          "canVote",
          "hasVoted",
          "myVote",
          "audience",
        ] as Array<keyof TrialStageView>
      ).sort(),
    );
  });
});
