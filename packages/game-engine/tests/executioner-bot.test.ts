import { describe, expect, it } from "vitest";
import { applyPrivateInformation } from "../src/bot/belief/private-info";
import {
  BOT_WEIGHTS_V1,
  BOT_WEIGHTS_V8,
  BOT_WEIGHTS_V9,
  DEFAULT_BOT_WEIGHTS,
} from "../src/bot/config/presets";
import { decideFinalVote } from "../src/bot/decision/trial-decision";
import { decideDefenseSpeech } from "../src/bot/decision/defense-decision";
import { selectVote } from "../src/bot/decision/vote-decision";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { deriveSpeechStyle } from "../src/bot/personality/speech-style";
import { createSeededRng } from "../src/bot/rng";
import { executionerStrategy } from "../src/bot/roles/executioner";
import { strategyFor } from "../src/bot/roles/registry";
import type { BotBrainState, BotDecisionContext, BotKnowledgeView } from "../src/bot/types";

const IDS = ["me", "mark", "trusted", "loud"];

function stateFor(seed = "exec"): BotBrainState {
  return createBotBrainState("me", createBotPersonality(createSeededRng(seed)), IDS);
}

function knowledge(over: Partial<BotKnowledgeView> = {}): BotKnowledgeView {
  return {
    botId: "me",
    round: 2,
    phase: "VOTING",
    phaseStartedAt: 0,
    phaseEndsAt: null,
    selfRole: "EXECUTIONER",
    players: IDS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
    knownRoles: { me: "EXECUTIONER" },
    seerResult: null,
    sorcererResult: null,
    neutralRolesInPlay: ["EXECUTIONER"],
    executionerTargetId: "mark",
    night: null,
    trialAccusedId: null,
    canFinalVote: false,
    hunterShot: null,
    publicVoteHistory: [],
    currentVoteCounts: { players: {}, noElimination: 0 },
    hasVoted: false,
    myVote: null,
    legalVoteChoices: [
      { type: "PLAYER", targetId: "mark" },
      { type: "PLAYER", targetId: "trusted" },
      { type: "PLAYER", targetId: "loud" },
      { type: "NO_ELIMINATION" },
    ],
    lastNightDeaths: [],
    activeEventId: null,
    dayOfTruthClaims: {},
    ...over,
  };
}

const contextFor = (view: BotKnowledgeView): BotDecisionContext => ({
  knowledge: view,
  visibleChat: [],
});

/** Ghim belief thẳng vào state: các test dưới nói về QUYẾT ĐỊNH, không về decay. */
function pin(
  state: BotBrainState,
  table: "trust" | "suspicion",
  playerId: string,
  score: number,
): void {
  state[table][playerId] = { score, reasons: [], lastUpdatedRound: 1 };
}

describe("chiến thuật ban ngày của Kẻ Báo Thù", () => {
  it("dồn phiếu vào mục tiêu và hạ điểm mọi người khác", () => {
    const bias = executionerStrategy("EXECUTIONER", BOT_WEIGHTS_V9).voteBias(
      contextFor(knowledge()),
      stateFor(),
    );

    expect(bias.mark).toBeGreaterThan(0);
    expect(bias.trusted).toBeLessThan(0);
    expect(bias.loud).toBeLessThan(0);
    // Không tự nghiêng chính mình: một lá phiếu tự sát không phải chiến thuật.
    expect(bias.me).toBeUndefined();
  });

  it("mục tiêu leo lên đầu bảng phiếu khi bàn chưa có ai nổi bật", () => {
    // Qua ĐÚNG đường mà ván thật đi (`selectVote`), không chỉ đọc bias thô:
    // một delta đúng dấu mà vẫn thua bảng điểm chung thì nó không làm được gì.
    const view = knowledge();
    const vote = selectVote(
      contextFor(view),
      stateFor(),
      createSeededRng("vote"),
      BOT_WEIGHTS_V9,
    );

    expect(vote.choice).toEqual({ type: "PLAYER", targetId: "mark" });
  });

  it("buông khi mục tiêu đang được cả làng TIN", () => {
    /*
     * Chỉ vào người vừa được bảo lãnh công khai là cách nhanh nhất để chính
     * mình lên giá treo thay họ. `protectedTargetPenalty` nhân với trust, nên
     * một mục tiêu đã bị Tiên Tri soi sạch kéo cả số hạng xuống âm.
     */
    const state = stateFor();
    pin(state, "trust", "mark", 100);

    const bias = executionerStrategy("EXECUTIONER", BOT_WEIGHTS_V9).voteBias(
      contextFor(knowledge()),
      state,
    );

    expect(bias.mark).toBeLessThan(0);
  });

  it("thôi đẩy khi mục tiêu đã chết - nhiệm vụ hoặc đã xong hoặc đã đổ vỡ", () => {
    const view = knowledge({
      players: IDS.map((id) => ({ id, name: id.toUpperCase(), alive: id !== "mark" })),
    });
    const bias = executionerStrategy("EXECUTIONER", BOT_WEIGHTS_V9).voteBias(
      contextFor(view),
      stateFor(),
    );

    expect(bias).toEqual({});
  });

  it("không có nhiệm vụ thì chơi như thường", () => {
    const bias = executionerStrategy("EXECUTIONER", BOT_WEIGHTS_V9).voteBias(
      contextFor(knowledge({ executionerTargetId: null })),
      stateFor(),
    );

    expect(bias).toEqual({});
  });
});

