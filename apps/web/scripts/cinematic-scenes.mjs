/**
 * Mười cảnh chuyển, dựng bằng công thức.
 *
 * Mỗi cảnh là một hàm `draw(buf, t)` với `t` chạy từ 0 tới 1 theo đúng thời
 * lượng mà `KIND_META` trong `src/lib/cinematic-transition.ts` khai báo - clip
 * không được dài hơn cảnh, vì lớp phủ tự tháo đúng giờ và một clip còn dở sẽ bị
 * cắt ngang giữa chừng.
 *
 * Bảng màu lấy nguyên từ `src/app/cinematics.css`. Clip và bản dựng CSS chồng
 * lên nhau trong 300ms mờ chuyển ở `CinematicOverlay`, nên hai bên lệch tông là
 * nhìn thấy ngay bằng mắt thường.
 *
 * Bố cục thì KHÔNG lấy nguyên: bản CSS đặt mặt trăng ở 78% bề rộng, còn clip đi
 * qua `object-cover` và trên màn dọc chỉ còn khoảng 26% bề rộng ở giữa. Mọi
 * tiêu điểm ở đây nằm trong `SAFE_X`.
 */

import {
  HEIGHT,
  WIDTH,
  brightness,
  disc,
  ease,
  easeIn,
  easeOut,
  fillPath,
  glow,
  grain,
  hex,
  lerp,
  mist,
  parsePath,
  polygon,
  rays,
  ring,
  streak,
  verticalGradient,
  vignette,
} from "./cinematic-render.mjs";

/**
 * Chép nguyên từ `src/components/VillageSilhouette.tsx` (viewBox 0 0 800 200).
 * Sửa dãy nhà thì phải sửa cả hai chỗ - và phải dựng lại clip.
 */
const VILLAGE_PATHS = [
  "M0 200V150l18-30 16 30 14-22 15 22 20-34 18 34 22-26 20 26 26-40 24 40h-233z",
  "M560 200v-46l20-32 18 32 16-24 18 24 22-36 20 36 26-28 24 28 26-44 24 44v46H560z",
  "M0 200v-28h84l46-44 46 44h40v-52l52-40 52 40v16h34l40-38 40 38h30v34h72l40-30 40 30h84v30H0z",
];

/** Chép nguyên từ `src/components/WolfMark.tsx` (viewBox 0 0 100 100, even-odd). */
const WOLF_PATH =
  "M12 8 L32 30 C40 26 60 26 68 30 L88 8 L84 40 C90 52 86 66 76 74 L50 95 L24 74 C14 66 10 52 16 40 Z " +
  "M30 46 L42 50 L38 58 L28 52 Z M70 46 L58 50 L62 58 L72 52 Z M50 70 L43 78 L50 83 L57 78 Z";

const village = VILLAGE_PATHS.map(parsePath);
const wolf = parsePath(WOLF_PATH);

/**
 * Dãy nhà trải hết bề rộng, đứng trên mép dưới.
 *
 * Trải hết bề rộng chứ không co vào giữa: nó là đường chân trời, và một đường
 * chân trời hụt hai bên thì thành một hòn đảo. Đây cũng là hình duy nhất trong
 * cả bộ được phép chạm mép - cắt mất vài mái nhà ở rìa không làm mất nghĩa gì.
 */
function drawVillage(buf, { color, alpha, lift = 0 }) {
  const scale = WIDTH / 800;
  const ty = HEIGHT - 200 * scale + lift * HEIGHT;
  for (const rings of village) {
    fillPath(buf, rings, { scale, tx: 0, ty, color, alpha });
  }
}

function drawWolf(buf, { cx, cy, size, color, alpha }) {
  const scale = (size * HEIGHT) / 100;
  fillPath(buf, wolf, {
    scale,
    tx: cx * WIDTH - scale * 50,
    ty: cy * HEIGHT - scale * 50,
    color,
    alpha,
  });
}

