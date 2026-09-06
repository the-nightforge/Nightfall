import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_WEIGHTS } from "../src/bot/config/weights";
import { decideDefenseSpeech } from "../src/bot/decision/defense-decision";
import { SPEECH_TEMPLATES, renderSpeechTemplate } from "../src/bot/conversation/templates";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { deriveSpeechStyle } from "../src/bot/personality/speech-style";
import { createSeededRng } from "../src/bot/rng";
import type { Role } from "@masoi/shared";
import type { BotBrainState, BotDecisionContext, BotMemory } from "../src/bot/types";
import type { BotSpeechStyle } from "../src/bot/personality/speech-style";

const IDS = ["accused", "p2", "p3", "p4"];

function stateFor(seed: string): BotBrainState {
  return createBotBrainState("accused", createBotPersonality(createSeededRng(seed)), IDS);
}

function styleFor(seed: string): BotSpeechStyle {
  return deriveSpeechStyle(createBotPersonality(createSeededRng(seed)));
}

/** Bị cáo đang đứng giữa phiên toà: cả làng đã dồn phiếu vào chính nó. */
function contextFor(selfRole: Role): BotDecisionContext {
  return {
    knowledge: {
      botId: "accused",
      round: 2,
      phase: "DEFENSE",
      phaseStartedAt: 0,
      phaseEndsAt: 25_000,
      selfRole,
      players: IDS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: { accused: selfRole },
      seerResult: null,
      sorcererResult: null,
      night: null,
      trialAccusedId: "accused",
      canFinalVote: false,
      hunterShot: null,
      publicVoteHistory: [],
      currentVoteCounts: { players: { accused: 3 }, noElimination: 0 },
      hasVoted: false,
      myVote: null,
      legalVoteChoices: [],
      lastNightDeaths: [],
      activeEventId: null,
      dayOfTruthClaims: {},
      neutralRolesInPlay: [],
    },
    visibleChat: [],
  };
}

function decide(selfRole: Role, seed = "defense") {
  return decideDefenseSpeech(
    contextFor(selfRole),
    stateFor(seed),
    createSeededRng(seed),
    styleFor(seed),
    DEFAULT_BOT_WEIGHTS,
  );
}

const SEEDS = ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8"];

describe("Thằng Hề trong lượt tự bào chữa", () => {
  it("thái độ là BẤT CẦN, không phải cố sống", () => {
    /*
     * Ca hồi quy ở tầng lõi. Trước đây `decideChatClaim` trả `null` cho Hề và
     * scheduler tự dựng một ý định DISAGREE - tức "hãy phản bác việc mình bị
     * nghi", đúng thứ phá hỏng điều kiện thắng của vai này.
     */
    for (const seed of SEEDS) {
      const defense = decide("JESTER", seed);
      expect(defense.stance, seed).toBe("INDIFFERENT");
      expect(defense.intention.kind, seed).not.toBe("DISAGREE");
    }
  });

  it("không khai vai, và không mang bằng chứng để tự gỡ tội", () => {
    for (const seed of SEEDS) {
      const defense = decide("JESTER", seed);
      expect(defense.intention.claimedRole, seed).toBeUndefined();
      expect(defense.intention.evidence, seed).toEqual([]);
    }
  });

  it("mỗi con Hề nói một kiểu - không bắt tất cả cùng một câu", () => {
    /*
     * Yêu cầu tường minh của thiết kế: không bắt mọi Hề công khai xin bị treo,
     * và cũng không bắt chúng nói y hệt nhau. Biến thiên đến từ GIỌNG, suy ra
     * từ tính cách - nên nó vẫn tái lập được theo seed.
     */
    const tones = new Set(SEEDS.map((seed) => decide("JESTER", seed).intention.tone));
    expect(tones.size).toBeGreaterThan(1);
  });

  it("câu phát ra không thanh minh, không cầu xin, không tự tố", () => {
    // Đọc qua ĐÚNG bảng mẫu mà production dùng khi không có nhà cung cấp.
    const banned = ["đừng treo", "không phải tôi", "oan", "tha cho", "treo tôi", "tôi là"];
    for (const seed of SEEDS) {
      const defense = decide("JESTER", seed);
      const text = renderSpeechTemplate({
        intention: defense.intention,
        targetName: null,
        replyToName: null,
        seedTag: "ROOM",
        botId: "accused",
        round: 2,
        seq: 0,
      });
      expect(text, seed).not.toBeNull();
      for (const phrase of banned) {
        expect(text!.toLowerCase(), `${seed}: ${text}`).not.toContain(phrase);
      }
    }
  });

  it("mọi giọng của bể HUMOR đều dùng được ở lượt này", () => {
    // Bể phải phủ đủ mọi giọng mà `jesterDefenseTone` có thể chọn; thiếu một
    // giọng thì `renderSpeechTemplate` rơi về giọng khác và biến thiên biến mất.
    for (const tone of new Set(SEEDS.map((seed) => decide("JESTER", seed).intention.tone))) {
      expect(SPEECH_TEMPLATES.HUMOR[tone], tone).toBeDefined();
    }
  });

  it("KHÔNG khai vai kể cả khi RNG luôn dám - cửa thứ hai của cùng lỗi này", () => {
    /*
     * `decideChatClaim` có một nhánh "Hề khai láo" nằm TRƯỚC nhánh UNDER_FIRE.
     * Gọi nó ở lượt bào chữa nghĩa là một con Hề đang đứng trên giá treo vẫn
     * tung ra được lời khai Tiên Tri - một lời khai kiểm chứng được, tức đúng
     * một nỗ lực tự cứu, và `stance` sẽ thành SURVIVE.
     *
     * `rng` luôn trả 0 nên nhánh đó chắc chắn kích hoạt nếu nó còn được gọi.
     */
    const defense = decideDefenseSpeech(
      contextFor("JESTER"),
      stateFor("dare"),
      () => 0,
      styleFor("dare"),
      DEFAULT_BOT_WEIGHTS,
    );

    expect(defense.stance).toBe("INDIFFERENT");
    expect(defense.intention.kind).toBe("HUMOR");
    expect(defense.intention.claimedRole).toBeUndefined();
  });

  it("KHÔNG rút thêm số ngẫu nhiên nào so với một vai không khai gì", () => {
    /*
     * `decideChatClaim` vẫn tiêu đúng chuỗi RNG mà nó vẫn tiêu; phần chọn thái
     * độ suy từ vai và tính cách. Nếu nhánh Hề rút thêm một số thì mọi ván có
     * Hề sẽ lệch chuỗi so với cùng seed không có Hề.
     */
    const draws = (role: Role) => {
      let count = 0;
      const rng = () => {
        count += 1;
        return 0.5;
      };
      decideDefenseSpeech(
        contextFor(role),
        stateFor("rng"),
        rng,
        styleFor("rng"),
        DEFAULT_BOT_WEIGHTS,
      );
      return count;
    };

    // Hề thoát ra TRƯỚC `decideChatClaim` nên không rút số nào; Dân Làng đi
    // qua hàm đó nhưng mọi nhánh của nó cũng thoát trước khi rút.
    expect(draws("JESTER")).toBe(0);
    expect(draws("JESTER")).toBe(draws("VILLAGER"));
  });
});

