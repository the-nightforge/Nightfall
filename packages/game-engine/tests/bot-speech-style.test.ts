import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveSpeechStyle,
  describeSpeechStyle,
  type BotSpeechStyle,
} from "../src/bot/personality/speech-style";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import type { BotPersonality } from "../src/bot/types";

function personality(over: Partial<BotPersonality> = {}): BotPersonality {
  return {
    aggressiveness: 0.5,
    talkativeness: 0.5,
    riskTolerance: 0.5,
    deceptionSkill: 0.5,
    analyticalSkill: 0.5,
    loyalty: 0.5,
    stubbornness: 0.5,
    ...over,
  };
}

const NUMERIC_FIELDS = [
  "humor",
  "harshness",
  "inquisitive",
  "concession",
  "responsiveness",
  "initiative",
] as const satisfies ReadonlyArray<keyof BotSpeechStyle>;

describe("deriveSpeechStyle", () => {
  it("là hàm thuần: cùng tính cách cho cùng phong cách, mãi mãi", () => {
    const person = personality({ talkativeness: 0.81, aggressiveness: 0.22 });
    const first = deriveSpeechStyle(person);
    for (let i = 0; i < 100; i += 1) {
      expect(deriveSpeechStyle(person)).toEqual(first);
    }
  });

  it("hoạt ngôn cao thì nói dài và hay đáp lời hơn", () => {
    const quiet = deriveSpeechStyle(personality({ talkativeness: 0.05 }));
    const loud = deriveSpeechStyle(personality({ talkativeness: 0.95 }));

    expect(quiet.verbosity).toBe("TERSE");
    expect(loud.verbosity).toBe("TALKATIVE");
    expect(loud.responsiveness).toBeGreaterThan(quiet.responsiveness);
    expect(loud.initiative).toBeGreaterThan(quiet.initiative);
  });

  it("hung hăng cao thì gay gắt và lạnh hơn", () => {
    const soft = deriveSpeechStyle(personality({ aggressiveness: 0.05, loyalty: 0.9 }));
    const harsh = deriveSpeechStyle(personality({ aggressiveness: 0.95, loyalty: 0.1 }));

    expect(harsh.harshness).toBeGreaterThan(soft.harshness);
    expect(soft.warmth).toBe("WARM");
    expect(harsh.warmth).toBe("COLD");
  });

  it("bướng bỉnh cao thì khó thừa nhận đổi ý", () => {
    const flexible = deriveSpeechStyle(personality({ stubbornness: 0.05 }));
    const stubborn = deriveSpeechStyle(personality({ stubbornness: 0.95 }));
    expect(flexible.concession).toBeGreaterThan(stubborn.concession);
  });

  it("phân tích cao thì hay hỏi hơn", () => {
    expect(deriveSpeechStyle(personality({ analyticalSkill: 0.9 })).inquisitive).toBeGreaterThan(
      deriveSpeechStyle(personality({ analyticalSkill: 0.1 })).inquisitive,
    );
  });

  it("mọi trường số nằm trong [0, 1] trên toàn bộ miền tính cách", () => {
    for (let i = 0; i < 300; i += 1) {
      const style = deriveSpeechStyle(createBotPersonality(createSeededRng(`p${i}`)));
      for (const field of NUMERIC_FIELDS) {
        expect(style[field], `${field} @ ${i}`).toBeGreaterThanOrEqual(0);
        expect(style[field], `${field} @ ${i}`).toBeLessThanOrEqual(1);
      }
      expect(["TERSE", "NORMAL", "TALKATIVE"]).toContain(style.verbosity);
      expect(["COLD", "NEUTRAL", "WARM"]).toContain(style.warmth);
      expect(["CASUAL", "PLAIN"]).toContain(style.formality);
      expect(["TÔI_BẠN", "TỚ_CẬU", "MÌNH_ÔNG"]).toContain(style.address);
    }
  });

  it("hai tính cách trái ngược cho ra ít nhất ba đặc điểm khác nhau", () => {
    // Nếu không, "các BOT nghe giống nhau" vẫn đúng nguyên - chỉ là bây giờ có
    // thêm một struct để nhìn.
    const a = deriveSpeechStyle(
      personality({ talkativeness: 0.05, aggressiveness: 0.05, stubbornness: 0.9, analyticalSkill: 0.1 }),
    );
    const b = deriveSpeechStyle(
      personality({ talkativeness: 0.95, aggressiveness: 0.95, stubbornness: 0.1, analyticalSkill: 0.9 }),
    );
    const differing = (Object.keys(a) as Array<keyof BotSpeechStyle>).filter(
      (key) => a[key] !== b[key],
    );
    expect(differing.length).toBeGreaterThanOrEqual(3);
  });

  it("không phải difficulty level: style không lọt vào module quyết định gameplay", () => {
    // Ràng buộc của thiết kế, kiểm bằng đồ thị import chứ không bằng lời hứa.
    const root = join(__dirname, "..", "src", "bot");
    for (const file of [
      "decision/vote-decision.ts",
      "decision/trial-decision.ts",
      "roles/werewolf.ts",
      "roles/seer.ts",
      "roles/witch.ts",
      "roles/guard.ts",
    ]) {
      expect(readFileSync(join(root, file), "utf8"), file).not.toContain("speech-style");
    }
  });
});

describe("describeSpeechStyle", () => {
  it("là tiếng Việt đọc được, không rỗng", () => {
    const text = describeSpeechStyle(deriveSpeechStyle(personality()));
    expect(text.trim().length).toBeGreaterThan(10);
  });

  it("không rò con số hay tên trait tiếng Anh vào prompt", () => {
    // Prompt là thứ mô hình đọc. Ném `aggressiveness: 0.83` vào đó vừa vô nghĩa
    // với nó, vừa để lộ cấu hình nội bộ ra một bề mặt không kiểm soát được.
    for (let i = 0; i < 100; i += 1) {
      const text = describeSpeechStyle(deriveSpeechStyle(createBotPersonality(createSeededRng(`d${i}`))));
      expect(text).not.toMatch(/\d/);
      for (const trait of [
        "aggressiveness",
        "talkativeness",
        "riskTolerance",
        "deceptionSkill",
        "analyticalSkill",
        "loyalty",
        "stubbornness",
      ]) {
        expect(text.toLowerCase()).not.toContain(trait.toLowerCase());
      }
    }
  });

  it("hai phong cách khác nhau đọc ra hai mô tả khác nhau", () => {
    const quiet = describeSpeechStyle(
      deriveSpeechStyle(personality({ talkativeness: 0.05, aggressiveness: 0.05 })),
    );
    const loud = describeSpeechStyle(
      deriveSpeechStyle(personality({ talkativeness: 0.95, aggressiveness: 0.95 })),
    );
    expect(quiet).not.toBe(loud);
  });

  it("sinh ra đủ nhiều mô tả khác nhau để các BOT không nghe giống nhau", () => {
    // Bốn nhãn persona cũ là vấn đề. Một bảng mô tả chỉ có bốn kết quả khả dĩ
    // thì không sửa được gì.
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      seen.add(describeSpeechStyle(deriveSpeechStyle(createBotPersonality(createSeededRng(`v${i}`)))));
    }
    expect(seen.size).toBeGreaterThan(8);
  });
});
