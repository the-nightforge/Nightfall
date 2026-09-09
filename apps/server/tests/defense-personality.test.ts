import { describe, expect, it } from "vitest";
import { deriveSpeechStyle, describeSpeechStyle } from "@masoi/game-engine";
import type { BotPersonality } from "@masoi/game-engine";
import { buildDaySpeechPrompt } from "../src/bots/prompt";
import type { SpeechRequest } from "../src/bots/types";

function personality(over: Partial<BotPersonality> = {}): BotPersonality {
  return {
    aggressiveness: 0.8,
    talkativeness: 0.2,
    riskTolerance: 0.5,
    deceptionSkill: 0.5,
    analyticalSkill: 0.5,
    loyalty: 0.2,
    stubbornness: 0.9,
    ...over,
  };
}

/**
 * Yêu cầu diễn đạt cho lượt tự bào chữa, đúng hình dạng `scheduleDefenseBot`
 * (`machine.ts`) dựng khi lõi không chốt claim gì: ý định DISAGREE không chỉ
 * đích danh ai, kèm `defense` mang số phiếu công khai.
 */
function defenseRequest(style: ReturnType<typeof deriveSpeechStyle>): SpeechRequest {
  return {
    roomCode: "ROOMA",
    speaker: { id: "bot", name: "An" },
    style,
    styleDescription: describeSpeechStyle(style),
    intention: {
      kind: "DISAGREE",
      topic: "SUSPICION",
      confidence: 0.5,
      evidence: [],
      tone: "FIRM",
    },
    evidence: [],
    targetName: null,
    replyTo: null,
    recentOwnLines: [],
    chatWindow: [],
    avoidOpenings: [],
    recentSpeechSourceIds: [],
    priorStance: null,
    seq: 0,
    round: 2,
    players: [{ id: "bot", name: "An", alive: true }],
    defense: { votesAgainstMe: 3, alsoAccused: [], stance: "SURVIVE" },
  };
}

describe("lời bào chữa cũng mang tính cách thật", () => {
  it("prompt bào chữa dùng phong cách dẫn xuất từ BotRuntime, không phải một nhãn cứng", () => {
    const style = deriveSpeechStyle(personality());
    const prompt = buildDaySpeechPrompt(defenseRequest(style));

    expect(prompt.system).toContain(describeSpeechStyle(style));
  });

  it("hai tính cách khác nhau cho hai prompt khác nhau", () => {
    const quiet = buildDaySpeechPrompt(
      defenseRequest(deriveSpeechStyle(personality({ talkativeness: 0.05, aggressiveness: 0.05 }))),
    );
    const loud = buildDaySpeechPrompt(
      defenseRequest(deriveSpeechStyle(personality({ talkativeness: 0.95, aggressiveness: 0.95 }))),
    );

    expect(quiet.system).not.toBe(loud.system);
  });
});
