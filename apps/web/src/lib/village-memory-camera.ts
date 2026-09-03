import type { VillageEffect } from "./village-memory";

/**
 * Camera và nhịp của "Hồi ức Ngôi Làng" - phần TÍNH TOÁN, tách hẳn khỏi bản dựng.
 *
 * Không một dòng nào ở đây biết Three.js: chỉ số học trên toạ độ và góc. Đó là
 * điều kiện để những câu hỏi thật sự quan trọng - "trên màn 390x844 ngôi làng có
 * bị cắt không", "camera có lùi quá xa vì khung hẹp không", "nhà tiền cảnh có
 * che mất mục tiêu không" - trả lời được bằng test chứ không bằng cách mở trình
 * duyệt lên nhìn.
 *
 * Bản đầu đóng khung bằng một hệ số nhân trên bán kính làng, và nó sai theo hai
 * cách cộng dồn:
 *
 *   1. Hướng nhìn `(0.62, 0.78, 0.92)` KHÔNG phải vector đơn vị - độ dài của nó
 *      là 1.356. Nhân "khoảng cách" với một vector dài 1.356 nghĩa là camera
 *      luôn đứng xa hơn 36% so với con số đang tính, và cả ngôi làng bé lại đúng
 *      chừng ấy mà không có chỗ nào trong công thức nói ra điều đó.
 *   2. Bù khung dọc bằng một hệ số `1/aspect` có trần: nó chỉ biết chiều NGANG
 *      hụt bao nhiêu, không biết chiều DỌC còn thừa bao nhiêu. Trên khung ngang
 *      và thấp - đúng hình dạng vùng canvas trên desktop - chiều cao mới là
 *      chiều bó buộc, và hệ số kia trả lời 1, tức là không bù gì cả.
 *
 * Cách chữa là bỏ hệ số đoán và ĐO thật: chiếu những điểm bắt buộc phải nhìn
 * thấy qua đúng phép chiếu mà camera sẽ dùng, rồi dò khoảng cách sao cho điểm xa
 * nhất rơi đúng vào phần khung mình muốn. Xem `fitDistance`.
 */

/** Góc mở dọc. Cùng con số mà `VillageMemoryCanvas` dựng `PerspectiveCamera`. */
export const CAMERA_FOV = 42;

/**
 * Hướng nhìn isometric, CỐ ĐỊNH cho cả trải nghiệm.
 *
 * Camera không xoay quanh làng: người xem không phải kéo thả gì để dùng tính
 * năng này, nên một góc nhìn duy nhất, đọc được cả vòng nhà, là đúng thứ cần.
 * Đổi bước chỉ đổi ĐIỂM NHÌN và khoảng cách - không đổi hướng, nên không có cú
 * xoay nào gây chóng mặt.
 *
 * Chuẩn hoá ngay tại đây thay vì tin vào ba con số trông có vẻ đơn vị: `y` của
 * vector đã chuẩn hoá chính là sin của góc chúc, và nửa dưới file này dùng nó
 * làm một đại lượng lượng giác thật.
 */
const ISO = { x: 0.62, y: 0.78, z: 0.92 };
const ISO_LENGTH = Math.hypot(ISO.x, ISO.y, ISO.z);

export const VIEW_DIR = {
  x: ISO.x / ISO_LENGTH,
  y: ISO.y / ISO_LENGTH,
  z: ISO.z / ISO_LENGTH,
} as const;

/** Góc chúc của camera, radian. Suy từ `VIEW_DIR` chứ không đặt riêng một lần nữa. */
export const VIEW_PITCH = Math.asin(VIEW_DIR.y);

/** Quãng đường NGANG mà camera lùi ra, ứng với một khoảng cách theo hướng nhìn. */
export const VIEW_REACH = Math.hypot(VIEW_DIR.x, VIEW_DIR.z);

