import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BEAT,
  CAMERA_FOV,
  CAMERA_GLIDE_MS,
  HOUSE_TOP,
  MOON_NDC,
  OVERVIEW_FILL,
  SHAKE_MS,
  VIEW_DIR,
  VIEW_PITCH,
  afterProgress,
  cameraPose,
  collectFramePoints,
  easeInOutCubic,
  effectIntensity,
  fitDistance,
  frameOverflow,
  framedTarget,
  framingFor,
  halfFovs,
  impactProgress,
  moonDirection,
  shakeFor,
  shakeOffset,
  sightlineHeightAt,
  smootherStep,
  tellProgress,
  type Point3,
} from "./village-memory-camera";
import { ringRadius } from "./village-memory";

/**
 * Vòng nhà của một bàn `count` người, đúng công thức mà model dùng.
 *
 * Test đóng khung phải chạy trên một ngôi làng có thật chứ không trên vài con số
 * chọn cho tiện: câu hỏi "trên 390x844 làng có bị cắt không" chỉ có nghĩa khi
 * bán kính vòng nhà là bán kính thật.
 */
function ringHouses(count: number): { x: number; z: number }[] {
  const radius = ringRadius(count);
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
  });
}

/**
 * Tỉ lệ khung của VÙNG CANVAS, không phải của màn hình.
 *
 * Đây là chỗ bản đầu tính sai: thanh tiêu đề và tấm chú thích ăn mất một phần
 * chiều cao, nên một màn 1440x900 cho ra một ô canvas RỘNG VÀ THẤP - và trên ô
 * đó thì chiều cao mới là chiều bó buộc, ngược hẳn với thứ mà một hệ số
 * `1/aspect` giả định.
 */
const CANVAS = {
  desktop: 1440 / 608,
  portrait: 390 / 392,
  tallPortrait: 390 / 560,
  smallPhone: 320 / 247,
  phoneLandscape: 490 / 334,
};

const SQUARE_RADIUS = 2.6;

function overviewFit(houses: { x: number; z: number }[], aspect: number) {
  const points: Point3[] = [];
  collectFramePoints(houses, true, SQUARE_RADIUS, points);
  const look = { x: 0, y: 0.85, z: 0 };
  const distance = fitDistance(points, look, aspect, OVERVIEW_FILL);
  return { distance, look, points, overflow: frameOverflow(points, look, distance, aspect) };
}

describe("hướng nhìn", () => {
  it("là vector ĐƠN VỊ - lỗi đã làm cả ngôi làng nhỏ đi 36%", () => {
    /*
     * Bản đầu nhân "khoảng cách" với `(0.62, 0.78, 0.92)`, một vector dài 1.356.
     * Không chỗ nào trong công thức nói ra điều đó, nên camera luôn đứng xa hơn
     * con số đang tính đúng 36% - và đó là phần lớn lý do ngôi làng trông như
     * một mô hình đặt cuối phòng.
     */
    assert.ok(Math.abs(Math.hypot(VIEW_DIR.x, VIEW_DIR.y, VIEW_DIR.z) - 1) < 1e-12);
  });

  it("chúc xuống đủ để nhìn thấy cả vòng nhà, không cắm thẳng từ trên xuống", () => {
    const degrees = (VIEW_PITCH * 180) / Math.PI;
    assert.ok(degrees > 30 && degrees < 40, `góc chúc ${degrees.toFixed(1)} độ`);
  });
});

describe("halfFovs", () => {
  it("khung càng rộng thì góc mở ngang càng lớn, còn góc dọc thì không đổi", () => {
    const wide = halfFovs(2.4);
    const narrow = halfFovs(0.6);
    assert.equal(wide.vertical, narrow.vertical);
    assert.ok(wide.horizontal > narrow.horizontal);
    assert.ok(Math.abs((wide.vertical * 360) / Math.PI - CAMERA_FOV) < 1e-9);
  });

  it("tỉ lệ vô lý không làm vỡ", () => {
    for (const aspect of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const half = halfFovs(aspect);
      assert.ok(Number.isFinite(half.horizontal), String(aspect));
      assert.ok(half.horizontal > 0, String(aspect));
    }
  });
});

