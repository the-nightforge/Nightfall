import type { BotPersonality, BotRng } from "../types";

const MIN_PERSONALITY_VALUE = 0.25;
const MAX_PERSONALITY_VALUE = 0.9;

function personalityValue(rng: BotRng): number {
  return MIN_PERSONALITY_VALUE + rng() * (MAX_PERSONALITY_VALUE - MIN_PERSONALITY_VALUE);
}

export function createBotPersonality(rng: BotRng): BotPersonality {
  return {
    aggressiveness: personalityValue(rng),
    talkativeness: personalityValue(rng),
    riskTolerance: personalityValue(rng),
    deceptionSkill: personalityValue(rng),
    analyticalSkill: personalityValue(rng),
    loyalty: personalityValue(rng),
    stubbornness: personalityValue(rng),
  };
}