describe("các vai khác giữ nguyên lượt tự bào chữa", () => {
  it("Dân Làng vẫn phản bác, thái độ vẫn là cố sống", () => {
    for (const seed of SEEDS) {
      const defense = decide("VILLAGER", seed);
      expect(defense.stance, seed).toBe("SURVIVE");
      expect(defense.intention.kind, seed).toBe("DISAGREE");
      expect(defense.intention.topic, seed).toBe("SUSPICION");
    }
  });

  it("giọng của Dân Làng vẫn bám theo harshness đúng như trước", () => {
    // Hình dạng cũ của đường lui viết ở `machine.ts`, giờ nằm trong lõi. Đây
    // là phép so trực tiếp với công thức đó.
    for (const seed of SEEDS) {
      const style = styleFor(seed);
      expect(decide("VILLAGER", seed).intention.tone, seed).toBe(
        style.harshness >= 0.6 ? "TENSE" : "FIRM",
      );
    }
  });

  it("vai chức năng vẫn lôi vai thật ra làm lá bài cuối", () => {
    const defense = decide("GUARD", "defense");
    expect(defense.stance).toBe("SURVIVE");
    expect(defense.intention.kind).toBe("CLAIM_ROLE");
    expect(defense.intention.claimedRole).toBe("GUARD");
  });

  it("Sói bị dồn vẫn nhận một vai chức năng chưa ai lấy", () => {
    const defense = decide("WEREWOLF", "defense");
    expect(defense.stance).toBe("SURVIVE");
    expect(defense.intention.kind).toBe("CLAIM_ROLE");
    expect(defense.intention.claimedRole).not.toBe("WEREWOLF");
  });

  it("Tiên Tri thật gặp kẻ mạo danh vẫn phản bác, không rơi về đường lui", () => {
    const state = stateFor("counter");
    const impostor: BotMemory = {
      id: "ROLE_CLAIM:m-p2:p2:",
      sourceId: "m-p2",
      round: 1,
      phase: "DAY_DISCUSSION",
      type: "ROLE_CLAIM",
      actorId: "p2",
      importance: 8,
      pinned: false,
      data: { role: "SEER" },
    };
    state.claims.push(impostor);

    const defense = decideDefenseSpeech(
      contextFor("SEER"),
      state,
      createSeededRng("counter"),
      styleFor("counter"),
      DEFAULT_BOT_WEIGHTS,
    );

    expect(defense.stance).toBe("SURVIVE");
    expect(defense.intention.kind).toBe("COUNTER_CLAIM");
    expect(defense.intention.claimedRole).toBe("SEER");
  });
});