describe("đóng khung cảnh mở đầu", () => {
  it("không khung hình nào cắt mất một mái nhà", () => {
    for (const [name, aspect] of Object.entries(CANVAS)) {
      for (const count of [5, 8, 13, 15]) {
        const fit = overviewFit(ringHouses(count), aspect);
        assert.ok(fit.overflow.x <= 1, `${name}/${count} bị cắt hai bên`);
        assert.ok(fit.overflow.y <= 1, `${name}/${count} bị cắt trên dưới`);
      }
    }
  });

  it("và cũng không để làng lọt thỏm giữa một biển tối", () => {
    // Chiều BÓ BUỘC phải được lấp gần hết. Đây là mặt còn lại của khẳng định
    // trên: vừa khung thì dễ, vừa khung mà vẫn to mới là việc phải làm.
    for (const [name, aspect] of Object.entries(CANVAS)) {
      const fit = overviewFit(ringHouses(13), aspect);
      const filled = Math.max(fit.overflow.x, fit.overflow.y);
      assert.ok(filled > OVERVIEW_FILL - 0.03, `${name} chỉ lấp ${(filled * 100).toFixed(0)}%`);
    }
  });

  it("khung dọc: làng chiếm phần lớn chiều NGANG", () => {
    // Trên điện thoại dựng đứng, bề ngang là chiều hẹp, nên nó phải là chiều
    // được lấp - chứ không phải lùi camera ra cho tới khi cả hai chiều đều thừa.
    const fit = overviewFit(ringHouses(13), CANVAS.tallPortrait);
    assert.ok(fit.overflow.x > 0.85, `mới chiếm ${(fit.overflow.x * 100).toFixed(0)}% bề ngang`);
  });

  it("khung ngang và thấp: chiều CAO là chiều bó buộc", () => {
    // Ô canvas trên desktop rộng gấp hơn hai lần chiều cao. Một công thức chỉ
    // biết bù cho khung dọc sẽ trả lời "không phải bù gì" ở đây và để ngôi làng
    // tràn ra ngoài mép trên.
    const fit = overviewFit(ringHouses(13), CANVAS.desktop);
    assert.ok(fit.overflow.y > fit.overflow.x);
    assert.ok(fit.overflow.y <= 1);
  });

  it("camera không lùi quá xa trên khung hẹp", () => {
    /*
     * Trần theo BÁN KÍNH LÀNG chứ không phải một con số tuyệt đối: bàn 15 người
     * cần đứng xa hơn bàn 5 người, và điều phải chặn là tỉ lệ giữa hai thứ đó.
     */
    for (const count of [5, 13, 15]) {
      const radius = ringRadius(count);
      for (const [name, aspect] of Object.entries(CANVAS)) {
        const fit = overviewFit(ringHouses(count), aspect);
        assert.ok(
          fit.distance < radius * 5.5,
          `${name}/${count}: xa ${(fit.distance / radius).toFixed(2)} lần bán kính`,
        );
      }
    }
  });

  it("bàn đông người thì lùi ra, bàn ít người thì tiến vào", () => {
    const small = overviewFit(ringHouses(5), CANVAS.desktop);
    const big = overviewFit(ringHouses(15), CANVAS.desktop);
    assert.ok(big.distance > small.distance);
  });

  it("camera luôn ở trên mặt đất", () => {
    for (const count of [5, 15]) {
      const fit = overviewFit(ringHouses(count), CANVAS.portrait);
      assert.ok(cameraPose(fit.look, fit.distance).position.y > 1, String(count));
    }
  });
});

