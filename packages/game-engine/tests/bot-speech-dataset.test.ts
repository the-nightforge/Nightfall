import { describe, expect, it } from "vitest";
import {
  gameToSpeechSamples,
  serializeSpeechSample,
  validateSpeechSample,
} from "../src/bot/learning/speech-dataset";
import { runSelfPlay, type SelfPlayGame } from "../src/bot/evaluation/selfplay";
import { DEFAULT_BOT_WEIGHTS } from "../src/bot/config/weights";
import type { Role } from "@masoi/shared";

function play(seed = "speech-data", speech = true): SelfPlayGame {
  return runSelfPlay({
    seed,
    players: 8,
    maxRounds: 12,
    weights: DEFAULT_BOT_WEIGHTS,
    speech,
  } as never);
}

const GAME = play();
const SAMPLES = gameToSpeechSamples(GAME);

describe("dataset speech — hình dạng", () => {
  it("một mẫu cho một câu đã phát", () => {
    const spoken = GAME.events.filter((event) => event.kind === "SPEECH").length;
    expect(SAMPLES).toHaveLength(spoken);
    expect(SAMPLES.length).toBeGreaterThan(20);
  });

  it("ván không bật speech thì không sinh mẫu nào — không bịa dữ liệu thay thế", () => {
    expect(gameToSpeechSamples(play("no-speech", false))).toEqual([]);
  });

  it("mang đủ sáu nhóm trường §26 đòi", () => {
    const sample = SAMPLES[0]!;
    expect(Object.keys(sample).sort()).toEqual(
      ["conversation", "decision", "gameId", "messageId", "playerId", "response", "reward", "text"].sort(),
    );
  });

  it("topic được ghi lại cho câu đáp", () => {
    const replies = SAMPLES.filter((sample) => sample.decision.kind === "REPLY");
    if (replies.length > 0) {
      expect(replies.some((sample) => sample.decision.topic !== null)).toBe(true);
    }
  });

  it("phần thưởng là +1 hoặc -1", () => {
    for (const sample of SAMPLES) expect([1, -1]).toContain(sample.reward);
  });

  it("tất định: cùng ván cho cùng dataset", () => {
    expect(gameToSpeechSamples(play()).map(serializeSpeechSample)).toEqual(
      SAMPLES.map(serializeSpeechSample),
    );
  });
});

describe("dataset speech — KHÔNG chở tri thức riêng", () => {
  it("đổi toàn bộ bảng vai chỉ đổi phần thưởng, không đổi observation", () => {
    const scrambled: SelfPlayGame = {
      ...GAME,
      roles: Object.fromEntries(
        Object.keys(GAME.roles).map((playerId) => [playerId, "VILLAGER" as Role]),
      ),
    };
    const other = gameToSpeechSamples(scrambled);
    expect(other).toHaveLength(SAMPLES.length);
    for (let index = 0; index < SAMPLES.length; index += 1) {
      expect(other[index]!.conversation).toEqual(SAMPLES[index]!.conversation);
      expect(other[index]!.decision).toEqual(SAMPLES[index]!.decision);
    }
  });

  it("không mẫu nào mang vai thật, kết quả soi hay hành động đêm", () => {
    for (const sample of SAMPLES) {
      expect(validateSpeechSample(sample)).toEqual([]);
    }
  });

  it("validator BẮT một trường lạ lọt vào observation", () => {
    const tainted = {
      ...SAMPLES[0]!,
      conversation: { ...SAMPLES[0]!.conversation, wolfProbability: 0.9 },
    };
    expect(validateSpeechSample(tainted)).toEqual([
      { field: "conversation.wolfProbability", reason: "khoá ngoài danh sách cho phép" },
    ]);
  });

  it("validator BẮT vai thật gắn ở cấp mẫu", () => {
    const tainted = { ...SAMPLES[0]!, finalRole: "WEREWOLF" };
    expect(validateSpeechSample(tainted)).toEqual([
      { field: "finalRole", reason: "mẫu không được mang tri thức riêng" },
    ]);
  });

  it("claimedRole thì ĐƯỢC — nó là thứ đã nói to giữa phòng", () => {
    const claiming = SAMPLES.find((sample) => sample.decision.claimedRole !== null);
    if (claiming) expect(validateSpeechSample(claiming)).toEqual([]);
  });

  it("validator chỉ BÁO CÁO, không sửa mẫu", () => {
    const tainted = { ...SAMPLES[0]!, finalRole: "WEREWOLF" };
    const before = JSON.stringify(tainted);
    validateSpeechSample(tainted);
    expect(JSON.stringify(tainted)).toBe(before);
  });
});

describe("dataset speech — áp lực dùng CHUNG công thức `pressureOf`", () => {
  it("áp lực nằm trong [0,1] và có lúc khác 0", () => {
    const values = SAMPLES.map((sample) => sample.conversation.pressureOnMe);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(values.some((value) => value > 0)).toBe(true);
  });

  it("người bị tố nhiều có áp lực cao hơn người không ai đụng tới", () => {
    const accused = new Map<string, number>();
    for (const event of GAME.events) {
      if (event.kind !== "SPEECH" || event.speech !== "ACCUSE" || event.targetId === null) continue;
      const key = `${event.round}:${event.targetId}`;
      accused.set(key, (accused.get(key) ?? 0) + 1);
    }

    const pressured = SAMPLES.filter(
      (sample) => (accused.get(`${sample.conversation.round}:${sample.playerId}`) ?? 0) >= 2,
    );
    const calm = SAMPLES.filter(
      (sample) => (accused.get(`${sample.conversation.round}:${sample.playerId}`) ?? 0) === 0,
    );

    if (pressured.length > 0 && calm.length > 0) {
      const mean = (list: typeof SAMPLES) =>
        list.reduce((sum, sample) => sum + sample.conversation.pressureOnMe, 0) / list.length;
      expect(mean(pressured)).toBeGreaterThan(mean(calm));
    }
  });
});
