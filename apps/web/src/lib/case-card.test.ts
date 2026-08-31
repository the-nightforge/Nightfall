import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CaseFile, CaseHighlight } from "@masoi/shared";
import { buildCaseCardModel, CARD_TEXT_MAX, SHARE_TEXT_MAX, truncate } from "./case-card";

const ORIGIN = "https://ma-soi.example";

/** id dạng cuid như server thật sinh ra, để test rò rỉ có ý nghĩa. */
const IDS = {
  wolf: "clx8k2m4a0001qw3f7t9h2p6z",
  villager: "clx8k2m4a0002qw3f7t9h2p7a",
  hunter: "clx8k2m4a0003qw3f7t9h2p8b",
};

function highlight(over: Partial<CaseHighlight> = {}): CaseHighlight {
  return {
    type: "INNOCENT_LYNCHED",
    round: 2,
    phase: "day",
    title: "Án oan giữa ban ngày",
    description: "Làng treo cổ Bảy Tàng với 4 phiếu Treo trên 1 phiếu Tha. Bảy Tàng là Dân Làng, phe Dân Làng.",
    participants: [IDS.villager],
    importance: 92,
    evidence: { kind: "lynch", accusedId: IDS.villager, guilty: 4, innocent: 1, abstain: 0 },
    ...over,
  };
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
      { id: IDS.hunter, name: "Thợ Săn", role: "HUNTER", originRole: "HUNTER", team: "village", alive: true, isBot: false },
    ],
    highlights: [highlight()],
    timeline: [],
    fallback: false,
    ...over,
  };
}

describe("truncate", () => {
  it("giữ nguyên chuỗi ngắn hơn giới hạn", () => {
    assert.equal(truncate("ngắn", 20), "ngắn");
  });

  it("cắt chuỗi dài và gắn dấu lược", () => {
    const out = truncate("A".repeat(50), 10);
    assert.equal(out.length, 10);
    assert.ok(out.endsWith("…"));
  });

  it("không cắt đôi ký tự emoji", () => {
    const out = truncate("🐺🌙🕯️🔪🩸", 3);
    // Cắt theo code point, nên không bao giờ sinh ra nửa cặp thay thế.
    assert.ok(!out.includes("�"));
    assert.ok(out.startsWith("🐺"));
  });

  it("đếm theo ký tự người đọc thấy, không theo đơn vị UTF-16", () => {
    assert.equal(truncate("🐺🐺🐺", 3), "🐺🐺🐺");
  });
});

describe("buildCaseCardModel", () => {
  it("dựng tiêu đề và dòng phụ từ đúng dữ liệu hồ sơ", () => {
    const model = buildCaseCardModel(caseFile(), { shareOrigin: ORIGIN });
    assert.equal(model.caseId, "HS-7QK4M");
    assert.equal(model.winner, "village");
    assert.ok(model.headline.includes("Dân Làng"));
    assert.ok(model.subline.includes("4"));
    assert.ok(model.subline.includes("3"));
  });

  it("mỗi điểm ngoặt thành đúng một dòng thẻ", () => {
    const model = buildCaseCardModel(
      caseFile({
        highlights: [
          highlight({ round: 1, phase: "night", title: "Đêm đẫm máu" }),
          highlight({ round: 2, phase: "day" }),
          highlight({ round: 3, phase: "day", title: "Phát đạn cuối cùng" }),
        ],
      }),
      { shareOrigin: ORIGIN },
    );
    assert.equal(model.lines.length, 3);
    assert.equal(model.lines[0].moment, "Đêm 1");
    assert.equal(model.lines[1].moment, "Ngày 2");
    assert.equal(model.lines[2].title, "Phát đạn cuối cùng");
  });

  it("giữ được 5 điểm ngoặt mà không cắt bớt dòng", () => {
    const model = buildCaseCardModel(
      caseFile({ highlights: [1, 2, 3, 4, 5].map((round) => highlight({ round })) }),
      { shareOrigin: ORIGIN },
    );
    assert.equal(model.lines.length, 5);
  });

  it("trạng thái fallback vẫn dựng được đúng một dòng", () => {
    const model = buildCaseCardModel(
      caseFile({
        fallback: true,
        highlights: [
          highlight({
            type: "QUIET_MATCH",
            title: "Một vụ án khép nhanh",
            description: "Phe Dân Làng thắng sau 1 vòng.",
            participants: [],
          }),
        ],
      }),
      { shareOrigin: ORIGIN },
    );
    assert.equal(model.lines.length, 1);
    assert.ok(model.shareText.includes("Một vụ án khép nhanh") || model.shareText.includes("khép nhanh"));
  });

  it("cắt mô tả dài ở model, để bản xem trước và ảnh không lệch nhau", () => {
    const model = buildCaseCardModel(
      caseFile({ highlights: [highlight({ description: "Đ".repeat(400) })] }),
      { shareOrigin: ORIGIN },
    );
    assert.ok(Array.from(model.lines[0].text).length <= CARD_TEXT_MAX);
  });

  it("biệt danh rất dài không phá dòng thẻ", () => {
    const long = "Ngườichơicóbiệtdanhcựckỳdàikhôngaiđọchết".repeat(6);
    const model = buildCaseCardModel(
      caseFile({ highlights: [highlight({ description: `Làng treo cổ ${long}.` })] }),
      { shareOrigin: ORIGIN },
    );
    assert.ok(Array.from(model.lines[0].text).length <= CARD_TEXT_MAX);
    for (const line of model.shareText.split("\n")) {
      assert.ok(Array.from(line).length <= SHARE_TEXT_MAX + 20);
    }
  });
});

describe("nội dung chia sẻ", () => {
  it("có lời mời và địa chỉ trang chủ", () => {
    const model = buildCaseCardModel(caseFile(), { shareOrigin: ORIGIN });
    assert.ok(model.shareText.includes(ORIGIN));
    assert.ok(model.cta.length > 0);
  });

  it("không chứa playerId nội bộ", () => {
    const file = caseFile();
    const model = buildCaseCardModel(file, { shareOrigin: ORIGIN });
    for (const player of file.cast) {
      assert.ok(!model.shareText.includes(player.id), `rò rỉ id ${player.id}`);
      assert.ok(!JSON.stringify(model.lines).includes(player.id), `rò rỉ id ${player.id} trong dòng thẻ`);
    }
  });

  it("không chứa mã phòng - CaseFile vốn không mang mã phòng", () => {
    const model = buildCaseCardModel(caseFile(), { shareOrigin: ORIGIN });
    assert.ok(!/\b[A-Z0-9]{5}\b/.test(model.shareText.replace("HS-7QK4M", "")));
  });

  it("mang biệt danh hiển thị, vì đó mới là thứ đáng chia sẻ", () => {
    const model = buildCaseCardModel(caseFile(), { shareOrigin: ORIGIN });
    assert.ok(model.shareText.includes("Bảy Tàng"));
  });

  it("nêu phe thắng và số vòng", () => {
    const model = buildCaseCardModel(caseFile(), { shareOrigin: ORIGIN });
    assert.ok(model.shareText.includes("Dân Làng"));
    assert.ok(model.shareText.includes("4"));
  });

  it("origin nào vào thì origin đó ra, không hardcode", () => {
    const model = buildCaseCardModel(caseFile(), { shareOrigin: "http://localhost:3000" });
    assert.ok(model.shareText.includes("http://localhost:3000"));
    assert.ok(!model.shareText.includes("ma-soi.example"));
  });
});
