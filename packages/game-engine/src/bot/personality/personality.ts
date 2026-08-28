import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotPersonality, BotRng } from "../types";

function personalityValue(rng: BotRng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function createBotPersonality(
  rng: BotRng,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotPersonality {
  const { min, max } = weights.personalityRange;
  return {
    aggressiveness: personalityValue(rng, min, max),
    talkativeness: personalityValue(rng, min, max),
    riskTolerance: personalityValue(rng, min, max),
    deceptionSkill: personalityValue(rng, min, max),
    analyticalSkill: personalityValue(rng, min, max),
    loyalty: personalityValue(rng, min, max),
    stubbornness: personalityValue(rng, min, max),
  };
}
