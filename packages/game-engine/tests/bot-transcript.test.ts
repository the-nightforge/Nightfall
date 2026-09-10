import { describe, expect, it } from "vitest";
import {
  buildAnswerKey,
  buildTranscript,
  formatTranscript,
} from "../src/bot/evaluation/transcript";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import { DEFAULT_BOT_WEIGHTS } from "../src/bot/config/weights";
import type { Role } from "@masoi/shared";
import type { SelfPlayGame } from "../src/bot/evaluation/selfplay";

function play(seed = "transcript-1"): SelfPlayGame {
  return runSelfPlay({
    seed,
    players: 8,
    maxRounds: 12,
    weights: DEFAULT_BOT_WEIGHTS,
    speech: true,
  } as never);
}

function namesFor(game: SelfPlayGame): Record<string, string> {
  const names: Record<string, string> = {};
  Object.keys(game.roles)
    .sort()
    .forEach((playerId, index) => {
      names[playerId] = `Người ${index + 1}`;
    });
  return names;
}

const GAME = play();
const NAMES = namesFor(GAME);
const TEXT = formatTranscript(buildTranscript(GAME, "Ván A", NAMES));

describe("biên bản KHÔNG lộ vai (§27)", () => {
  it("đổi toàn bộ bảng vai không làm biên bản đổi một ký tự", () => {
    // Khẳng định MẠNH nhất có thể về "không đọc vai": nếu `buildTranscript`
    // chạm vào `game.roles` ở bất kỳ đâu, phép so này đỏ.
    const scrambled: SelfPlayGame = {
      ...GAME,
      roles: Object.fromEntries(
        Object.keys(GAME.roles).map((playerId) => [playerId, "WEREWOLF" as Role]),
      ),
    };
    expect(formatTranscript(buildTranscript(scrambled, "Ván A", NAMES))).toBe(TEXT);
  });

  it("xoá mọi sự kiện riêng tư khỏi đầu vào cũng không đổi gì", () => {
    const publicOnly: SelfPlayGame = {
      ...GAME,
      events: GAME.events.filter((event) =>
        ["PHASE", "SPEECH", "VOTE", "NOMINATION", "FINAL_VOTE", "DEATH"].includes(event.kind),
      ),
    };
    expect(formatTranscript(buildTranscript(publicOnly, "Ván A", NAMES))).toBe(TEXT);
  });

  it("không có nguyên nhân chết nào gọi tên một vai", () => {
    for (const cause of ["poison", "serial_killer", "wolf", "hunter"]) {
      expect(TEXT).not.toContain(cause);
    }
  });

  it("treo cổ thì vẫn nói rõ — cả làng vừa bỏ phiếu, giấu đi là kém hơn phòng thật", () => {
    const lynched = GAME.events.some(
      (event) => event.kind === "DEATH" && event.cause === "lynch",
    );
    // Ván nào cũng treo ít nhất một người ở cỡ 8 ghế; nếu không thì bỏ qua.
    if (lynched) expect(TEXT).toContain("bị treo cổ");
  });

  it("không mang seed — có seed là chạy lại được ván và đọc ra vai", () => {
    expect(TEXT).not.toContain(GAME.record.seed);
  });

  it("không lộ quyết định nội bộ: loại ý định, giọng, hay vai được khai", () => {
    for (const internal of ["ACCUSE", "COUNTER_CLAIM", "CLAIM_ROLE", "TENSE", "CURIOUS", "SUSPICION"]) {
      expect(TEXT).not.toContain(internal);
    }
  });

  it("không lộ kết cục ván", () => {
    for (const outcome of ["village", "wolves", "serial_killer", "draw"]) {
      expect(TEXT).not.toContain(outcome);
    }
  });
});

describe("biên bản vẫn dùng được để chấm", () => {
  it("có lời thoại thật, kèm tên người nói", () => {
    const transcript = buildTranscript(GAME, "Ván A", NAMES);
    const chat = transcript.entries.filter((entry) => entry.speaker !== null);
    expect(chat.length).toBeGreaterThan(10);
    expect(chat.every((entry) => entry.text.length > 0)).toBe(true);
  });

  it("có mốc pha và kết quả bỏ phiếu để đọc được mạch ván", () => {
    expect(TEXT).toContain("## Ngày 1");
    expect(TEXT).toContain("Diễn biến bỏ phiếu:");
  });

  it("tất định: cùng ván cho cùng biên bản", () => {
    expect(formatTranscript(buildTranscript(play(), "Ván A", NAMES))).toBe(TEXT);
  });

  it("chỉ nêu tên người chơi, không nêu id", () => {
    for (const playerId of Object.keys(GAME.roles)) {
      expect(TEXT).not.toContain(`${playerId}:`);
    }
  });
});

describe("tờ đáp án — chỗ DUY NHẤT có vai", () => {
  it("mang vai, kết cục và seed, khoá theo tên hiển thị", () => {
    const key = buildAnswerKey(GAME, "Ván A", NAMES);
    expect(key.label).toBe("Ván A");
    expect(key.seed).toBe(GAME.record.seed);
    expect(key.winner).toBe(GAME.winner);
    expect(Object.keys(key.roles)).toContain("Người 1");
    expect(Object.keys(key.roles)).toHaveLength(Object.keys(GAME.roles).length);
  });

  it("là một hàm RIÊNG, không phải một cờ của biên bản", () => {
    // Nếu ai đó gộp hai thứ này lại, `buildTranscript` sẽ có một tham số
    // optional bật được - và đó là thứ sẽ vô tình bị bật.
    expect(buildTranscript(GAME, "Ván A", NAMES)).not.toHaveProperty("roles");
    expect(buildTranscript(GAME, "Ván A", NAMES)).not.toHaveProperty("winner");
  });
});

describe("không câu chat nào chứa MÃ vai", () => {
  /**
   * Hồi quy cho một lỗi mà bộ biên bản của §27 bắt được ở lần chạy ĐẦU TIÊN,
   * còn toàn bộ tầng đo thì không: `claim-credibility` nội suy mã vai thô vào
   * câu tóm tắt bằng chứng, và câu đó đi thẳng ra khung chat —
   * "có người khác cũng nhận là GUARD".
   *
   * Mọi chỉ số cũ đều chạy trên dữ liệu CÓ CẤU TRÚC, nên không cái nào đọc câu
   * chữ. Đây là test đầu tiên làm việc đó.
   */
  it("quét mọi lời thoại của nhiều ván", () => {
    const codes = [
      "WEREWOLF", "WOLF_CUB", "SORCERER", "ALPHA_WOLF", "TRAITOR",
      "SEER", "APPRENTICE_SEER", "DETECTIVE", "GUARD", "TRACKER",
      "WITCH", "ELDER", "DOPPELGANGER", "HUNTER", "VILLAGER",
      "JESTER", "SERIAL_KILLER", "EXECUTIONER",
    ];

    const offenders: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const game = play(`role-code-${index}`);
      for (const event of game.events) {
        if (event.kind !== "SPEECH") continue;
        for (const code of codes) {
          if (event.text.includes(code)) offenders.push(`${code}: ${event.text}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