describe("đóng khung một bước", () => {
  const houses = ringHouses(13);

  function stepFit(focus: { x: number; z: number }[], effect: Parameters<typeof framingFor>[0], aspect: number) {
    const framing = framingFor(effect);
    const points: Point3[] = [];
    collectFramePoints(focus, framing.square, SQUARE_RADIUS, points);
    const centre = {
      x: focus.reduce((sum, house) => sum + house.x, 0) / focus.length,
      z: focus.reduce((sum, house) => sum + house.z, 0) / focus.length,
    };
    const pulled = framedTarget(centre, framing.pull);
    const look = { x: pulled.x, y: 0.95, z: pulled.z };
    const distance = fitDistance(points, look, aspect, framing.fill);
    return { distance, look, points, overflow: frameOverflow(points, look, distance, aspect) };
  }

  it("cảnh Tiên Tri giữ được CẢ hai đầu trong khung", () => {
    /*
     * Nguồn và mục tiêu ở hai phía đối diện của vòng nhà là trường hợp khó nhất,
     * và cũng là trường hợp có thật: Tiên Tri soi sang bên kia làng. Cắt mất một
     * đầu thì tia sáng thành một cái que chỉ ra ngoài màn hình.
     */
    const origin = houses[0];
    const target = houses[6];
    for (const [name, aspect] of Object.entries(CANVAS)) {
      const fit = stepFit([origin, target], "SEER_BEAM", aspect);
      assert.ok(fit.overflow.x <= 1 && fit.overflow.y <= 1, `${name} cắt mất một đầu`);
      for (const house of [origin, target]) {
        const alone = frameOverflow(
          [{ x: house.x, y: HOUSE_TOP, z: house.z }],
          fit.look,
          fit.distance,
          aspect,
        );
        assert.ok(alone.x <= 1 && alone.y <= 1, `${name}: một nhà nằm ngoài khung`);
      }
    }
  });

  it("cảnh Thợ Săn và cảnh Sói cũng vậy", () => {
    for (const effect of ["HUNTER_SHOT", "WOLF_ATTACK"] as const) {
      const fit = stepFit([houses[2], houses[9]], effect, CANVAS.portrait);
      assert.ok(fit.overflow.x <= 1 && fit.overflow.y <= 1, effect);
    }
  });

  it("người sống sót cuối cùng là cảnh tới GẦN nhất, nhưng không cắt mất mái", () => {
    const lone = stepFit([houses[3]], "LONE_LIGHT", CANVAS.desktop);
    const usual = stepFit([houses[3]], "WOLF_ATTACK", CANVAS.desktop);
    assert.ok(lone.distance < usual.distance);
    assert.ok(lone.overflow.x <= 1 && lone.overflow.y <= 1);
  });

  it("phiên toà giữ quảng trường trong khung", () => {
    assert.equal(framingFor("LYNCH").square, true);
    assert.equal(framingFor("TRIAL_SCALES").square, true);
    // Người sống sót cuối cùng là ngoại lệ DUY NHẤT: cảnh đó nói về một căn nhà.
    assert.equal(framingFor("LONE_LIGHT").square, false);
    const fit = stepFit([houses[4]], "LYNCH", CANVAS.portrait);
    const centre = frameOverflow([{ x: 0, y: 0, z: 0 }], fit.look, fit.distance, CANVAS.portrait);
    assert.ok(centre.x <= 1 && centre.y <= 1, "quảng trường rơi ra ngoài khung");
  });

  it("nhà tiền cảnh KHÔNG che được mục tiêu", () => {
    /*
     * Camera chúc 35 độ nên tia nhìn đi XUỐNG: ở chỗ căn nhà đứng trước mục tiêu
     * một khoảng bằng khoảng cách giữa hai nhà, tia đã cao hơn đỉnh mái. Con số
     * này phải được ghim, vì nó là thứ duy nhất giữ cho cảnh cận không bị một
     * mái nhà khác chắn ngang - và nó phụ thuộc vào cả góc chúc lẫn khoảng cách.
     */
    const spacing = 2.6;
    for (const effect of ["WOLF_ATTACK", "LONE_LIGHT", "SEER_BEAM"] as const) {
      const fit = stepFit([houses[5]], effect, CANVAS.desktop);
      const height = sightlineHeightAt(fit.distance, HOUSE_TOP, spacing);
      assert.ok(height > HOUSE_TOP + 0.4, `${effect}: tia chỉ cao ${height.toFixed(2)}`);
    }
  });

  it("kéo điểm nhìn về phía quảng trường nhưng không về hẳn tâm", () => {
    const pulled = framedTarget({ x: 10, z: -5 });
    assert.ok(Math.abs(pulled.x) < 10 && Math.abs(pulled.x) > 0);
    assert.ok(Math.abs(pulled.z) < 5 && Math.abs(pulled.z) > 0);
    // Cùng hướng với căn nhà, chỉ gần tâm hơn.
    assert.ok(pulled.x > 0 && pulled.z < 0);
    assert.deepEqual(framedTarget({ x: 0, z: 0 }), { x: 0, z: 0 });
  });
});