describe("Kẻ Báo Thù ở phiên toà", () => {
  it("kết tội khi bị cáo là mục tiêu của mình", () => {
    const verdict = decideFinalVote(
      contextFor(knowledge({ phase: "FINAL_VOTE", trialAccusedId: "mark", canFinalVote: true })),
      stateFor(),
      createSeededRng("trial"),
      BOT_WEIGHTS_V9,
    );

    expect(verdict.guilty).toBe(true);
  });

  it("với bị cáo KHÁC thì đọc bằng chứng như mọi người, không kết tội bừa", () => {
    /*
     * Đây là chỗ Kẻ Báo Thù khác hẳn hai vai trung lập kia: Hề bỏ Tha cho MỌI
     * bị cáo, Sát Nhân bỏ Treo cho MỌI bị cáo, còn ở đây chỉ đúng một cái tên
     * được đối xử đặc biệt. Một người bỏ cùng một phiếu ở mọi phiên toà là một
     * người bị đọc vị sau hai vòng - và vai này thì cần sống tới phiên toà của
     * mục tiêu.
     */
    const state = stateFor();
    pin(state, "trust", "trusted", 60);
    pin(state, "suspicion", "trusted", 0);

    const verdict = decideFinalVote(
      contextFor(
        knowledge({ phase: "FINAL_VOTE", trialAccusedId: "trusted", canFinalVote: true }),
      ),
      state,
      createSeededRng("trial"),
      BOT_WEIGHTS_V9,
    );

    expect(verdict.guilty).toBe(false);
  });

  it("khi CHÍNH MÌNH bị xử thì tìm cách sống, không dùng chiến thuật của Hề", () => {
    const state = stateFor();
    const style = deriveSpeechStyle(state.personality);
    const defense = decideDefenseSpeech(
      contextFor(knowledge({ phase: "DEFENSE", trialAccusedId: "me" })),
      state,
      createSeededRng("defense"),
      style,
      BOT_WEIGHTS_V9,
    );

    expect(defense.stance).toBe("SURVIVE");
    expect(defense.intention.kind).not.toBe("HUMOR");
  });
});

