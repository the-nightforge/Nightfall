import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ACCENT_HEX, CURSED_HEX, EFFECT_HEX, SCENE_HEX, hexToCss } from "./village-memory-palette";
import type { VillageAccent, VillageEffect } from "./village-memory";

describe("bảng màu", () => {
  it("mọi sắc vai và mọi hiệu ứng đều có màu", () => {
    const accents: VillageAccent[] = ["wolf", "guard", "seer", "witch", "hunter", "villager"];
    for (const accent of accents) {
      assert.equal(typeof ACCENT_HEX[accent], "number", accent);
    }
    const effects: VillageEffect[] = [
      "WOLF_ATTACK",
      "SHIELD_SAVE",
      "WITCH_HEAL",
      "WITCH_POISON",
      "SEER_BEAM",
      "HUNTER_SHOT",
      "LYNCH",
      "TRIAL_SCALES",
      "CURSED_MOON",
      "LONE_LIGHT",
      "GENERIC",
    ];
    for (const effect of effects) {
      assert.equal(typeof EFFECT_HEX[effect], "number", effect);
    }
  });

  it("phe Sói đỏ sẫm, Bảo Vệ xanh lam, Phù Thuỷ xanh lục", () => {
    assert.equal(hexToCss(ACCENT_HEX.wolf), "#8f1220");
    assert.equal(hexToCss(ACCENT_HEX.guard), "#2f6fd0");
    assert.equal(hexToCss(ACCENT_HEX.witch), "#3fbf7a");
  });

  it("mã màu luôn đủ sáu chữ số cho CSS", () => {
    assert.equal(hexToCss(0x0000ff), "#0000ff");
    assert.equal(hexToCss(0), "#000000");
  });
});

describe("tông của cảnh", () => {
  /** Độ sáng cảm nhận, thang 0-1. Đủ chính xác để so ba khối với nhau. */
  const luma = (hex: number) => {
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  it("mái, tường và cây tách được nhau ra khỏi nền", () => {
    /*
     * Đây là điều kiện SỐ của lời hứa "không để mái nhà, thân nhà và cây hoà
     * thành một mảng đen". Ánh sáng làm phần còn lại, nhưng nếu ba màu gốc đã
     * nằm chồng lên nhau thì không nguồn sáng nào cứu được.
     */
    const wall = luma(SCENE_HEX.wall);
    const roof = luma(SCENE_HEX.roof);
    const tree = luma(SCENE_HEX.treeNear);
    const sky = luma(SCENE_HEX.sky);
    for (const [name, value] of [
      ["tường", wall],
      ["mái", roof],
      ["cây", tree],
    ] as const) {
      assert.ok(value > sky * 1.6, `${name} phải sáng hơn hẳn nền trời`);
    }
    assert.ok(wall - roof > 0.03, "tường và mái không được cùng một độ sáng");
    assert.ok(luma(SCENE_HEX.chimney) > roof * 1.6, "ống khói phải bắt sáng rõ hơn mái");
  });

  it("ô cửa sáng là điểm ẤM duy nhất, và sáng hơn mọi thứ khác trong làng", () => {
    assert.ok(luma(SCENE_HEX.windowLit) > luma(SCENE_HEX.wall) * 2.5);
    // Ấm nghĩa là đỏ nhiều hơn xanh lam; cả bảng còn lại thì ngược lại.
    const warm = (hex: number) => ((hex >> 16) & 0xff) - (hex & 0xff);
    assert.ok(warm(SCENE_HEX.windowLit) > 60);
    assert.ok(warm(SCENE_HEX.wall) < 0);
    assert.ok(warm(SCENE_HEX.sky) < 0);
  });

  it("nền đất có ba nấc, sáng dần vào giữa", () => {
    assert.ok(luma(SCENE_HEX.groundOuter) < luma(SCENE_HEX.groundMid));
    assert.ok(luma(SCENE_HEX.groundMid) < luma(SCENE_HEX.square));
  });

  it("trăng bị nguyền ngả đỏ nhưng không thành một màu đỏ chói", () => {
    const red = (hex: number) => (hex >> 16) & 0xff;
    const blue = (hex: number) => hex & 0xff;
    assert.ok(red(CURSED_HEX.moon) > blue(CURSED_HEX.moon), "lõi trăng ngả ấm");
    assert.ok(red(CURSED_HEX.moonHalo) > blue(CURSED_HEX.moonHalo), "quầng ngả đỏ");
    assert.ok(red(SCENE_HEX.moon) < blue(SCENE_HEX.moon), "trăng thường thì lạnh");
    // Ánh môi trường chỉ ĐỔI SẮC, không sáng thêm: cả cảnh đỏ rực lên thì không
    // còn đọc được hình khối nào nữa.
    assert.ok(luma(CURSED_HEX.ambient) <= luma(SCENE_HEX.ambient));
    assert.ok(luma(CURSED_HEX.moonLight) <= luma(SCENE_HEX.moonLight));
  });
});

describe("tách chunk", () => {
  /*
   * Ba khẳng định ở cấp MÃ NGUỒN, và chúng là cách duy nhất ghim được một tính
   * chất của bản dựng bằng một bộ test chạy trong `node:test`.
   *
   * Lỗi mà chúng canh là lỗi đã từng xảy ra thật: `VillageMemoryExperience`
   * `import` `EFFECT_HEX` từ `village-memory-webgl`, và một import tĩnh kéo cả
   * nghìn dòng dựng Three.js vào chunk của component - kể cả cho người rơi về
   * bản dự phòng 2D. Chuyện đó không lộ ra ở bất kỳ test hành vi nào; chỉ có
   * hình dạng của đồ thị import mới nói được.
   */
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const staticImports = (source: string) =>
    [...source.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map((match) => match[1]);

  it("module bảng màu không kéo theo three", () => {
    const source = read("./village-memory-palette.ts");
    for (const specifier of staticImports(source)) {
      assert.notEqual(specifier, "three", "bảng màu phải nạp được mà không có three");
    }
    // Bản thân việc file test này `import` được bảng màu trong `node:test` -
    // nơi không có WebGL và không có DOM - đã là một nửa khẳng định.
    assert.equal(typeof hexToCss(ACCENT_HEX.wolf), "string");
  });

  it("không component nào import tĩnh bản dựng cảnh", () => {
    for (const file of [
      "../components/VillageMemoryExperience.tsx",
      "../components/VillageRoster.tsx",
      "../components/GameOverView.tsx",
    ]) {
      const source = read(file);
      assert.ok(
        !staticImports(source).some((specifier) => specifier.includes("village-memory-webgl")),
        `${file} phải để bản dựng cảnh nằm sau một import động`,
      );
    }
  });

  it("bản dựng cảnh chỉ tới được qua import động, và nó không import tĩnh three", () => {
    const canvas = read("../components/VillageMemoryCanvas.tsx");
    assert.ok(
      !staticImports(canvas).some((specifier) => specifier.includes("village-memory-webgl")),
      "VillageMemoryCanvas cũng chỉ được nạp nó khi thật sự dựng 3D",
    );
    assert.ok(canvas.includes('import("@/lib/village-memory-webgl")'));
    assert.ok(canvas.includes('import("three")'));

    const webgl = read("./village-memory-webgl.ts");
    for (const specifier of staticImports(webgl)) {
      assert.notEqual(specifier, "three", "three chỉ được nạp cùng chunk, không phải trước nó");
    }
  });
});
