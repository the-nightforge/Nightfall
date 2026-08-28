import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "@masoi/shared";

/**
 * Ranh giới bảo mật cho ban đêm.
 *
 * Task này MỞ RỘNG thông tin BOT nhìn thấy, nên nó là chỗ dễ rò rỉ nhất trong
 * cả Phase 2. Test bảo mật viết trước test tính năng: nếu một trong các assert
 * dưới đây đỏ, đó là lỗ hổng chứ không phải tính năng thiếu.
 */

const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 2,
  seer: true,
  guard: true,
  witch: true,
  hunter: false,
  nightSeconds: 30,
};

const FIXED_ROLES = [
  "WEREWOLF",
  "WEREWOLF",
  "SEER",
  "GUARD",
  "WITCH",
  "VILLAGER",
] as const;

const ROLE_CODES = [
  "WEREWOLF",
  "SEER",
  "GUARD",
  "WITCH",
  "HUNTER",
  "CURSED",
  "VILLAGER",
] as const;

function nightEngine() {
  const engine = GameEngine.create(
    Array.from({ length: 6 }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Người ${i + 1}`,
      isBot: true,
    })),
    CONFIG,
  );
  engine.state.players.forEach((player, i) => {
    player.role = FIXED_ROLES[i];
  });
  engine.setPhase("NIGHT", 30_000, 0);
  return engine;
}

const idOf = (engine: GameEngine, role: string) =>
  engine.state.players.find((p) => p.role === role)!.id;

const wolvesOf = (engine: GameEngine) =>
  engine.state.players.filter((p) => p.role === "WEREWOLF").map((p) => p.id);

describe("NightKnowledge · ranh giới bảo mật", () => {
  it("Dân Làng không nhận thông tin đêm nào", () => {
    // Dân không có hành động đêm. Cho họ thấy legalTargets là nói cho họ biết
    // đêm nay ai đang được cân nhắc - thứ họ không có quyền biết.
    const e = nightEngine();
    expect(e.botKnowledgeFor(idOf(e, "VILLAGER")).night).toBeNull();
  });

  it("người chết không nhận thông tin đêm", () => {
    const e = nightEngine();
    const seer = idOf(e, "SEER");
    e.mustPlayer(seer).alive = false;

    expect(e.botKnowledgeFor(seer).night).toBeNull();
  });

  it("ngoài pha đêm thì không ai có thông tin đêm", () => {
    const e = nightEngine();
    e.setPhase("DAY_DISCUSSION", 60_000, 0);

    for (const player of e.state.players) {
      expect(e.botKnowledgeFor(player.id).night).toBeNull();
    }
  });

  it("Sói không bao giờ thấy đồng bọn trong danh sách cắn hợp lệ", () => {
    const e = nightEngine();
    const wolves = wolvesOf(e);
    const night = e.botKnowledgeFor(wolves[0]).night!;

    for (const wolf of wolves) {
      expect(night.legalTargets.KILL).not.toContain(wolf);
    }
    expect(night.legalTargets.KILL.length).toBeGreaterThan(0);
  });

  it("guardPrevious chỉ lộ cho Bảo Vệ", () => {
    const e = nightEngine();
    e.state.guardPrevious = idOf(e, "WITCH");

    expect(e.botKnowledgeFor(idOf(e, "GUARD")).night!.guardPrevious).toBe(
      idOf(e, "WITCH"),
    );
    expect(e.botKnowledgeFor(idOf(e, "SEER")).night!.guardPrevious).toBeNull();
    expect(e.botKnowledgeFor(wolvesOf(e)[0]).night!.guardPrevious).toBeNull();
  });

  it("Phù Thuỷ chỉ biết nạn nhân SAU khi bầy Sói khoá phiếu", () => {
    const e = nightEngine();
    const witch = idOf(e, "WITCH");
    e.state.night.killTarget = idOf(e, "VILLAGER");

    e.state.night.wolvesLocked = false;
    expect(e.botKnowledgeFor(witch).night!.wolfTarget).toBeNull();

    e.state.night.wolvesLocked = true;
    expect(e.botKnowledgeFor(witch).night!.wolfTarget).toBe(idOf(e, "VILLAGER"));
  });

  it("Tiên Tri và Bảo Vệ không bao giờ biết nạn nhân của Sói", () => {
    const e = nightEngine();
    e.state.night.killTarget = idOf(e, "VILLAGER");
    e.state.night.wolvesLocked = true;

    expect(e.botKnowledgeFor(idOf(e, "SEER")).night!.wolfTarget).toBeNull();
    expect(e.botKnowledgeFor(idOf(e, "GUARD")).night!.wolfTarget).toBeNull();
  });

  it("trạng thái bình thuốc chỉ lộ cho Phù Thuỷ", () => {
    const e = nightEngine();
    e.state.healUsed = true;
    e.state.poisonUsed = true;

    const witchNight = e.botKnowledgeFor(idOf(e, "WITCH")).night!;
    expect(witchNight.healUsed).toBe(true);
    expect(witchNight.poisonUsed).toBe(true);

    const seerNight = e.botKnowledgeFor(idOf(e, "SEER")).night!;
    expect(seerNight.healUsed).toBe(false);
    expect(seerNight.poisonUsed).toBe(false);
  });

  it("không NightKnowledge nào chứa mã vai của bất kỳ ai", () => {
    const e = nightEngine();
    e.state.night.killTarget = idOf(e, "VILLAGER");
    e.state.night.wolvesLocked = true;

    for (const player of e.state.players) {
      const night = e.botKnowledgeFor(player.id).night;
      if (!night) continue;

      // Chỉ soi GIÁ TRỊ, không soi khoá: "GUARD" vừa là tên vai vừa là tên một
      // hành động đêm, nên khoá `legalTargets.GUARD` là hợp lệ. Thứ không được
      // phép xuất hiện là một mã vai nằm ở vị trí dữ liệu.
      const values = JSON.stringify([
        night.legalActions,
        Object.values(night.legalTargets),
        night.wolfTarget,
        night.guardPrevious,
      ]);
      for (const code of ROLE_CODES) {
        if (code === "GUARD") continue; // trùng tên với hành động, xử lý riêng
        expect(values).not.toContain(code);
      }
      // Không id người chơi nào được trùng một mã vai, nên "GUARD" chỉ có thể
      // xuất hiện trong legalActions.
      expect(JSON.stringify(Object.values(night.legalTargets))).not.toContain("GUARD");
    }
  });

  it("Tiên Tri không thể soi lại chính mình", () => {
    const e = nightEngine();
    const seer = idOf(e, "SEER");

    expect(e.botKnowledgeFor(seer).night!.legalTargets.SEE).not.toContain(seer);
  });

  it("Bảo Vệ không được đỡ lại mục tiêu đêm trước", () => {
    const e = nightEngine();
    const previous = idOf(e, "WITCH");
    e.state.guardPrevious = previous;

    expect(e.botKnowledgeFor(idOf(e, "GUARD")).night!.legalTargets.GUARD).not.toContain(
      previous,
    );
  });
});

describe("NightKnowledge · nội dung", () => {
  it("mỗi vai chỉ được chào đúng hành động của mình", () => {
    const e = nightEngine();

    expect(e.botKnowledgeFor(wolvesOf(e)[0]).night!.legalActions).toEqual(["KILL"]);
    expect(e.botKnowledgeFor(idOf(e, "SEER")).night!.legalActions).toEqual(["SEE"]);
    expect(e.botKnowledgeFor(idOf(e, "GUARD")).night!.legalActions).toEqual(["GUARD"]);
  });

  it("Phù Thuỷ chưa được chào hành động nào TRƯỚC khi bầy Sói khoá phiếu", () => {
    // Engine ném "Chưa tới lượt Phù Thuỷ" cho MỌI hành động, kể cả SKIP, khi
    // `wolvesLocked === false`. Chào một hành động trong lúc engine sẽ từ chối
    // là nói dối với lõi AI, và lượt đêm mất trắng vì một nước đi hợp lệ trên
    // giấy. Lỗ hổng này do harness mô phỏng ở Task 9 phát hiện.
    const e = nightEngine();

    expect(e.botKnowledgeFor(idOf(e, "WITCH")).night!.legalActions).toEqual([]);
  });

  it("sau khi khoá phiếu, Phù Thuỷ được chào SKIP và HEAL khi có nạn nhân", () => {
    const e = nightEngine();
    const witch = idOf(e, "WITCH");
    e.state.night.wolvesLocked = true;

    expect(e.botKnowledgeFor(witch).night!.legalActions).toContain("SKIP");
    expect(e.botKnowledgeFor(witch).night!.legalActions).not.toContain("HEAL");

    e.state.night.killTarget = idOf(e, "VILLAGER");
    expect(e.botKnowledgeFor(witch).night!.legalActions).toContain("HEAL");
  });

  it("hết bình thì hành động tương ứng không còn được chào", () => {
    const e = nightEngine();
    const witch = idOf(e, "WITCH");
    e.state.night.wolvesLocked = true;
    e.state.poisonUsed = true;

    expect(e.botKnowledgeFor(witch).night!.legalActions).not.toContain("POISON");
  });

  it("canAct false khi vai đã hành động xong", () => {
    const e = nightEngine();
    const seer = idOf(e, "SEER");
    e.submitNightAction(seer, "SEE", idOf(e, "VILLAGER"));

    expect(e.botKnowledgeFor(seer).night!.canAct).toBe(false);
  });

  it("legalTargets là bản sao: sửa nó không ghi ngược vào engine", () => {
    const e = nightEngine();
    const night = e.botKnowledgeFor(wolvesOf(e)[0]).night!;
    night.legalTargets.KILL.push("HACKED");

    expect(e.botKnowledgeFor(wolvesOf(e)[0]).night!.legalTargets.KILL).not.toContain(
      "HACKED",
    );
  });
});
