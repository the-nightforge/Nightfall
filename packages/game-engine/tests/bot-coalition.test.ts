import { describe, expect, it } from "vitest";
import {
  detectCoalitions,
  isolationScore,
} from "../src/bot/analysis/coalition";
import { createSeededRng } from "../src/bot/rng";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import type { BotBrainState, SocialEdge } from "../src/bot/types";

const PLAYERS = ["me", "a", "b", "c", "d", "e"];

function stateFor(seed = "coalition"): BotBrainState {
  return createBotBrainState("me", createBotPersonality(createSeededRng(seed)), PLAYERS);
}

function edge(over: Partial<SocialEdge> = {}): SocialEdge {
  return {
    support: 0,
    hostility: 0,
    voteAlignment: 0,
    samples: 6,
    reasons: [],
    lastUpdatedRound: 2,
    ...over,
  };
}

/** Buộc hai người thành một cặp gắn bó, cả hai chiều. */
function bond(state: BotBrainState, left: string, right: string, strength = 1): void {
  state.relationships[`${left}->${right}`] = edge({
    voteAlignment: strength,
    support: strength,
  });
  state.relationships[`${right}->${left}`] = edge({
    voteAlignment: strength,
    support: strength,
  });
}

describe("detectCoalitions", () => {
  it("gom ba người luôn bỏ phiếu cùng nhau thành một nhóm", () => {
    const state = stateFor();
    bond(state, "a", "b");
    bond(state, "b", "c");
    bond(state, "a", "c");

    const groups = detectCoalitions(state);

    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].memberIds).toEqual(["a", "b", "c"]);
    expect(groups[0].cohesion).toBeGreaterThan(0);
  });

  it("người không liên kết ai không nằm trong nhóm nào", () => {
    const state = stateFor();
    bond(state, "a", "b");
    bond(state, "b", "c");
    bond(state, "a", "c");

    const members = detectCoalitions(state).flatMap((group) => group.memberIds);

    expect(members).not.toContain("d");
    expect(members).not.toContain("e");
  });

  it("không có quan hệ nào thì không có nhóm nào", () => {
    expect(detectCoalitions(stateFor())).toEqual([]);
  });

  it("một cặp đơn lẻ vẫn là coalition hợp lệ", () => {
    const state = stateFor();
    bond(state, "a", "b");

    const groups = detectCoalitions(state);

    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds).toEqual(["a", "b"]);
  });

  it("thù địch phá vỡ nhóm dù có cùng bỏ phiếu", () => {
    // Hai người cùng vote một mục tiêu nhưng liên tục công kích nhau thì không
    // phải một phe; đó là hai người tình cờ trùng ý.
    const state = stateFor();
    state.relationships["a->b"] = edge({ voteAlignment: 1, hostility: 1 });
    state.relationships["b->a"] = edge({ voteAlignment: 1, hostility: 1 });

    // Nêu ngưỡng tường minh thay vì mượn mặc định: `social.minCohesion` là một
    // trọng số có thể hiệu chỉnh, và test này nói về CÔNG THỨC (thù địch trừ đi
    // đồng thuận), không nói về giá trị ngưỡng đang dùng cho production.
    expect(detectCoalitions(state, 0.15)).toEqual([]);
  });

  it("deterministic: không phụ thuộc thứ tự chèn khoá", () => {
    const forward = stateFor();
    bond(forward, "a", "b");
    bond(forward, "b", "c");
    bond(forward, "a", "c");

    const backward = stateFor();
    bond(backward, "a", "c");
    bond(backward, "b", "c");
    bond(backward, "a", "b");

    expect(detectCoalitions(forward)).toEqual(detectCoalitions(backward));
  });

  it("không bao giờ kết luận về vai", () => {
    const state = stateFor();
    bond(state, "a", "b");

    // Coalition là tín hiệu đầu vào, không phải phán quyết. Ghi nó vào
    // knownRoles sẽ phá đúng ranh giới Phase 1 dựng lên.
    expect(JSON.stringify(detectCoalitions(state))).not.toContain("WEREWOLF");
    expect(state.knownInformation.knownRoles).toEqual({});
  });
});

describe("isolationScore", () => {
  const alive = ["me", "a", "b", "c", "d"];

  it("người bị cả làng nhắm mà không ai bênh có điểm cao nhất", () => {
    const state = stateFor();
    for (const from of ["a", "b", "c"]) {
      state.relationships[`${from}->d`] = edge({ hostility: 1 });
    }
    state.relationships["a->b"] = edge({ support: 1 });

    expect(isolationScore(state, "d", alive)).toBeGreaterThan(
      isolationScore(state, "b", alive),
    );
  });

  it("được bênh thì bớt cô lập", () => {
    const state = stateFor();
    state.relationships["a->c"] = edge({ hostility: 1 });
    const withoutSupport = isolationScore(state, "c", alive);

    state.relationships["b->c"] = edge({ support: 1 });
    expect(isolationScore(state, "c", alive)).toBeLessThan(withoutSupport);
  });

  it("không quan hệ nào thì không cô lập", () => {
    expect(isolationScore(stateFor(), "a", alive)).toBe(0);
  });
});