/*
 * Hai trục còn lại của camera, dựng đúng như `Object3D.lookAt` với trục Y thế
 * giới: `x = normalize(up × z)`, `y = z × x`, với `z` chính là `VIEW_DIR`.
 *
 * Hằng số ở cấp module vì hướng nhìn không đổi trong cả trải nghiệm - dựng lại
 * chúng trong vòng lặp chiếu điểm là làm cùng một phép tính vài trăm lần cho
 * một kết quả không bao giờ khác.
 */
const AXIS_X = {
  x: VIEW_DIR.z / VIEW_REACH,
  z: -VIEW_DIR.x / VIEW_REACH,
} as const;
const AXIS_Y = {
  x: (-VIEW_DIR.x * VIEW_DIR.y) / VIEW_REACH,
  y: VIEW_REACH,
  z: (-VIEW_DIR.y * VIEW_DIR.z) / VIEW_REACH,
} as const;

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraPose {
  position: Point3;
  look: Point3;
}

/** Nửa góc mở, radian: dọc theo `fov`, ngang theo tỉ lệ khung. */
export function halfFovs(aspect: number, fovDeg = CAMERA_FOV): { vertical: number; horizontal: number } {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const vertical = ((fovDeg * Math.PI) / 180) / 2;
  return { vertical, horizontal: Math.atan(Math.tan(vertical) * safeAspect) };
}

/**
 * Chùm điểm này lấn ra tới đâu trong khung, nếu camera đứng cách `distance`.
 *
 * Trả về phần lấn LỚN NHẤT theo mỗi trục, tính bằng nửa khung: `1` là chạm đúng
 * mép, `>1` là đã bị cắt. Đo theo trị tuyệt đối quanh trục nhìn chứ không theo
 * hộp bao, vì đây là câu hỏi "có lọt khung không", và một điểm lọt ra ngoài mép
 * trái thì mép phải còn trống bao nhiêu cũng không cứu được.
 *
 * Điểm nằm SAU camera trả về vô cực: không có khoảng cách nào "vừa khung" cho
 * một điểm ở sau lưng, và phép dò khoảng cách phải hiểu như vậy để lùi ra.
 */
export function frameOverflow(
  points: readonly Point3[],
  look: Point3,
  distance: number,
  aspect: number,
): { x: number; y: number } {
  const { vertical, horizontal } = halfFovs(aspect);
  const tanV = Math.tan(vertical);
  const tanH = Math.tan(horizontal);

  const px = look.x + VIEW_DIR.x * distance;
  const py = look.y + VIEW_DIR.y * distance;
  const pz = look.z + VIEW_DIR.z * distance;

  let maxX = 0;
  let maxY = 0;
  for (const point of points) {
    const vx = point.x - px;
    const vy = point.y - py;
    const vz = point.z - pz;
    // `VIEW_DIR` là trục Z của camera (hướng ra SAU lưng nó), nên chiều sâu là
    // hình chiếu ngược dấu. Điểm ở sau camera có chiều sâu âm.
    const depth = -(vx * VIEW_DIR.x + vy * VIEW_DIR.y + vz * VIEW_DIR.z);
    if (depth <= 0.05) return { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY };
    const sx = Math.abs((vx * AXIS_X.x + vz * AXIS_X.z) / (depth * tanH));
    const sy = Math.abs((vx * AXIS_Y.x + vy * AXIS_Y.y + vz * AXIS_Y.z) / (depth * tanV));
    if (sx > maxX) maxX = sx;
    if (sy > maxY) maxY = sy;
  }
  return { x: maxX, y: maxY };
}

/** Khoảng cách nhỏ nhất, để một bàn ít người không kéo camera vào giữa mấy mái nhà. */
export const MIN_CAMERA_DISTANCE = 4;