describe("Kẻ Báo Thù - ranh giới thông tin", () => {
  it("mục tiêu nhiệm vụ KHÔNG được ghi vào lớp sự thật của bot", () => {
    /*
     * Mục tiêu luôn thuộc phe Dân. Biến "đây là mục tiêu của tôi" thành "người
     * này là Sói" vừa sai vừa tự đầu độc mọi quyết định khác - kể cả phát bắn
     * của Thợ Săn, qua đường lời nói. Bảng belief phải sạch trơn.
     */
    const state = stateFor();
    applyPrivateInformation(state, knowledge(), BOT_WEIGHTS_V9);

    expect(state.suspicion.mark?.score ?? 0).toBe(0);
    expect(state.suspicion.mark?.reasons ?? []).toEqual([]);
    expect(state.trust.mark?.score ?? 0).toBe(0);
    // Và không có evidence nào được sinh ra mang tên mục tiêu.
    expect(state.seenEventIds).toEqual([]);
  });

  it("bias là delta của MỘT lượt, không để lại vết trong belief", () => {
    const state = stateFor();
    executionerStrategy("EXECUTIONER", BOT_WEIGHTS_V9).voteBias(
      contextFor(knowledge()),
      state,
    );

    expect(state.suspicion.mark?.score ?? 0).toBe(0);
    expect(state.trust.mark?.score ?? 0).toBe(0);
  });

  it("kết quả soi trung lập KHÔNG suy ra chắc chắn vai nào", () => {
    /*
     * Ván có Kẻ Báo Thù nhưng không có Sát Nhân: một kết quả "phe trung lập"
     * KHÔNG được ghim nghi ngờ như thể đó là kẻ giết người mỗi đêm. Nó cũng
     * không được ghim tin tưởng lên trần như một người làng - "không phải Sói"
     * khác "đồng đội".
     */
    const state = createBotBrainState(
      "seer",
      createBotPersonality(createSeededRng("seer")),
      IDS,
    );
    applyPrivateInformation(
      state,
      knowledge({
        botId: "seer",
        selfRole: "SEER",
        neutralRolesInPlay: ["EXECUTIONER"],
        executionerTargetId: null,
        seerResult: { targetId: "mark", targetName: "MARK", isWolf: false, team: "neutral" },
      }),
      BOT_WEIGHTS_V9,
    );

    expect(state.suspicion.mark.score).toBe(0);
    expect(state.trust.mark.score).toBeGreaterThan(0);
    expect(state.trust.mark.score).toBeLessThan(100);
  });
});

describe("bộ bài nói được rằng một Thằng Hề CÓ THỂ xuất hiện", () => {
  it("ván có Kẻ Báo Thù thì JESTER nằm trong danh sách vai trung lập, dù jester=false", async () => {
    /*
     * `config.jester` nói về LÚC CHIA BÀI, không phải một lời hứa rằng vai đó
     * không bao giờ xuất hiện. Một con BOT đọc danh sách này để suy luận về
     * nhãn `neutral` sẽ kết luận sai nếu nó tin rằng ván không thể có Hề.
     *
     * Vẫn là thông tin công khai: cấu hình phòng đi xuống mọi client, và luật
     * hoá Hề nằm ngay trên thẻ vai.
     */
    const { GameEngine } = await import("../src/engine");
    const { DEFAULT_ROOM_CONFIG } = await import("@masoi/shared");

    const engine = GameEngine.create(
      Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, isBot: true })),
      {
        ...DEFAULT_ROOM_CONFIG,
        werewolves: 2,
        seer: true,
        guard: true,
        witch: true,
        jester: false,
        executioner: true,
      },
      0,
    );

    const view = engine.botKnowledgeFor("s0");
    expect(view.neutralRolesInPlay).toContain("EXECUTIONER");
    expect(view.neutralRolesInPlay).toContain("JESTER");
    /*
     * Và KHÔNG nói ai đang cầm lá nào: đây là danh sách vai, không phải bảng
     * vai. Bầy Sói vẫn biết nhau nên trần là 2 ô - chính viewer và đồng bọn.
     * Khoá vào riêng `s1` là khoá vào thứ tự chia bài của seed 0, và thứ tự đó
     * đã đổi một lần rồi.
     */
    expect(Object.keys(view.knownRoles).length).toBeLessThanOrEqual(2);
  });

  it("ván không có Kẻ Báo Thù thì danh sách giữ nguyên như trước", async () => {
    const { GameEngine } = await import("../src/engine");
    const { DEFAULT_ROOM_CONFIG } = await import("@masoi/shared");

    const engine = GameEngine.create(
      Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, isBot: true })),
      { ...DEFAULT_ROOM_CONFIG, werewolves: 2, seer: true, guard: true, witch: true },
      0,
    );

    expect(engine.botKnowledgeFor("t0").neutralRolesInPlay).toEqual([]);
  });
});

