import { describe, expect, it } from "vitest";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import { gameToTrajectories, observationFromTrace } from "../src/bot/evaluation/trajectory";
import { encodeObservation } from "../src/bot/learning/observation";

describe("observation lúc chơi == observation của trace", () => {
  it("observationFromTrace là đúng hàm gameToTrajectories dùng", () => {
    const game = runSelfPlay({ seed: "live-1", playerCount: 8, trace: true, maxRounds: 4 });
    const lines = gameToTrajectories(game);
    expect(lines.length).toBe(game.traces.length);
    for (let i = 0; i < lines.length; i += 1) {
      const fromTrace = observationFromTrace(game.traces[i]!);
      expect(fromTrace.observation).toEqual(lines[i]!.observation);
      expect(fromTrace.legalActions).toEqual(lines[i]!.legalActions);
    }
  });

  it("encodeObservation không cần selectedAction; có thì actionIndex như cũ", () => {
    const game = runSelfPlay({ seed: "live-2", playerCount: 8, trace: true, maxRounds: 3 });
    const line = gameToTrajectories(game).find(
      (l) => l.decision === "VOTE" && l.selectedAction.targetId !== null,
    )!;
    const { selectedAction, ...withoutLabel } = line;
    expect(selectedAction.targetId).not.toBeNull();
    const a = encodeObservation(withoutLabel);
    const b = encodeObservation(line);
    expect(a.features).toEqual(b.features);
    expect(a.mask).toEqual(b.mask);
    expect(a.actionIndex).toBeNull();
    expect(b.actionIndex).not.toBeNull();
  });

  it("buildLiveObservation cho ra CÙNG features như trajectory, trên 20 ván", () => {
    // Trace ghi beliefAfter + knowledgeSnapshot tại thời điểm quyết định; lúc
    // chơi ta chỉ có knowledge + state. Hai đường phải gặp nhau ở đây.
    let compared = 0;
    for (let g = 0; g < 20; g += 1) {
      const game = runSelfPlay({
        seed: `live-3-${g}`,
        playerCount: 8,
        trace: true,
        traceLiveInput: true,
        maxRounds: 6,
      });
      for (const trace of game.traces) {
        if (!["VOTE", "NIGHT", "HUNTER_SHOT"].includes(trace.decision)) continue;
        // `liveInput` được self-play ghi kèm khi trace bật.
        const live = trace.liveInput;
        if (!live) continue;
        const expected = encodeObservation(observationFromTrace(trace));
        const got = encodeObservation(live);
        expect(got.features).toEqual(expected.features);
        expect(got.mask).toEqual(expected.mask);
        expect(got.seats).toEqual(expected.seats);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(200);
  });
});
