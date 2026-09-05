import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_PLAYERS_TO_START, ROLE_META, type RoomSnapshot } from "@masoi/shared";
import { GUIDE_DECK } from "./guide-prep";
import { guideStepFor } from "./guide-steps";
import { roleGoal } from "./role-goal";

function snapshot(over: Partial<RoomSnapshot>): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "me",
    phase: "LOBBY",
    config: {} as RoomSnapshot["config"],
    round: 1,
    phaseEndsAt: null,
    serverNow: 0,
    you: { id: "me", name: "Minh", ready: true, connected: true, alive: true, role: "SEER" },
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
    ...over,
  };
}

const ALL_PHASES: RoomSnapshot["phase"][] = [
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
  "GAME_OVER",
];

describe("guideStepFor", () => {
  it("mọi pha đều có một bước ngắn - không pha nào rơi vào ô trống", () => {
    for (const phase of ALL_PHASES) {
      const step = guideStepFor(snapshot({ phase }));
      assert.ok(step.title.length > 0, phase);
      assert.ok(step.body.length > 0, phase);
      // Hai câu là trần: người chơi đọc trong lúc đồng hồ chạy.
      assert.ok(step.body.split(/[.!?]\s/).length <= 3, `${phase}: ${step.body}`);
    }
  });

  const table = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: i === 0 ? "me" : `p${i}`, name: `P${i}`, alive: true })) as RoomSnapshot["players"];

  it("phòng chờ phản ánh đúng bước chuẩn bị: bộ bài -> bot -> sẵn sàng, đếm theo snapshot", () => {
    // Bộ bài chưa phải preset, chưa đủ người: đang xin bộ bài (đi trước bot).
    const config = guideStepFor(snapshot({ players: table(1) }), { prep: "config" });
    assert.match(config.title, /bộ bài/i);
    assert.match(config.body, /Thợ Săn/);
    // Bộ bài đã đúng, còn thiếu người: đang gọi bot, số đếm từ snapshot.
    const bots = guideStepFor(snapshot({ config: GUIDE_DECK, players: table(3) }), { prep: "bots" });
    assert.match(bots.body, /thêm bot/i);
    assert.match(bots.body, new RegExp(`3/${MIN_PLAYERS_TO_START}`));
    // Đủ người nhưng máy vẫn đang chờ xác nhận: CHƯA được nói "sẵn sàng".
    const waiting = guideStepFor(snapshot({ players: table(MIN_PLAYERS_TO_START) }), { prep: "config" });
    assert.doesNotMatch(waiting.title, /Sẵn sàng/);
    // Xong: sẵn sàng, và chỉ khẳng định preset khi cấu hình đúng là preset.
    const ready = guideStepFor(snapshot({ config: GUIDE_DECK, players: table(MIN_PLAYERS_TO_START) }), { prep: "done" });
    assert.match(ready.body, /Bắt đầu trò chơi/);
    assert.match(ready.tip ?? "", /đội hình chuẩn/);
    const edited = guideStepFor(
      snapshot({ config: { ...GUIDE_DECK, hunter: false }, players: table(MIN_PLAYERS_TO_START) }),
      { prep: "done" },
    );
    assert.match(edited.body, /Bắt đầu trò chơi/);
    assert.match(edited.tip ?? "", /tự chỉnh/);
    assert.doesNotMatch(edited.tip ?? "", /đội hình chuẩn của bàn/);
  });

  it("phòng chờ: thiết lập tự động thất bại thì chỉ rõ hai nút để làm tay, không kẹt im", () => {
    const failed = guideStepFor(snapshot({ players: table(2) }), { prep: "failed" });
    assert.match(failed.body, /Áp dụng đội hình chuẩn/);
    assert.match(failed.body, /Thêm bot/);
    assert.match(failed.body, new RegExp(`2/${MIN_PLAYERS_TO_START}`));
  });

  it("phòng chờ: người xem không phải chủ phòng được bảo chờ, không được bảo 'đang gọi bot' như thể mình làm", () => {
    const guest = guideStepFor(snapshot({ hostId: "someone-else", players: table(4) }), { prep: null });
    assert.match(guest.title, /Chờ chủ phòng/);
    assert.match(guest.body, /Sẵn sàng/);
  });

  it("chia vai: tên vai từ ROLE_META, mục tiêu từ roleGoal - không viết lại luật thắng", () => {
    const step = guideStepFor(snapshot({ phase: "ROLE_REVEAL" }));
    assert.equal(step.title, `Bạn là ${ROLE_META.SEER.name}`);
    assert.equal(step.body, roleGoal("SEER"));
    const wolf = guideStepFor(
      snapshot({
        phase: "ROLE_REVEAL",
        you: { id: "me", name: "M", ready: true, connected: true, alive: true, role: "WEREWOLF" },
      }),
    );
    assert.equal(wolf.body, roleGoal("WEREWOLF"));
    assert.match(wolf.tip ?? "", /Sói/);
  });

  it("đề cử và phán quyết nói rõ điểm khác nhau: đề cử chưa treo ai, phán quyết có thể chết thật", () => {
    const voting = guideStepFor(snapshot({ phase: "VOTING" }));
    assert.match(voting.body, /chưa ai bị treo/i);
    assert.match(voting.tip ?? "", /đổi phiếu/i);
    const trial = {
      accusedId: "a",
      accusedName: "An",
      guiltyVotes: 0,
      innocentVotes: 0,
      guiltyRequired: 3,
      canVote: true,
      hasVoted: false,
      myVote: null,
      canSpeak: false,
    };
    const final = guideStepFor(snapshot({ phase: "FINAL_VOTE", trial }));
    assert.match(final.body, /An/);
    assert.match(final.body, /chết thật/);
    assert.match(final.tip ?? "", /tính là Tha/);
  });

  it("đêm: phân biệt có lượt / đã hành động / không có việc", () => {
    const night = { canAct: true, acted: false } as NonNullable<RoomSnapshot["night"]>;
    assert.match(guideStepFor(snapshot({ phase: "NIGHT", night })).title, /lượt của bạn/);
    assert.match(
      guideStepFor(snapshot({ phase: "NIGHT", night: { ...night, acted: true } })).body,
      /Đã ghi nhận/,
    );
    assert.match(guideStepFor(snapshot({ phase: "NIGHT", night: null })).body, /không có việc/);
  });

  it("người chết được bước riêng ở mọi pha trừ chia vai và kết thúc, và không lộ vai", () => {
    const dead = { id: "me", name: "M", ready: true, connected: true, alive: false, role: "SEER" as const };
    for (const phase of ALL_PHASES) {
      const step = guideStepFor(snapshot({ phase, you: dead }));
      if (phase === "ROLE_REVEAL" || phase === "GAME_OVER") {
        assert.notEqual(step.title, "Bạn đã chết", phase);
      } else {
        assert.equal(step.title, "Bạn đã chết", phase);
        assert.doesNotMatch(step.body + (step.tip ?? ""), /Tiên Tri/);
      }
    }
  });
});