/**
 * Khoảng cách để chùm điểm chiếm đúng `fill` phần khung, và không hơn.
 *
 * Dò nhị phân trên một đại lượng ĐƠN ĐIỆU - lùi ra thì mọi thứ nhỏ lại - nên hai
 * mươi vòng lặp là thừa sức cho độ chính xác cần thiết. Không có nghiệm đóng vì
 * phép chiếu phối cảnh không tuyến tính theo khoảng cách: mái nhà gần camera nở
 * nhanh hơn mái nhà ở bờ xa, và chính chênh lệch đó là thứ làm mọi công thức
 * xấp xỉ tính hụt chiều dọc.
 *
 * `fill` là phần của NỬA khung: `0.86` nghĩa là điểm lấn nhất dừng ở 86% đường
 * từ tâm ra mép, tức là còn 14% lề. Không bao giờ đặt `1`: mép khung là chỗ
 * sương và vành sáng của hiệu ứng còn phải nở ra.
 */
export function fitDistance(
  points: readonly Point3[],
  look: Point3,
  aspect: number,
  fill: number,
): number {
  if (points.length === 0) return MIN_CAMERA_DISTANCE;
  const target = Math.min(0.98, Math.max(0.1, fill));

  let low = MIN_CAMERA_DISTANCE;
  let high = MIN_CAMERA_DISTANCE;
  // Nới trần cho tới khi chùm điểm thật sự lọt khung. Có trần cứng để một dữ
  // liệu vô lý không biến vòng lặp này thành vòng lặp vô tận.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const overflow = frameOverflow(points, look, high, aspect);
    if (Math.max(overflow.x, overflow.y) <= target) break;
    low = high;
    high *= 2;
  }

  for (let step = 0; step < 20; step += 1) {
    const mid = (low + high) / 2;
    const overflow = frameOverflow(points, look, mid, aspect);
    if (Math.max(overflow.x, overflow.y) > target) low = mid;
    else high = mid;
  }
  return high;
}

export function cameraPose(look: Point3, distance: number): CameraPose {
  return {
    position: {
      x: look.x + VIEW_DIR.x * distance,
      y: look.y + VIEW_DIR.y * distance,
      z: look.z + VIEW_DIR.z * distance,
    },
    look,
  };
}

// ---- Đóng khung theo bước ----

/** Nửa bề ngang của một nếp nhà, và đỉnh mái. Dùng để dựng chùm điểm phải thấy. */
export const HOUSE_HALF_WIDTH = 0.78;
export const HOUSE_TOP = 1.95;

/**
 * Điểm nhìn ĐÃ KÉO VỀ phía quảng trường.
 *
 * Camera nhắm thẳng vào một mái nhà ở rìa vòng thì nửa ngôi làng nằm sau lưng
 * nó, và người xem mất hẳn ngữ cảnh "chuyện này xảy ra ở đâu trong làng". Kéo
 * về tâm một phần giữ được cả hai: căn nhà vẫn là chủ thể của khung, mà vòng nhà
 * vẫn còn trong khung.
 */
export const TARGET_PULL = 0.62;

export function framedTarget(
  target: { x: number; z: number },
  pull = TARGET_PULL,
): { x: number; z: number } {
  return { x: target.x * pull, z: target.z * pull };
}

/**
 * Cách đóng khung của từng loại hiệu ứng.
 *
 * `fill` để mức cao và bằng nhau ở hầu hết các bước: bó khung là việc của chùm
 * điểm, không phải của một hệ số zoom. Muốn thấy rộng hơn thì THÊM điểm phải
 * nhìn thấy - quảng trường, nhà nguồn - chứ không lùi camera ra một cách mù
 * quáng, vì lùi ra thì thứ cần nhìn cũng nhỏ đi theo.
 *
 * `square` là "khung phải chứa cả quảng trường". Đây là chỗ giữ lời hứa rằng
 * cảnh Tiên Tri, Thợ Săn hay Sói tấn công không cắt mất nguồn hoặc mục tiêu: cả
 * hai đầu đều nằm trong chùm điểm, và tâm làng kéo khung mở đủ rộng để đường nối
 * chúng đọc được.
 */
