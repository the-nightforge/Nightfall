import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { FallbackBrain } from "../src/bots/fallback-brain";
import type { Attempt, BotBrain, DayDecision, NightDecision } from "../src/bots/types";

function view(): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "v",
    phase: "DAY_DISCUSSION",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 1,
    phaseEndsAt: null,
    you: { id: "v", name: "Vân", ready: true, connected: true, role: "VILLAGER", alive: true },
    players: [
      { id: "v", name: "Vân", alive: true, isBot: true },
      { id: "s", name: "Sang", alive: true, isBot: false },
    ],
    night: null,
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    discussionSkip: null,
    votesRevealed: false,
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
  };
}

/** Não giả ghi lại số lần bị hỏi, để đếm xem chuỗi có đi tiếp hay không. */
function stub(name: string, result: () => Attempt<DayDecision>) {
  const calls = { n: 0 };
  const brain: BotBrain = {
    name,
    async decideNight(): Promise<Attempt<NightDecision>> {
      calls.n += 1;
      return { ok: false };
    },
    async decideDay(): Promise<Attempt<DayDecision>> {
      calls.n += 1;
      return result();
    },
  };
  return { brain, calls };
}

const ok = (chat: string): Attempt<DayDecision> => ({
  ok: true,
  value: { chat, voteTargetId: null },
});

describe("FallbackBrain", () => {
  it("dừng ở não đầu tiên thành công, không hỏi não sau", async () => {
    const a = stub("a", () => ok("xong"));
    const b = stub("b", () => ok("khong nen goi"));

    const r = await new FallbackBrain([a.brain, b.brain]).decideDay(view());
    expect(r).toEqual({ ok: true, value: { chat: "xong", voteTargetId: null } });
    expect(a.calls.n).toBe(1);
    expect(b.calls.n).toBe(0);
  });

  it("não hỏng thì chuyển sang não kế tiếp", async () => {
    const a = stub("a", () => ({ ok: false }));
    const b = stub("b", () => ok("cuu duoc"));

    const r = await new FallbackBrain([a.brain, b.brain]).decideDay(view());
    expect(r).toEqual({ ok: true, value: { chat: "cuu duoc", voteTargetId: null } });
    expect(b.calls.n).toBe(1);
  });

  // Đây là lý do Attempt tồn tại. Nếu "không cần nói gì" bị coi là hỏng thì bot
  // đã chết vẫn được mang sang nhà cung cấp thứ hai - tốn tiền và có thể phát ra
  // lời thoại của người đáng lẽ im lặng.
  it("KHÔNG fallback khi não chủ động không làm gì", async () => {
    const a = stub("a", () => ({ ok: true, value: null }));
    const b = stub("b", () => ok("khong duoc goi"));

    const r = await new FallbackBrain([a.brain, b.brain]).decideDay(view());
    expect(r).toEqual({ ok: true, value: null });
    expect(b.calls.n).toBe(0);
  });

  it("não ném lỗi không chặn đường não còn lại", async () => {
    const a: BotBrain = {
      name: "no",
      decideNight: async () => ({ ok: false }),
      decideDay: async () => {
        throw new Error("mang hong");
      },
    };
    const b = stub("b", () => ok("van chay"));

    const r = await new FallbackBrain([a, b.brain]).decideDay(view());
    expect(r).toEqual({ ok: true, value: { chat: "van chay", voteTargetId: null } });
  });

  it("mọi não đều hỏng thì báo hỏng", async () => {
    const a = stub("a", () => ({ ok: false }));
    const b = stub("b", () => ({ ok: false }));

    expect(await new FallbackBrain([a.brain, b.brain]).decideDay(view())).toEqual({ ok: false });
    expect(a.calls.n).toBe(1);
    expect(b.calls.n).toBe(1);
  });

  it("từ chối chuỗi rỗng thay vì im lặng không làm gì", () => {
    expect(() => new FallbackBrain([])).toThrow();
  });
});