/** Ba vuốt móng chéo, quét qua khung theo `t`. */
function claws(buf, t, { color, strength }) {
  for (let i = 0; i < 3; i += 1) {
    // Lệch pha để ba vuốt không đi thành một hàng đều tăm tắp.
    const p = Math.min(1, Math.max(0, t * 1.6 - i * 0.14));
    if (p <= 0) continue;
    const k = easeOut(p);
    const x0 = lerp(0.16, 0.44, k) + i * 0.03;
    const y0 = lerp(-0.1, 0.18, k) + i * 0.12;
    streak(buf, {
      x0,
      y0,
      x1: x0 + 0.42,
      y1: y0 + 0.62,
      width: 0.008,
      color,
      // Loé rồi tắt: vuốt móng là một nhát, không phải một cái đèn.
      strength: strength * Math.sin(Math.PI * p),
    });
  }
}

export const SCENES = {
  /* --- Cạnh pha -------------------------------------------------------- */

  nightfall: {
    durationMs: 1200,
    draw(buf, t) {
      verticalGradient(buf, [
        [0, hex(0x0a1226)],
        [0.55, hex(0x050914)],
        [1, hex(0x02030a)],
      ]);
      // Quầng trăng lạnh, đúng rgba(120,150,220) của .cine-nightfall.
      glow(buf, {
        cx: 0.6,
        cy: 0.2,
        rx: 0.5,
        ry: 0.62,
        color: [120, 150, 220],
        strength: 0.20 * (0.45 + 0.55 * ease(t)),
      });
      // Dải sáng sát chân trời. Không có nó thì dãy nhà đen trên nền đen là
      // đúng một mảng đen, và cảnh mất luôn đường chân trời - thứ duy nhất nói
      // rằng đây là một NGÔI LÀNG lúc trời sập tối.
      glow(buf, {
        cx: 0.5,
        cy: 0.94,
        rx: 0.95,
        ry: 0.4,
        color: [46, 66, 120],
        strength: 0.22,
      });
      mist(buf, {
        scale: 2.4,
        driftX: t * 0.35,
        driftY: -t * 0.05,
        color: [34, 48, 82],
        strength: 0.16,
        seed: 3,
        bias: 0.5,
      });
      disc(buf, {
        cx: 0.6,
        cy: lerp(0.15, 0.19, ease(t)),
        r: 0.052,
        color: [214, 224, 244],
        alpha: 0.95,
      });
      // Bóng sói mờ dần hiện ra sau làng - đây là thứ đang tới, chưa phải thứ
      // đã tới, nên nó không bao giờ rõ nét.
      drawWolf(buf, {
        cx: 0.5,
        cy: 0.52,
        size: 0.62,
        color: [3, 5, 11],
        alpha: 0.1 + 0.16 * easeIn(t),
      });
      drawVillage(buf, { color: [2, 3, 7], alpha: 1, lift: lerp(0.012, 0, easeOut(t)) });
      // .cine-darken: sáng 1.35 rồi tối dần về 1.
      brightness(buf, lerp(1.35, 1, easeIn(t)));
      vignette(buf, lerp(0.35, 0.62, ease(t)), 0.5);
      grain(buf, 3.5, 11);
    },
  },

  dawn: {
    durationMs: 1200,
    draw(buf, t) {
      verticalGradient(buf, [
        [0, hex(0x0a1020)],
        [0.6, hex(0x1b1220)],
        [1, hex(0x2a1414)],
      ]);
      glow(buf, {
        cx: 0.5,
        cy: 1.0,
        rx: 0.62,
        ry: 0.72,
        color: [255, 168, 92],
        strength: 0.34 * (0.25 + 0.75 * ease(t)),
      });
      rays(buf, {
        cx: 0.5,
        cy: 0.82,
        count: 9,
        spin: t * 0.22,
        color: [255, 196, 130],
        strength: 0.13 * easeOut(t),
        length: 0.78,
      });
      disc(buf, {
        cx: 0.5,
        cy: lerp(1.02, 0.74, easeOut(t)),
        r: 0.075,
        color: [255, 220, 168],
        softness: 0.2,
        alpha: 0.95,
      });
      drawVillage(buf, { color: [20, 9, 12], alpha: 0.94 });
      // .cine-brighten: tối rồi sáng dần lên.
      brightness(buf, lerp(0.72, 1.06, easeOut(t)));
      vignette(buf, 0.45, 0.55);
      grain(buf, 3.5, 23);
    },
  },

  trial: {
    durationMs: 1000,
    draw(buf, t) {
      verticalGradient(buf, [
        [0, hex(0x0b0c14)],
        [1, hex(0x14060b)],
      ]);
      // Đèn sân khấu siết dần vào giữa: phiên toà mở ra bằng việc ánh sáng chọn
      // một chỗ, chưa cần ai đứng vào đó.
      glow(buf, {
        cx: 0.5,
        cy: 0.6,
        rx: lerp(0.62, 0.3, ease(t)),
        ry: lerp(0.78, 0.42, ease(t)),
        color: [255, 240, 214],
        strength: 0.78 * easeOut(Math.min(1, t * 1.4)),
        power: 2.4,
      });
      // Vũng sáng dưới sàn: đèn sân khấu phải rọi xuống một chỗ có thật, nếu
      // không nó chỉ là một vệt mờ lơ lửng.
      glow(buf, {
        cx: 0.5,
        cy: 0.98,
        rx: lerp(0.5, 0.26, ease(t)),
        ry: 0.34,
        color: [255, 226, 186],
        strength: 0.5 * easeOut(Math.min(1, t * 1.4)),
      });
      // Bục khai báo, trong vùng an toàn giữa khung.
      const podium = 0.02 * (1 - easeOut(t));
      polygon(
        buf,
        [
          [0.44, 0.78 + podium],
          [0.56, 0.78 + podium],
          [0.585, 1.0],
          [0.415, 1.0],
        ],
        { color: [7, 4, 6], alpha: 0.97 },
      );
      // Song chắn đổ xuống hai bên, khép dần khung nhìn lại.
      for (let i = 0; i < 8; i += 1) {
        const x = 0.06 + i * 0.126;
        const drop = easeOut(Math.min(1, t * 1.5 - i * 0.03));
        if (drop <= 0) continue;
        polygon(
          buf,
          [
            [x, -0.02],
            [x + 0.016, -0.02],
            [x + 0.016, lerp(0, 1.02, drop)],
            [x, lerp(0, 1.02, drop)],
          ],
          { color: [3, 2, 4], alpha: 0.72 },
        );
      }
      vignette(buf, lerp(0.4, 0.68, ease(t)), 0.42);
      grain(buf, 3, 31);
    },
  },

  verdict: {
    durationMs: 1100,
    draw(buf, t) {
      verticalGradient(buf, [
        [0, hex(0x14060b)],
        [1, hex(0x060207)],
      ]);
      const shut = easeIn(Math.min(1, t / 0.78));
      glow(buf, {
        cx: 0.5,
        cy: 0.5,
        rx: lerp(0.55, 0.1, shut),
        ry: lerp(0.7, 0.14, shut),
        color: [255, 186, 128],
        strength: 0.95,
      });
      /*
       * Một cánh cửa khép lại, không phải một vụ hành quyết.
       *
       * README trong /public/cinematics gọi đích danh cảnh này là chỗ dễ sai
       * nhất, và nó đúng: "làng đã có phán quyết" rất dễ bị dựng thành cái giá
       * treo cổ. Hai cánh cửa gỗ đóng lại nói đúng chuyện đó - đã quyết, không
       * bàn nữa - mà không cần cho ai xem cảnh gì.
       */
      const edge = lerp(-0.04, 0.5, shut);
      polygon(
        buf,
        [
          [-0.02, -0.02],
          [edge, -0.02],
          [edge, 1.02],
          [-0.02, 1.02],
        ],
        { color: [9, 4, 7], alpha: 1 },
      );
      polygon(
        buf,
        [
          [1 - edge, -0.02],
          [1.02, -0.02],
          [1.02, 1.02],
          [1 - edge, 1.02],
        ],
        { color: [9, 4, 7], alpha: 1 },
      );
      // Mép trong của hai cánh cửa hắt sáng. Không có nó thì cửa đen trên nền
      // đen là vô hình, và cảnh chỉ còn là một vũng sáng tự nhỏ lại - mất hẳn
      // cái nghĩa "có hai cánh cửa đang khép".
      for (const x of [edge, 1 - edge]) {
        streak(buf, {
          x0: x,
          y0: 0,
          x1: x,
          y1: 1,
          width: 0.004,
          color: [255, 190, 140],
          strength: 0.75 * (1 - shut),
        });
      }
      // Khe sáng còn lại giữa hai cánh, tắt hẳn sau khi cửa chạm nhau.
      const seam = Math.max(0, 1 - Math.abs(t - 0.78) / 0.22);
      streak(buf, {
        x0: 0.5,
        y0: 0,
        x1: 0.5,
        y1: 1,
        width: lerp(0.02, 0.004, shut),
        color: [255, 214, 170],
        strength: 1.05 * seam * seam,
      });
      // Cú dội lúc cửa chạm nhau: một khung sáng loé rồi thôi.
      if (t > 0.74 && t < 0.84) brightness(buf, 1 + 0.5 * (1 - Math.abs(t - 0.79) / 0.05));
      vignette(buf, lerp(0.3, 0.9, easeIn(t)), 0.3);
      grain(buf, 3, 47);
    },
  },

  "village-win": {
    durationMs: 2000,
    draw(buf, t) {
      verticalGradient(buf, [
        [0, hex(0x04160f)],
        [1, hex(0x030b12)],
      ]);
      glow(buf, {
        cx: 0.5,
        cy: 0.34,
        rx: 0.66,
        ry: 0.8,
        color: [52, 200, 150],
        strength: 0.42 * easeOut(Math.min(1, t * 2)),
      });
      rays(buf, {
        cx: 0.5,
        cy: 0.34,
        count: 14,
        spin: t * 0.5,
        color: [130, 245, 200],
        strength: 0.05 * easeOut(Math.min(1, t * 1.6)),
        length: 0.85,
      });
      // Hai vòng sáng nối nhau: một cú reo, rồi tiếng vọng của nó.
      for (const [delay, gain] of [
        [0, 1],
        [0.32, 0.4],
      ]) {
        const p = (t - delay) / (1 - delay);
        if (p <= 0) continue;
        ring(buf, {
          cx: 0.5,
          cy: 0.34,
          r: lerp(0.02, 0.9, easeOut(p)),
          thickness: 0.075,
          color: [190, 255, 226],
          strength: 0.14 * gain * (1 - p),
        });
      }
      mist(buf, {
        scale: 3.2,
        driftX: 0,
        driftY: -t * 0.5,
        color: [90, 200, 160],
        strength: 0.14,
        seed: 5,
        bias: 0.62,
      });
      drawVillage(buf, { color: [4, 20, 15], alpha: 0.88 });
      vignette(buf, 0.45, 0.55);
      grain(buf, 3.5, 59);
    },
  },

  "wolves-win": {
    durationMs: 2000,
    draw(buf, t) {
      verticalGradient(buf, [
        [0, hex(0x16030a)],
        [1, hex(0x050206)],
      ]);
      glow(buf, {
        cx: 0.5,
        cy: 0.42,
        rx: 0.66,
        ry: 0.8,
        color: [220, 38, 64],
        strength: 0.44 * easeOut(Math.min(1, t * 2)),
      });
      ring(buf, {
        cx: 0.5,
        cy: 0.42,
        r: lerp(0.02, 0.95, easeOut(t)),
        thickness: 0.085,
        color: [255, 120, 130],
        strength: 0.22 * (1 - t),
      });
      // Sói lớn dần lên chứ không đứng sẵn: cảnh này là lúc bầy sói cuối cùng
      // bước ra khỏi bóng tối, nên nó phải bước.
      drawWolf(buf, {
        cx: 0.5,
        cy: 0.44,
        size: lerp(0.5, 0.66, easeOut(t)),
        color: [6, 1, 4],
        alpha: 0.82 * easeOut(Math.min(1, t * 2.2)),
      });
      claws(buf, t, { color: [255, 150, 150], strength: 0.30 });
      vignette(buf, lerp(0.4, 0.62, ease(t)), 0.45);
      grain(buf, 3.5, 71);
    },
  },

  /* --- Bốn họ sự kiện ---------------------------------------------------- */

  /*
   * Bốn cảnh dưới đây chỉ dài 900ms và luôn có chữ đè lên - tên sự kiện, dòng
   * nhỏ và dòng phụ. Nên chúng cố tình trừu tượng và tối ở vùng giữa: nhiệm vụ
   * của chúng là nói "chuyện vừa xảy ra nghiêng về phía ai", còn nói chuyện gì
   * là việc của chữ. Một cảnh sự kiện có hình quá rõ sẽ đánh nhau với chính
   * dòng chữ nó đang giới thiệu.
   */

  "event-wolf-threat": {
    durationMs: 900,
    draw(buf, t) {
      verticalGradient(buf, [
        [0, hex(0x180410)],
        [1, hex(0x06020a)],
      ]);
      for (const delay of [0, 0.28]) {
        const p = (t - delay) / (1 - delay);
        if (p <= 0) continue;
        ring(buf, {
          cx: 0.5,
          cy: 0.5,
          r: lerp(0.05, 0.85, easeOut(p)),
          thickness: 0.085,
          color: [235, 60, 80],
          strength: 0.24 * (1 - p),
        });
      }
      claws(buf, t, { color: [255, 140, 140], strength: 0.26 });
      glow(buf, {
        cx: 0.5,
        cy: 0.5,
        rx: 0.5,
        ry: 0.6,
        color: [150, 20, 40],
        strength: 0.16 * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.2))),
      });
      vignette(buf, 0.58, 0.4);
      grain(buf, 3, 83);
    },
  },

  "event-village-boon": {
    durationMs: 900,
    draw(buf, t) {
      verticalGradient(buf, [
        [0, hex(0x0d1424)],
        [1, hex(0x060b16)],
      ]);
      glow(buf, {
        cx: 0.5,
        cy: 0.48,
        rx: lerp(0.2, 0.66, easeOut(t)),
        ry: lerp(0.26, 0.8, easeOut(t)),
        color: [120, 225, 190],
        strength: 0.4 * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1))),
      });
      rays(buf, {
        cx: 0.5,
        cy: 0.48,
        count: 12,
        spin: t * 0.4,
        color: [180, 250, 220],
        strength: 0.11 * easeOut(t),
        length: 0.7,
      });
      mist(buf, {
        scale: 3.6,
        driftX: 0,
        driftY: -t * 0.7,
        color: [140, 230, 200],
        strength: 0.16,
        seed: 9,
        bias: 0.64,
      });
      vignette(buf, 0.48, 0.44);
      grain(buf, 3, 97);
    },
  },

  "event-rule-change": {
    durationMs: 900,
    draw(buf, t) {
      verticalGradient(buf, [
        [0, hex(0x16120a)],
        [1, hex(0x07070f)],
      ]);
      // Một dải sáng quét dọc qua khung: luật vừa được đọc lên và đi qua cả
      // làng một lượt.
      const sweep = lerp(-0.25, 1.25, easeOut(t));
      streak(buf, {
        x0: -0.2,
        y0: sweep,
        x1: 1.2,
        y1: sweep - 0.12,
        width: 0.05,
        color: [255, 196, 96],
        strength: 0.38,
      });
      ring(buf, {
        cx: 0.5,
        cy: 0.5,
        r: lerp(0.04, 0.62, easeOut(t)),
        thickness: 0.06,
        color: [255, 214, 140],
        strength: 0.22 * (1 - t),
      });
      glow(buf, {
        cx: 0.5,
        cy: 0.5,
        rx: 0.46,
        ry: 0.56,
        color: [140, 100, 30],
        strength: 0.16 * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.1))),
      });
      vignette(buf, 0.5, 0.44);
      grain(buf, 3, 103);
    },
  },

  "event-spirit": {
    durationMs: 900,
    draw(buf, t) {
      verticalGradient(buf, [
        [0, hex(0x150e26)],
        [1, hex(0x05040d)],
      ]);
      // Hai tầng sương trôi ngược chiều nhau: một tầng bốc lên, một tầng dạt
      // ngang. Đứng riêng thì mỗi tầng chỉ là một mảng mờ; chồng lên nhau mới
      // ra cái động đậy của thứ không có hình.
      mist(buf, {
        scale: 2.6,
        driftX: t * 0.18,
        driftY: -t * 0.55,
        color: [150, 120, 235],
        strength: 0.22,
        seed: 13,
        bias: 0.5,
      });
      mist(buf, {
        scale: 4.4,
        driftX: -t * 0.3,
        driftY: -t * 0.22,
        color: [110, 90, 190],
        strength: 0.15,
        seed: 21,
        bias: 0.58,
      });
      glow(buf, {
        cx: 0.5,
        cy: 0.5,
        rx: lerp(0.16, 0.5, easeOut(t)),
        ry: lerp(0.2, 0.62, easeOut(t)),
        color: [190, 165, 255],
        strength: 0.22 * Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.05)),
      });
      vignette(buf, 0.56, 0.4);
      grain(buf, 3, 109);
    },
  },
};