export interface EffectFraming {
  fill: number;
  /** Tâm quảng trường có phải nằm trong khung không. */
  square: boolean;
  /**
   * Điểm nhìn kéo về tâm bao nhiêu. `1` là đứng ngay trên căn nhà, `0` là giữa làng.
   *
   * Không phải một hằng số chung cho mọi bước, và đó là điều bản đầu bỏ sót:
   * cảnh cận một căn nhà mà vẫn kéo điểm nhìn 38% về phía tâm thì căn nhà nằm
   * lệch hẳn ra rìa khung, và phép đóng khung - vốn đo theo trị tuyệt đối quanh
   * trục nhìn - phải lùi camera ra để ôm cả khoảng trống bên kia. Kết quả là
   * cảnh "tới gần nhất" lại xa hơn cảnh thường.
   */
  pull: number;
}

export const OVERVIEW_FILL = 0.9;

export function framingFor(effect: VillageEffect | null): EffectFraming {
  if (effect === null) return { fill: OVERVIEW_FILL, square: true, pull: 0 };
  switch (effect) {
    // Người sống sót cuối cùng: khung chỉ còn căn nhà đó, gần như đứng ngay
    // trên nó - "tiến gần vừa đủ" chứ không phải dí sát vào một bức tường.
    case "LONE_LIGHT":
      return { fill: 0.8, square: false, pull: 0.9 };
    // Phiên toà diễn ra Ở quảng trường, nên quảng trường là chủ thể chứ không
    // phải phần nền - điểm nhìn nghiêng hẳn về giữa làng.
    case "LYNCH":
    case "TRIAL_SCALES":
      return { fill: 0.8, square: true, pull: 0.4 };
    default:
      return { fill: 0.78, square: true, pull: TARGET_PULL };
  }
}

/**
 * Chùm điểm phải nằm trong khung, ghi vào một mảng có sẵn.
 *
 * Ghi vào chứ không cấp phát mới: hàm này chạy lại mỗi khi tỉ lệ khung đổi -
 * xoay điện thoại, thanh địa chỉ trượt - và đường đó đi qua vòng vẽ.
 *
 * Mỗi căn nhà góp bốn điểm: hai chân đối diện và hai đỉnh mái. Đủ để phép dò
 * khoảng cách thấy được cả bề ngang lẫn chiều cao thật của khối, mà không phải
 * chiếu cả tám đỉnh của một cái hộp.
 */
export function collectFramePoints(
  houses: readonly { x: number; z: number }[],
  includeSquare: boolean,
  squareRadius: number,
  out: Point3[],
): Point3[] {
  let count = 0;
  const put = (x: number, y: number, z: number) => {
    const slot = out[count];
    if (slot) {
      slot.x = x;
      slot.y = y;
      slot.z = z;
    } else {
      out.push({ x, y, z });
    }
    count += 1;
  };

  for (const house of houses) {
    // CẢ BỐN góc chân, không phải hai góc đối nhau. Lấy hai góc là một cách tiết
    // kiệm sai: căn nhà ở rìa trái khung có thể lấn ra xa nhất bằng đúng cái góc
    // không được lấy mẫu, và khi đó phép dò khoảng cách tưởng mọi thứ đã lọt
    // khung trong khi một mái nhà đã thò ra ngoài mép.
    put(house.x - HOUSE_HALF_WIDTH, 0, house.z - HOUSE_HALF_WIDTH);
    put(house.x + HOUSE_HALF_WIDTH, 0, house.z - HOUSE_HALF_WIDTH);
    put(house.x - HOUSE_HALF_WIDTH, 0, house.z + HOUSE_HALF_WIDTH);
    put(house.x + HOUSE_HALF_WIDTH, 0, house.z + HOUSE_HALF_WIDTH);
    put(house.x, HOUSE_TOP, house.z - HOUSE_HALF_WIDTH);
    put(house.x, HOUSE_TOP, house.z + HOUSE_HALF_WIDTH);
  }
  if (includeSquare) {
    put(-squareRadius, 0, 0);
    put(squareRadius, 0, 0);
    put(0, 0, -squareRadius);
    put(0, 0, squareRadius);
  }
  out.length = count;
  return out;
}

