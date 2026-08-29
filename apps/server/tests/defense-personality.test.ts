import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveSpeechStyle, describeSpeechStyle } from "@masoi/game-engine";
import type { BotPersonality } from "@masoi/game-engine";
import type { RoomSnapshot } from "@masoi/shared";
import { buildDefensePrompt } from "../src/bots/prompt";
import { RandomBrain } from "../src/bots/random-brain";

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

function accused(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "ROOMA",
    status: "IN_GAME",
    phase: "DEFENSE",
    round: 2,
    phaseEndsAt: null,
    players: [
      { id: "bot", name: "An", alive: true, isBot: true, voteCount: 3 },
      { id: "p2", name: "Bình", alive: true, isBot: false, voteCount: 0 },
    ],
    you: { id: "bot", name: "An", alive: true, role: "VILLAGER" },
    chatLog: [],
    lastNightDeaths: [],
    lastEliminated: null,
    trial: { accusedId: "bot", canSpeak: true },
    ...over,
  } as unknown as RoomSnapshot;
}

describe("lời bào chữa cũng mang tính cách thật", () => {
  it("prompt bào chữa dùng phong cách dẫn xuất, không dùng bốn nhãn cứng", () => {
    const style = deriveSpeechStyle(personality());
    const prompt = buildDefensePrompt(accused(), style);

    expect(prompt).not.toBeNull();
    expect(prompt!.system).toContain(describeSpeechStyle(style));
    for (const legacy of [
      "ít nói, câu cụt lủn",
      "hay nghi ngờ, thích chất vấn người khác",
      "hoà giải, xuê xoa, ngại đối đầu",
      "bông đùa, hay pha trò",
    ]) {
      expect(prompt!.system).not.toContain(legacy);
    }
  });

  it("hai tính cách khác nhau cho hai prompt khác nhau", () => {
    const quiet = buildDefensePrompt(
      accused(),
      deriveSpeechStyle(personality({ talkativeness: 0.05, aggressiveness: 0.05 })),
    );
    const loud = buildDefensePrompt(
      accused(),
      deriveSpeechStyle(personality({ talkativeness: 0.95, aggressiveness: 0.95 })),
    );
    expect(quiet!.system).not.toBe(loud!.system);
  });

  it("không có phong cách thì vẫn dựng được prompt", () => {
    expect(buildDefensePrompt(accused())).not.toBeNull();
  });
});

describe("não dự phòng không dùng ngẫu nhiên toàn cục", () => {
  const brain = new RandomBrain();

  it("cùng bị cáo, cùng vòng cho cùng một câu", async () => {
    const first = await brain.decideDefense(accused());
    for (let i = 0; i < 20; i += 1) {
      expect((await brain.decideDefense(accused())).value).toEqual(first.value);
    }
  });

  it("hai bị cáo khác nhau nói khác nhau", async () => {
    const lines = new Set<string>();
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      const view = accused({ you: { id, name: "X", alive: true, role: "VILLAGER" } } as never);
      const result = await brain.decideDefense(view);
      if (result.value) lines.add(result.value.chat);
    }
    expect(lines.size).toBeGreaterThan(1);
  });

  it("cùng bị cáo ở hai vòng khác nhau không lặp y hệt", async () => {
    const lines = new Set<string>();
    for (const round of [1, 2, 3, 4, 5, 6]) {
      const result = await brain.decideDefense(accused({ round } as never));
      if (result.value) lines.add(result.value.chat);
    }
    expect(lines.size).toBeGreaterThan(1);
  });

  it("không được nói khi chưa tới lượt bào chữa", async () => {
    const result = await brain.decideDefense(accused({ trial: undefined } as never));
    expect(result.value).toBeNull();
  });

  it("mã nguồn không chứa nguồn ngẫu nhiên toàn cục", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "bots", "random-brain.ts"),
      "utf8",
    );
    expect(source).not.toContain("Math.rand" + "om");
  });
});