describe("collectFramePoints", () => {
  it("mỗi nhà góp cả bốn góc chân và hai đỉnh mái", () => {
    const out: Point3[] = [];
    collectFramePoints(ringHouses(3), false, 2, out);
    assert.equal(out.length, 18);
    collectFramePoints(ringHouses(3), true, 2, out);
    assert.equal(out.length, 22);
  });

  it("bốn góc chân là bốn góc KHÁC nhau", () => {
    // Lấy hai góc đối nhau thì căn nhà ở rìa khung có thể lấn ra xa nhất bằng
    // đúng cái góc không được lấy mẫu.
    const out: Point3[] = [];
    collectFramePoints([{ x: 0, z: 0 }], false, 2, out);
    const corners = out.filter((point) => point.y === 0).map((point) => `${point.x},${point.z}`);
    assert.equal(new Set(corners).size, 4);
  });

  it("dùng lại đúng những vật thể cũ thay vì cấp phát mới", () => {
    // Hàm này chạy lại mỗi khi tỉ lệ khung đổi, và đường đó đi qua vòng vẽ.
    const out: Point3[] = [];
    collectFramePoints(ringHouses(4), true, 2, out);
    const first = out[0];
    collectFramePoints(ringHouses(4), true, 2, out);
    assert.equal(out[0], first, "phải ghi đè vào ô cũ");
  });

  it("ít nhà hơn thì mảng ngắn lại, không để sót điểm của lần trước", () => {
    const out: Point3[] = [];
    collectFramePoints(ringHouses(9), true, 2, out);
    collectFramePoints(ringHouses(2), false, 2, out);
    assert.equal(out.length, 12);
  });
});

describe("fitDistance", () => {
  it("chùm điểm rỗng vẫn trả về một khoảng cách hợp lệ", () => {
    assert.ok(fitDistance([], { x: 0, y: 1, z: 0 }, 1.5, 0.9) > 0);
  });

  it("lấp khung tới đúng mức yêu cầu, không hơn", () => {
    const houses = ringHouses(11);
    const points: Point3[] = [];
    collectFramePoints(houses, true, 2.4, points);
    const look = { x: 0, y: 0.85, z: 0 };
    for (const fill of [0.5, 0.7, 0.9]) {
      const distance = fitDistance(points, look, 1.6, fill);
      const overflow = frameOverflow(points, look, distance, 1.6);
      assert.ok(Math.abs(Math.max(overflow.x, overflow.y) - fill) < 0.02, String(fill));
    }
  });

  it("lấp nhiều hơn thì phải đứng gần hơn", () => {
    const houses = ringHouses(11);
    const points: Point3[] = [];
    collectFramePoints(houses, true, 2.4, points);
    const look = { x: 0, y: 0.85, z: 0 };
    assert.ok(fitDistance(points, look, 1.6, 0.9) < fitDistance(points, look, 1.6, 0.5));
  });
});

