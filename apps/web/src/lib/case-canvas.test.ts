import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CaseFile } from "@masoi/shared";
import { buildCaseCardModel } from "./case-card";
import { CARD_HEIGHT, CARD_WIDTH, paintCaseCard, wrapText } from "./case-canvas";

const ORIGIN = "https://ma-soi.example";
const IDS = {
  wolf: "clx8k2m4a0001qw3f7t9h2p6z",
  villager: "clx8k2m4a0002qw3f7t9h2p7a",
};

/**
 * Context giả ghi lại mọi lệnh vẽ.
 *
 * Đủ để khẳng định điều duy nhất thực sự quan trọng ở tầng này: KHÔNG có chuỗi
 * nào lọt vào ảnh mà không đi qua model.
 */
function recorder() {
  const texts: string[] = [];
  const rects: number[][] = [];
  const ctx = {
    fillStyle: "" as unknown,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    save() {},
    restore() {},
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push([x, y, w, h]);
    },
    fillText(text: string) {
      texts.push(text);
    },
    // Bề rộng tuyến tính theo số ký tự: xuống dòng trở nên tất định, test không
    // phụ thuộc vào bộ đo font của một trình duyệt cụ thể.
    measureText(text: string) {
      return { width: Array.from(text).length * 10 };
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    createRadialGradient() {
      return { addColorStop() {} };
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, rects };
}

function caseFile(over: Partial<CaseFile> = {}): CaseFile {
  return {
    version: 1,
    caseId: "HS-7QK4M",
    winner: "village",
    rounds: 4,
    cast: [
      { id: IDS.wolf, name: "Sói Cả", role: "WEREWOLF", originRole: "WEREWOLF", team: "wolves", alive: false, isBot: false },
      { id: IDS.villager, name: "Bảy Tàng", role: "VILLAGER", originRole: "VILLAGER", team: "village", alive: false, isBot: false },
    ],
    highlights: [
      {
        type: "INNOCENT_LYNCHED",
        round: 2,
        phase: "day",
        title: "Án oan giữa ban ngày",
        description: "Làng treo cổ Bảy Tàng với 4 phiếu Treo trên 1 phiếu Tha.",
        participants: [IDS.villager],
        importance: 92,
        evidence: { kind: "lynch", accusedId: IDS.villager, guilty: 4, innocent: 1, abstain: 0 },
      },
    ],
    timeline: [],
    fallback: false,
    ...over,
  };
}

const FONTS = { display: "Playfair Display, Georgia, serif", sans: "Be Vietnam Pro, system-ui, sans-serif" };

describe("wrapText", () => {
  it("giữ nguyên dòng ngắn", () => {
    const { ctx } = recorder();
    assert.deepEqual(wrapText(ctx, "ngắn gọn", 1000), ["ngắn gọn"]);
  });

  it("ngắt theo từ chứ không ngắt giữa từ", () => {
    const { ctx } = recorder();
    const lines = wrapText(ctx, "một hai ba bốn năm sáu", 100);
    for (const line of lines) assert.ok(!line.startsWith(" ") && !line.endsWith(" "));
    assert.equal(lines.join(" "), "một hai ba bốn năm sáu");
  });

  it("một từ dài hơn cả dòng vẫn được xuống dòng thay vì tràn ra ngoài", () => {
    const { ctx } = recorder();
    const lines = wrapText(ctx, "A".repeat(60), 100);
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(Array.from(line).length <= 10);
  });

  it("chuỗi rỗng cho ra không dòng nào", () => {
    const { ctx } = recorder();
    assert.deepEqual(wrapText(ctx, "   ", 100), []);
  });
});

describe("paintCaseCard", () => {
  const model = buildCaseCardModel(caseFile(), { shareOrigin: ORIGIN });

  it("phủ kín khung 9:16", () => {
    const { ctx, rects } = recorder();
    paintCaseCard(ctx, model, FONTS);
    assert.ok(rects.some(([x, y, w, h]) => x === 0 && y === 0 && w === CARD_WIDTH && h === CARD_HEIGHT));
    assert.equal(CARD_WIDTH / CARD_HEIGHT, 1080 / 1920);
  });

  it("KHÔNG vẽ playerId nào lên ảnh", () => {
    const { ctx, texts } = recorder();
    paintCaseCard(ctx, model, FONTS);
    const drawn = texts.join("\n");
    for (const player of caseFile().cast) {
      assert.ok(!drawn.includes(player.id), `rò rỉ id ${player.id} lên ảnh chia sẻ`);
    }
  });

  it("mọi chữ vẽ ra đều đến từ model hoặc là nhãn tĩnh", () => {
    const { ctx, texts } = recorder();
    paintCaseCard(ctx, model, FONTS);
    const fromModel = [
      model.caseId,
      model.headline,
      model.subline,
      model.cta,
      model.url,
      ...model.lines.flatMap((line) => [line.moment, line.title, line.text]),
    ].join("\n");

    for (const text of texts) {
      const trimmed = text.trim();
      if (trimmed.length === 0) continue;
      const isStatic = /^[A-ZÀ-Ỹ0-9\s·•—–-]+$/u.test(trimmed);
      const inModel = fromModel.includes(trimmed);
      assert.ok(inModel || isStatic, `chữ lạ lọt vào ảnh: ${JSON.stringify(trimmed)}`);
    }
  });

  it("vẽ được biệt danh tiếng Việt có dấu", () => {
    const { ctx, texts } = recorder();
    paintCaseCard(ctx, model, FONTS);
    assert.ok(texts.join("\n").includes("Bảy Tàng"));
  });

  it("vẽ đủ cả 5 điểm ngoặt", () => {
    const many = buildCaseCardModel(
      caseFile({
        highlights: [1, 2, 3, 4, 5].map((round) => ({
          ...caseFile().highlights[0],
          round,
          title: `Điểm ngoặt ${round}`,
        })),
      }),
      { shareOrigin: ORIGIN },
    );
    const { ctx, texts } = recorder();
    paintCaseCard(ctx, many, FONTS);
    for (const round of [1, 2, 3, 4, 5]) {
      assert.ok(texts.some((text) => text.includes(`Điểm ngoặt ${round}`)), `thiếu điểm ngoặt ${round}`);
    }
  });

  it("thẻ fallback vẫn vẽ được, không cần nhánh riêng", () => {
    const quiet = buildCaseCardModel(
      caseFile({
        fallback: true,
        highlights: [
          {
            type: "QUIET_MATCH",
            round: 1,
            phase: "day",
            title: "Một vụ án khép nhanh",
            description: "Phe Dân Làng thắng sau 1 vòng.",
            participants: [],
            importance: 0,
            evidence: { kind: "quiet-match", rounds: 1 },
          },
        ],
      }),
      { shareOrigin: ORIGIN },
    );
    const { ctx, texts } = recorder();
    assert.doesNotThrow(() => paintCaseCard(ctx, quiet, FONTS));
    assert.ok(texts.some((text) => text.includes("khép nhanh")));
  });

  it("biệt danh cực dài không làm vòng lặp vẽ chạy vô hạn", () => {
    const huge = buildCaseCardModel(
      caseFile({
        highlights: [{ ...caseFile().highlights[0], description: "Dài".repeat(300) }],
      }),
      { shareOrigin: ORIGIN },
    );
    const { ctx, texts } = recorder();
    paintCaseCard(ctx, huge, FONTS);
    assert.ok(texts.length < 400);
  });
});