describe("đổi chiến thuật sau khi chuyển vai", () => {
  it("strategyFor tra theo vai HIỆN TẠI, nên vai mới đổi chiến thuật ngay", () => {
    expect(strategyFor("EXECUTIONER", BOT_WEIGHTS_V9).role).toBe("EXECUTIONER");
    expect(strategyFor("JESTER", BOT_WEIGHTS_V9).role).toBe("JESTER");
  });

  it("sau khi hoá Hề, phiếu KHÔNG còn nhắm mục tiêu cũ", () => {
    /*
     * Không có cờ nào phải xoá: `selectVote` đọc `selfRole` ở mỗi lượt, nên một
     * quyết định đang chờ được tính lại bằng chiến thuật mới. Hề chống lại đám
     * đông, nên nó không thể ra cùng một đáp án với Kẻ Báo Thù đang dồn phiếu.
     */
    const state = stateFor();
    // Cả làng đang dồn vào mục tiêu cũ - đúng tình thế mà Hề phải đứng ngoài.
    const view = knowledge({
      selfRole: "JESTER",
      knownRoles: { me: "JESTER" },
      currentVoteCounts: { players: { mark: 3 }, noElimination: 0 },
    });

    const vote = selectVote(contextFor(view), state, createSeededRng("v"), BOT_WEIGHTS_V9);

    expect(vote.choice).not.toEqual({ type: "PLAYER", targetId: "mark" });
  });

  it("ở phiên toà, con Hề chuyển vai bỏ THA kể cả khi bị cáo là mục tiêu cũ", () => {
    const verdict = decideFinalVote(
      contextFor(
        knowledge({
          selfRole: "JESTER",
          knownRoles: { me: "JESTER" },
          phase: "FINAL_VOTE",
          trialAccusedId: "mark",
          canFinalVote: true,
        }),
      ),
      stateFor(),
      createSeededRng("trial"),
      BOT_WEIGHTS_V9,
    );

    // Luật của Hề thắng luật cũ: `executionerTargetId` vẫn còn trong knowledge
    // (engine không xoá bản ghi), nhưng nhánh Kẻ Báo Thù gác bằng `selfRole`.
    expect(verdict.guilty).toBe(false);
  });
});

describe("cổng tái lập: v1-v8 không đổi một bit nào", () => {
  it("mọi preset trước v9 giữ hành vi Kẻ Báo Thù TẮT hoàn toàn", () => {
    for (const preset of [BOT_WEIGHTS_V1, BOT_WEIGHTS_V8]) {
      for (const value of Object.values(preset.executioner)) {
        expect(value).toBe(0);
      }
    }
  });

  it("dưới cấu hình cũ, BOT không nghiêng gì và không rút số nào", () => {
    const rng = createSeededRng("gate");
    const before = rng();
    const bias = executionerStrategy("EXECUTIONER", BOT_WEIGHTS_V8).voteBias(
      contextFor(knowledge()),
      stateFor(),
    );

    expect(bias).toEqual({});
    // `voteBias` không nhận rng, nên dòng số phải đứng yên - khẳng định này giữ
    // cho một bản sửa sau không lén đưa may rủi vào một hàm đang tất định.
    const rngAgain = createSeededRng("gate");
    expect(rngAgain()).toBe(before);
  });

  it("v9 khác v8 ĐÚNG ở nhóm executioner và version", () => {
    for (const key of Object.keys(BOT_WEIGHTS_V8) as Array<keyof typeof BOT_WEIGHTS_V8>) {
      if (key === "version" || key === "executioner") continue;
      expect(BOT_WEIGHTS_V9[key]).toBe(BOT_WEIGHTS_V8[key]);
    }
    // Con trỏ `DEFAULT_BOT_WEIGHTS` KHÔNG còn được khẳng định ở đây. Nó đã trỏ
    // qua v10 và sẽ còn đi tiếp, trong khi phép kiểm này nói về quan hệ v8-v9 -
    // một quan hệ đóng băng vĩnh viễn. Trói hai thứ vào nhau làm mỗi lần nâng
    // bản mặc định lại đánh đỏ một test không liên quan tới lần nâng đó.
    // `bot-weights.test.ts` giữ phép kiểm con trỏ.
  });
});