describe("guideStepFor - hành động đặc biệt của người chết đi trước lời nhắc chung", () => {
  const deadHunter = {
    id: "me",
    name: "M",
    ready: true,
    connected: true,
    alive: false,
    role: "HUNTER" as const,
  };
  const shot = (over: Partial<NonNullable<RoomSnapshot["hunterShot"]>>) => ({
    hunterId: "me",
    hunterName: "M",
    canAct: true,
    resolved: false,
    target: null,
    ...over,
  });

  it("Thợ Săn vừa chết, server cho bắn: hướng dẫn chọn mục tiêu hoặc bỏ lượt, không phải 'Bạn đã chết'", () => {
    const step = guideStepFor(
      snapshot({ phase: "HUNTER_SHOT", you: deadHunter, hunterShot: shot({}) }),
    );
    assert.notEqual(step.title, "Bạn đã chết");
    assert.match(step.body, /bắn/i);
    assert.match(step.body + (step.tip ?? ""), /không bắn|bỏ lượt/i);
  });

  it("đã bắn xong (resolved) thì không còn hướng dẫn bắn nữa", () => {
    const step = guideStepFor(
      snapshot({
        phase: "HUNTER_SHOT",
        you: deadHunter,
        hunterShot: shot({ resolved: true, target: { playerId: "a", name: "An" } as never }),
      }),
    );
    assert.doesNotMatch(step.body, /chọn/i);
    assert.match(step.body, /An/);
  });

  it("người chết KHÔNG phải Thợ Săn (canAct=false) ở HUNTER_SHOT vẫn nhận lời nhắc người chết", () => {
    const step = guideStepFor(
      snapshot({
        phase: "HUNTER_SHOT",
        you: { ...deadHunter, role: "SEER" },
        hunterShot: shot({ hunterId: "x", hunterName: "X", canAct: false }),
      }),
    );
    assert.equal(step.title, "Bạn đã chết");
    assert.match(step.body, /X/);
    assert.doesNotMatch(step.body + (step.tip ?? ""), /Tiên Tri/);
  });

  it("người sống ở HUNTER_SHOT chỉ được báo là đang chờ Thợ Săn", () => {
    const step = guideStepFor(
      snapshot({ phase: "HUNTER_SHOT", hunterShot: shot({ hunterId: "x", hunterName: "X", canAct: false }) }),
    );
    assert.doesNotMatch(step.body, /Bạn là Thợ Săn/);
    assert.match(step.body, /X/);
  });

  it("Tiếng Vọng Người Chết: linh hồn được chọn nhận hướng dẫn gửi lời nhắn, người chết khác thì không", () => {
    const chosen = guideStepFor(
      snapshot({ phase: "DAY_DISCUSSION", you: { ...deadHunter, role: "SEER" }, deadCanSpeak: { canAct: true } }),
    );
    assert.match(chosen.title, /Tiếng Vọng/);
    assert.match(chosen.body, /lời nhắn/i);
    const other = guideStepFor(
      snapshot({ phase: "DAY_DISCUSSION", you: { ...deadHunter, role: "SEER" }, deadCanSpeak: { canAct: false } }),
    );
    assert.equal(other.title, "Bạn đã chết");
  });

  it("người sống không có lượt đêm được nói 'vai không có việc ban đêm', còn đã hành động thì 'đã ghi nhận'", () => {
    // Hai câu này dễ nhầm nhau: "chưa tới lượt" (canAct nhưng chưa acted) khác
    // "vai không có kỹ năng" (night null hoặc canAct=false).
    const noSkill = guideStepFor(snapshot({ phase: "NIGHT", night: { canAct: false, acted: false } as never }));
    assert.match(noSkill.body, /không có việc ban đêm/);
    const pending = guideStepFor(snapshot({ phase: "NIGHT", night: { canAct: true, acted: false } as never }));
    assert.match(pending.title, /lượt của bạn/);
  });
});