/**
 * Tia nhìn tới đỉnh mái nhà mục tiêu còn cao bao nhiêu khi đi ngang một căn nhà
 * đứng trước nó `offset` đơn vị.
 *
 * Câu hỏi này có một câu trả lời đúng và nó phải được ghim: camera chúc 35 độ,
 * nên tia nhìn ĐI XUỐNG, và nhà tiền cảnh chỉ che được mục tiêu khi nó cao hơn
 * độ cao của tia tại chỗ nó đứng. Nếu con số này tụt xuống dưới `HOUSE_TOP` thì
 * cảnh cận nhà nào cũng có nguy cơ bị một mái nhà khác chắn ngang.
 */
export function sightlineHeightAt(distance: number, targetTop: number, offset: number): number {
  const horizontal = distance * VIEW_REACH;
  if (horizontal <= 0) return targetTop;
  const cameraY = targetTop + distance * VIEW_DIR.y;
  const fraction = Math.min(1, Math.max(0, offset / horizontal));
  return targetTop + (cameraY - targetTop) * fraction;
}

// ---- Nhịp ----

/**
 * Thời gian lia camera giữa hai bước.
 *
 * Dài hơn hẳn bản đầu (900ms): ở mức đó cú lia đọc ra là một cú NHẢY được làm
 * mượt, không phải một người quay phim đang đặt máy. 1.25 giây vẫn ngắn hơn
 * nhiều so với một bước 5 giây, nên cảnh còn nguyên thời gian để diễn.
 */
export const CAMERA_GLIDE_MS = 1250;

/**
 * Đường cong của cú lia: `6t⁵ - 15t⁴ + 10t³`.
 *
 * Khác `easeInOutCubic` ở chỗ đạo hàm BẬC HAI cũng bằng 0 ở hai đầu, nghĩa là
 * camera không chỉ dừng êm mà còn hết rung ở điểm dừng. Đó đúng là khác biệt
 * giữa "trượt tới rồi đứng lại" và "một cú đặt máy".
 */
export function smootherStep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function easeInOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

/**
 * Độ đậm của một hiệu ứng: dâng lên rồi ĐỌNG LẠI, không tắt về không.
 *
 * Bản đầu cho mọi hiệu ứng tắt hẳn ở cuối bước, và nó sai theo một cách chỉ lộ
 * ra khi dùng thật: người xem bấm Tạm dừng, hoặc quay lại một bước đã xem, và
 * thấy một ngôi làng trống trơn không còn dấu vết gì của điều vừa được kể.
 *
 * `rest` là mức đọng lại - đủ nhạt để không tranh với bước sau, đủ rõ để trả
 * lời "bước này đang nói về chỗ nào trong làng".
 */
export function effectIntensity(t: number, peak: number, rest: number, rise = 1.2): number {
  const wave = peak * Math.sin(Math.min(1, Math.max(0, t) * rise) * Math.PI);
  return Math.max(rest, wave);
}

/**
 * Ba nhịp của một hiệu ứng: báo trước, va chạm, dư âm.
 *
 * Một con số duy nhất `t` không kể được một câu chuyện; ba khoảng thì có. Mọi
 * hiệu ứng chia cùng một bộ mốc để nhịp của cả trải nghiệm đều tay: người xem
 * học được rằng "có gì đó sắp xảy ra" luôn kéo dài chừng ấy, và cú va chạm luôn
 * rơi vào đúng chỗ ấy của một bước.
 */
export const BEAT = { tell: 0.28, impact: 0.46 } as const;