describe("nhịp", () => {
  it("cú lia dài 1.1-1.4 giây - một cú đặt máy, không phải một cú nhảy", () => {
    assert.ok(CAMERA_GLIDE_MS >= 1100 && CAMERA_GLIDE_MS <= 1400);
  });

  it("đường cong lia mượt cả ở điểm dừng", () => {
    assert.equal(smootherStep(0), 0);
    assert.equal(smootherStep(1), 1);
    assert.equal(smootherStep(0.5), 0.5);
    assert.equal(smootherStep(-1), 0);
    assert.equal(smootherStep(4), 1);
    // Chậm ở hai đầu, nhanh ở giữa: đó là toàn bộ khác biệt so với đi tuyến tính.
    assert.ok(smootherStep(0.1) < 0.1);
    assert.ok(smootherStep(0.9) > 0.9);
  });

  it("ba nhịp nối liền nhau, không chồng lấn và không để hở", () => {
    assert.equal(tellProgress(0), 0);
    assert.equal(tellProgress(BEAT.tell), 1);
    assert.equal(impactProgress(BEAT.tell), 0);
    assert.equal(impactProgress(BEAT.impact), 1);
    assert.equal(afterProgress(BEAT.impact), 0);
    assert.equal(afterProgress(1), 1);
    // Trước nhịp của mình thì đứng yên ở 0, sau đó thì giữ ở 1.
    assert.equal(impactProgress(0.1), 0);
    assert.equal(afterProgress(0.3), 0);
    assert.equal(tellProgress(0.9), 1);
  });

  it("rung máy rất nhẹ và TẮT HẲN trong 150ms", () => {
    assert.ok(SHAKE_MS <= 150);
    assert.equal(shakeOffset(SHAKE_MS), 0);
    assert.equal(shakeOffset(SHAKE_MS + 1), 0);
    assert.equal(shakeOffset(9999), 0);
    assert.equal(shakeOffset(-5), 0);
    for (let ms = 0; ms < SHAKE_MS; ms += 5) {
      assert.ok(Math.abs(shakeOffset(ms)) <= 0.07, `biên độ ở ${ms}ms`);
    }
  });

  it("chỉ phát súng mới rung máy, và giảm chuyển động thì không rung gì cả", () => {
    const duration = 3600;
    const atImpact = duration * BEAT.tell + 20;

    assert.notEqual(shakeFor("HUNTER_SHOT", atImpact, duration, false), 0);
    // Giảm chuyển động: TẮT, không phải "rung nhẹ hơn".
    assert.equal(shakeFor("HUNTER_SHOT", atImpact, duration, true), 0);
    for (const effect of ["WOLF_ATTACK", "LYNCH", "CURSED_MOON", "LONE_LIGHT", null] as const) {
      assert.equal(shakeFor(effect, atImpact, duration, false), 0, String(effect));
    }
  });

  it("rung đúng quanh cú va chạm, không phải từ đầu bước", () => {
    const duration = 3600;
    // Trước cú va chạm: chưa bắn, chưa rung.
    assert.equal(shakeFor("HUNTER_SHOT", 0, duration, false), 0);
    assert.equal(shakeFor("HUNTER_SHOT", duration * BEAT.tell - 50, duration, false), 0);
    // Và tắt trước khi bước kết thúc. Ở đúng mốc cuối, biên độ tắt dần theo
    // bình phương nên nó là số không về mọi nghĩa dùng được, dù dấu phẩy động
    // còn giữ lại một hạt bụi.
    assert.ok(Math.abs(shakeFor("HUNTER_SHOT", duration * BEAT.tell + SHAKE_MS, duration, false)) < 1e-9);
    assert.equal(shakeFor("HUNTER_SHOT", duration, duration, false), 0);
  });

  it("easeInOutCubic chạy trọn từ 0 tới 1 và kẹp giá trị ngoài dải", () => {
    assert.equal(easeInOutCubic(0), 0);
    assert.equal(easeInOutCubic(1), 1);
    assert.equal(easeInOutCubic(0.5), 0.5);
    assert.equal(easeInOutCubic(-1), 0);
    assert.equal(easeInOutCubic(3), 1);
  });

  it("hiệu ứng đọng lại chứ không tắt về không khi bước đã diễn xong", () => {
    // Điều kiện để người bấm Tạm dừng, hay quay lại một bước cũ, còn thấy dấu
    // vết của điều vừa được kể thay vì một ngôi làng trống trơn.
    assert.ok(effectIntensity(1, 0.5, 0.22) >= 0.22);
    assert.ok(effectIntensity(3, 0.5, 0.22) >= 0.22);
    assert.ok(effectIntensity(0, 0.5, 0.22) >= 0.22);
    assert.ok(effectIntensity(0.42, 0.5, 0.22) > effectIntensity(1, 0.5, 0.22));
    for (const t of [0, 0.1, 0.3, 0.5, 0.7, 1, 2]) {
      assert.ok(effectIntensity(t, 0.5, 0.22) <= 0.5, String(t));
    }
  });
});

describe("mặt trăng", () => {
  it("rơi vào một phần ba phía trên, lệch trái, ở MỌI tỉ lệ khung", () => {
    /*
     * Bản đầu cắm trăng ở một hướng cố định trong hệ camera. Trên khung ngang
     * hướng đó rơi vào giữa trời, còn trên khung dọc thì dạt ra sát mép - vì góc
     * mở ngang co lại theo tỉ lệ khung mà hướng thì không. Tính ngược từ vị trí
     * mong muốn TRONG KHUNG ra hướng thì cả hai khung đều đặt đúng chỗ.
     */
    for (const [name, aspect] of Object.entries(CANVAS)) {
      const direction = moonDirection(aspect);
      const half = halfFovs(aspect);
      const ndcX = direction.x / -direction.z / Math.tan(half.horizontal);
      const ndcY = direction.y / -direction.z / Math.tan(half.vertical);
      assert.ok(Math.abs(ndcX - MOON_NDC.x) < 1e-9, `${name} lệch ngang`);
      assert.ok(Math.abs(ndcY - MOON_NDC.y) < 1e-9, `${name} lệch dọc`);
      assert.ok(ndcY > 0.35 && ndcY < 0.85, `${name}: trăng phải ở phần ba trên`);
      assert.ok(Math.abs(ndcX) < 0.75, `${name}: trăng không được dính mép`);
    }
  });

  it("hướng nhìn tới luôn là -z và luôn đơn vị", () => {
    for (const aspect of [0.5, 1, 2.4]) {
      const direction = moonDirection(aspect);
      assert.ok(direction.z < 0);
      assert.ok(Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-12);
    }
  });
});
