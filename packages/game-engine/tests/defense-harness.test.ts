import { describe, expect, it } from "vitest";
import { PRESET_DECKS } from "@masoi/shared";
import { runSelfPlay, type SelfPlayEvent } from "../src/bot/evaluation/selfplay";

// Cấu hình nhỏ nhất có phiên tòa chắc chắn: preset 8 người, seed cố định.
// Seed đã săn trước: `defense-hunt-0` cho 4 phiên tòa ở hành vi cũ.
const config = { ...PRESET_DECKS[8] };
const SEED = "defense-hunt-0";

type SpeechEvent = Extract<SelfPlayEvent, { kind: "SPEECH" }>;

/**
 * SPEECH nằm giữa NOMINATION có bị cáo và FINAL_VOTE/NOMINATION kế tiếp =
 * nói trong cửa sổ DEFENSE. Lời bàn ban ngày nằm TRƯỚC nomination nên không
 * lọt vào đây.
 */
function defenseSpeechesByNonAccused(events: SelfPlayEvent[]): SpeechEvent[] {
  const out: SpeechEvent[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const open = events[i];
    if (open?.kind !== "NOMINATION" || open.accusedId === null) continue;
    for (let j = i + 1; j < events.length; j += 1) {
      const later = events[j];
      if (later?.kind === "FINAL_VOTE" || later?.kind === "NOMINATION") break;
      if (later?.kind === "SPEECH" && later.actorId !== open.accusedId) out.push(later);
    }
  }
  return out;
}

function trials(events: SelfPlayEvent[]): string[] {
  return events
    .filter((e) => e.kind === "NOMINATION" && e.accusedId !== null)
    .map((e) => (e as Extract<SelfPlayEvent, { kind: "NOMINATION" }>).accusedId as string);
}

describe("harness self-play bật DEFENSE", () => {
  it("bat defense: window that co speech cua nguoi khong phai bi cao", () => {
    const game = runSelfPlay({
      seed: SEED,
      playerCount: 8,
      config,
      defense: true,
      speech: true,
      maxRounds: 30,
    });
    expect(trials(game.events).length).toBeGreaterThan(0);
    expect(defenseSpeechesByNonAccused(game.events).length).toBeGreaterThan(0);
  });

  it("tat defense: giu nguyen hanh vi cu (khong speech defense)", () => {
    const game = runSelfPlay({
      seed: SEED,
      playerCount: 8,
      config,
      defense: false,
      speech: true,
      maxRounds: 30,
    });
    expect(trials(game.events).length).toBeGreaterThan(0);
    expect(defenseSpeechesByNonAccused(game.events)).toEqual([]);
  });
});
