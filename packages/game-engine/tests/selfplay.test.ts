import { afterEach, describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { createSeededRng } from "../src/bot/rng";
import {
  BOT_WEIGHTS_V1,
  DEFAULT_BOT_WEIGHTS,
  resolveWeights,
} from "../src/bot/config/weights";
import {
  MAX_ROUNDS,
  renderIntentionText,
  replayCommand,
  replayGame,
  runSelfPlay,
  type SelfPlayGame,
} from "../src/bot/evaluation/selfplay";
import type { RoomConfig } from "@masoi/shared";

function config(over: Partial<RoomConfig> = {}): Partial<RoomConfig> {
  return over;
}

/** So sánh hai ván theo TOÀN BỘ nội dung quan sát được, không chỉ người thắng. */
function fingerprint(game: SelfPlayGame): string {
  return JSON.stringify({
    winner: game.winner,
    rounds: game.rounds,
    actions: game.actions,
    rejected: game.rejected,
    skipped: game.skipped,
    events: game.events,
    violations: game.violations,
    roles: game.roles,
  });
}

describe("GameEngine.create nhận rng", () => {
  it("cùng rng cho cùng phân vai", () => {
    const build = () =>
      GameEngine.create(
        Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
        { werewolves: 2, seer: true, guard: true, witch: true } as RoomConfig,
        0,
        createSeededRng("assign"),
      ).state.players.map((p) => `${p.id}:${p.role}`);

    expect(build()).toEqual(build());
  });

  it("rng khác cho phân vai khác", () => {
    const build = (seed: string) =>
      GameEngine.create(
        Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
        { werewolves: 2, seer: true, guard: true, witch: true } as RoomConfig,
        0,
        createSeededRng(seed),
      ).state.players.map((p) => p.role);

    expect(build("a")).not.toEqual(build("b"));
  });

  it("không truyền rng thì vẫn dùng nguồn ngẫu nhiên toàn cục như trước", () => {
    // Tham số là TUỲ CHỌN và ở CUỐI, nên mọi call site cũ không đổi hành vi.
    const build = () =>
      GameEngine.create(
        Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
        { werewolves: 2, seer: true, guard: true, witch: true } as RoomConfig,
        0,
      ).state.players.map((p) => p.role).join(",");

    // 20 lần bốc mà ra đúng một kết quả thì tham số mặc định đã bị hỏng.
    const seen = new Set(Array.from({ length: 20 }, build));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("tất định", () => {
  it("cùng seed cho ván giống hệt từng bit", () => {
    const run = () => runSelfPlay({ seed: "det-1" });
    expect(fingerprint(run())).toBe(fingerprint(run()));
  });

  it("cùng seed cho ván giống hệt KỂ CẢ khi bật sự kiện động", () => {
    // Đây là lỗ hổng N1: `resolveNight` từng rơi về `Math.random`, và nó chỉ vô
    // hại chừng nào harness không bao giờ tạo ra một `activeEvent` nào.
    const run = () => runSelfPlay({ seed: "det-events", events: true });
    expect(fingerprint(run())).toBe(fingerprint(run()));
  });

  it("seed khác cho ván khác", () => {
    expect(fingerprint(runSelfPlay({ seed: "a" }))).not.toBe(
      fingerprint(runSelfPlay({ seed: "b" })),
    );
  });

  const realRandom = Math.random;
  afterEach(() => {
    Math.random = realRandom;
  });

  it("thay Math.random toàn cục không đổi kết quả, kể cả khi bật sự kiện", () => {
    const baseline = fingerprint(runSelfPlay({ seed: "no-global", events: true }));

    let counter = 0;
    Math.random = () => {
      counter += 1;
      return ((counter * 7919) % 1000) / 1000;
    };
    const swapped = fingerprint(runSelfPlay({ seed: "no-global", events: true }));

    expect(swapped).toBe(baseline);
    // Và khẳng định phép thay thế thật sự có hiệu lực, nếu không test này vô nghĩa.
    expect(Math.random).not.toBe(realRandom);
  });

  it("luồng RNG của engine và của BOT tách rời nhau", () => {
    // Nếu dùng chung một stream, thêm một quyết định của BOT sẽ đổi luôn kết quả
    // xáo bài của engine, và "cùng seed cho cùng ván" chỉ đúng tới lần sửa
    // chiến thuật kế tiếp.
    const withSpeech = runSelfPlay({ seed: "streams", speech: true });
    const withoutSpeech = runSelfPlay({ seed: "streams", speech: false });
    expect(withSpeech.roles).toEqual(withoutSpeech.roles);
  });
});

describe("giới hạn số vòng", () => {
  it("chạm trần thì ghi vi phạm chứ không ném", () => {
    const game = runSelfPlay({ seed: "cap", maxRounds: 1 });
    expect(game.rounds).toBe(1);
    expect(game.violations.map((item) => item.id)).toEqual(["ROUND_LIMIT"]);
  });

  it("ván bình thường kết thúc trong trần mặc định", () => {
    const game = runSelfPlay({ seed: "normal" });
    expect(game.rounds).toBeLessThanOrEqual(MAX_ROUNDS);
    expect(game.winner).not.toBeNull();
  });
});

describe("replay độc lập", () => {
  it("record dựng lại đúng ván cũ, không cần batch", () => {
    const original = runSelfPlay({ seed: "replay-me", playerCount: 9, events: true });
    expect(fingerprint(replayGame(original.record))).toBe(fingerprint(original));
  });

  it("record chứa đủ mọi thứ cần để chạy lại", () => {
    const { record } = runSelfPlay({ seed: "rec" });
    expect(Object.keys(record).sort()).toEqual([
      "config",
      "events",
      "humanSeats",
      "maxRounds",
      "playerCount",
      "seed",
      "speech",
      "weightsVersion",
    ]);
  });

  it("từ chối replay bằng phiên bản trọng số khác", () => {
    // Chạy lại một seed hỏng bằng bộ trọng số khác sẽ cho ra một ván khác, và
    // báo cáo "không tái hiện được" khi đó là một kết luận sai.
    const { record } = runSelfPlay({ seed: "rec", weights: BOT_WEIGHTS_V1 });
    expect(() => replayGame(record, resolveWeights({ trust: { damping: 0.5 } }))).toThrow(
      /1\.0\.0/,
    );
  });

  it("in ra câu lệnh chạy lại được", () => {
    const { record } = runSelfPlay({ seed: "boom", playerCount: 9, events: true });
    const command = replayCommand(record);
    expect(command).toContain("--seed boom");
    expect(command).toContain("--players 9");
    expect(command).toContain("--events");
    // Nêu theo cấu hình đang dùng, không hard-code một phiên bản: lệnh replay
    // phải trỏ đúng bộ trọng số đã sinh ra ván, kể cả sau khi default đổi.
    expect(command).toContain(`--weights ${DEFAULT_BOT_WEIGHTS.version}`);
  });
});

describe("lời nói", () => {
  it("BOT nói và những BOT khác nghe được", () => {
    const game = runSelfPlay({ seed: "talk", speech: true });
    expect(game.events.some((item) => item.kind === "SPEECH")).toBe(true);
  });

  it("tắt lời nói thì không có câu nào", () => {
    const game = runSelfPlay({ seed: "talk", speech: false });
    expect(game.events.some((item) => item.kind === "SPEECH")).toBe(false);
  });

  it("lời nói KHÔNG đổi được nước đi", () => {
    // Ràng buộc cốt lõi: provider chỉ diễn đạt. Ở đây template thuần thay chỗ
    // provider, và nó phải chịu đúng ràng buộc đó.
    const spoken = runSelfPlay({ seed: "no-influence", speech: true });
    const silent = runSelfPlay({ seed: "no-influence", speech: false });

    /**
     * Lá phiếu ĐẦU TIÊN của mỗi người ở vòng 1.
     *
     * Đó là lúc chưa ai kịp nghe ai, nên nó phải trùng khít bất kể có lời nói
     * hay không. Từ lượt cân nhắc lại trở đi, lời nói ĐƯỢC PHÉP ảnh hưởng -
     * nhưng qua `chat-analysis`, tức qua BẰNG CHỨNG được ghi vào belief, chứ
     * không phải qua việc ghi đè một nước đi đã chốt. Hai đường đó khác nhau về
     * bản chất, và chỉ đường thứ hai mới là vi phạm.
     */
    const firstBallots = (game: SelfPlayGame) => {
      const seen = new Map<string, string>();
      for (const item of game.events) {
        if (item.kind !== "VOTE" || item.round !== 1) continue;
        if (seen.has(item.voterId)) continue;
        seen.set(item.voterId, `${item.voterId}:${item.targetId}`);
      }
      return [...seen.values()].sort();
    };

    expect(firstBallots(spoken)).toEqual(firstBallots(silent));
  });

  it("template chỉ nêu lại ý định, không thêm thông tin", () => {
    const nameOf = (id: string) => id.toUpperCase();
    expect(
      renderIntentionText(
        { kind: "ACCUSE", targetId: "p2", confidence: 1, evidence: [], tone: "FIRM" },
        nameOf,
      ),
    ).toBe("Tôi nghi P2.");
    expect(
      renderIntentionText(
        { kind: "WITHHOLD", confidence: 1, evidence: [], tone: "NEUTRAL" },
        nameOf,
      ),
    ).toBe("Tôi chưa đủ căn cứ.");
  });

  it("lời nói thật sự đi vào phân tích chat và sinh ra bằng chứng", () => {
    // Không có khẳng định này thì `speech: true` có thể chỉ là ghi log: câu nói
    // được tạo ra rồi không ai đọc, và cả đường chat-analysis vẫn chết như cũ.
    const game = runSelfPlay({ seed: "chat-feeds-belief", speech: true, trace: true });
    const accusations = game.events.filter(
      (item) => item.kind === "SPEECH" && item.speech === "ACCUSE",
    );
    expect(accusations.length).toBeGreaterThan(0);

    const laterVotes = game.events.filter(
      (item) => item.kind === "VOTE" && item.round > 1 && item.evidence.length > 0,
    );
    expect(laterVotes.length).toBeGreaterThan(0);
  });
});

describe("nhân mô phỏng là thuần", () => {
  it("không đọc đồng hồ thật", () => {
    // Hai ván cùng seed chạy cách nhau về thời gian phải giống hệt nhau; nếu
    // `Date.now` lọt vào một quyết định, khẳng định này sẽ hỏng ngẫu nhiên.
    const first = fingerprint(runSelfPlay({ seed: "clock" }));
    const busy = Date.now();
    while (Date.now() - busy < 5) {
      /* đợi cho đồng hồ tường nhích */
    }
    expect(fingerprint(runSelfPlay({ seed: "clock" }))).toBe(first);
  });

  it("không nước đi nào bị engine từ chối", () => {
    for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
      const game = runSelfPlay({ seed, events: true });
      expect({ seed, rejected: game.rejected }).toEqual({ seed, rejected: 0 });
    }
  });

  it("chuỗi sự kiện có mặt và theo đúng thứ tự vòng", () => {
    const game = runSelfPlay({ seed: "log" });
    const rounds = game.events.map((item) => item.round);
    expect(rounds).toEqual([...rounds].sort((a, b) => a - b));
    expect(game.events.some((item) => item.kind === "PHASE")).toBe(true);
    expect(game.events.some((item) => item.kind === "VOTE")).toBe(true);
  });

  it("trace tắt mặc định, bật được khi cần", () => {
    expect(runSelfPlay({ seed: "tr" }).traces).toEqual([]);
    expect(runSelfPlay({ seed: "tr", trace: true }).traces.length).toBeGreaterThan(0);
  });

  it("bật trace không đổi diễn biến ván", () => {
    expect(fingerprint(runSelfPlay({ seed: "tr2", trace: true }))).toBe(
      fingerprint(runSelfPlay({ seed: "tr2" })),
    );
  });
});

describe("cấu hình vai mở rộng", () => {
  it("chạy được với bộ vai đầy đủ mà không có nước đi bị từ chối", () => {
    const game = runSelfPlay({
      seed: "extended",
      // 13 lá vai bên dưới + ít nhất một Dân Làng.
      playerCount: 14,
      config: config({
        werewolves: 2,
        wolfCub: true,
        seer: true,
        apprenticeSeer: true,
        detective: true,
        guard: true,
        guardianAngel: true,
        priest: true,
        witch: true,
        hunter: true,
        mayor: true,
        cursed: true,
      }),
      events: true,
    });

    expect(game.rejected).toBe(0);
    expect(game.violations).toEqual([]);
  });
});