/** 0 → 1 trong nhịp báo trước, rồi giữ ở 1. */
export function tellProgress(t: number): number {
  return Math.min(1, Math.max(0, t / BEAT.tell));
}

/** 0 trước cú va chạm, 0 → 1 xuyên qua nó, rồi giữ ở 1. */
export function impactProgress(t: number): number {
  return Math.min(1, Math.max(0, (t - BEAT.tell) / (BEAT.impact - BEAT.tell)));
}

/** 0 cho tới sau cú va chạm, rồi 0 → 1 suốt phần dư âm. */
export function afterProgress(t: number): number {
  return Math.min(1, Math.max(0, (t - BEAT.impact) / (1 - BEAT.impact)));
}

/**
 * Rung máy của phát súng: rất nhẹ, rất ngắn, và TẮT HẲN.
 *
 * Trần 150ms là một trần cứng chứ không phải một tham số để chỉnh: rung lâu hơn
 * thì thành một hiệu ứng, mà đây chỉ là một cú giật của khung hình. Trả về 0
 * ngay khi hết, nên không có gì phải "khôi phục lại" vị trí camera.
 */
export const SHAKE_MS = 140;
export const SHAKE_AMPLITUDE = 0.06;

export function shakeOffset(elapsedMs: number): number {
  if (!(elapsedMs >= 0) || elapsedMs >= SHAKE_MS) return 0;
  const remaining = 1 - elapsedMs / SHAKE_MS;
  return Math.sin((elapsedMs / SHAKE_MS) * Math.PI * 3) * SHAKE_AMPLITUDE * remaining * remaining;
}

/**
 * Toàn bộ luật rung máy, trong MỘT hàm.
 *
 * Ba điều kiện, và cả ba đều phải khẳng định được: chỉ phát súng của Thợ Săn
 * mới rung, chỉ rung trong 140ms ngay sau cú va chạm, và giảm chuyển động thì
 * KHÔNG rung. Viết ba điều kiện ấy rải trong vòng vẽ thì chúng chỉ đúng cho tới
 * lần sửa tiếp theo; gom vào đây thì chúng có test.
 *
 * `stepDurationMs` là thời lượng phần diễn của một bước, để hàm này không phải
 * biết hằng số của bản dựng cảnh.
 */
export function shakeFor(
  effect: VillageEffect | null,
  sinceStepMs: number,
  stepDurationMs: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return 0;
  if (effect !== "HUNTER_SHOT") return 0;
  return shakeOffset(sinceStepMs - stepDurationMs * BEAT.tell);
}

// ---- Bầu trời ----

/**
 * Chỗ đứng của mặt trăng trong khung, theo TOẠ ĐỘ KHUNG HÌNH chứ không theo toạ
 * độ của làng.
 *
 * Trăng ở xa vô cùng nên thị sai của nó bằng không - đặt nó theo hệ camera là
 * đúng về mặt vật lý, không phải một mẹo. Nhưng lý do thật là khung hình: bản
 * đầu cắm trăng ở một hướng cố định trong hệ camera, và trên khung ngang thì
 * hướng đó rơi vào giữa trời, còn trên khung dọc thì nó dạt ra sát mép. Tính
 * ngược từ vị trí mong muốn TRONG KHUNG ra hướng thì cả hai khung đều đặt trăng
 * vào đúng một phần ba phía trên, lệch trái - ngay trên rìa rừng, không tách rời
 * khỏi ngôi làng.
 */
export const MOON_NDC = { x: -0.46, y: 0.7 } as const;
export const MOON_DISTANCE = 58;

export function moonDirection(aspect: number): Point3 {
  const { vertical, horizontal } = halfFovs(aspect);
  const x = MOON_NDC.x * Math.tan(horizontal);
  const y = MOON_NDC.y * Math.tan(vertical);
  const length = Math.hypot(x, y, 1);
  // `-z` là hướng nhìn tới trong hệ toạ độ camera của Three.js.
  return { x: x / length, y: y / length, z: -1 / length };
}
