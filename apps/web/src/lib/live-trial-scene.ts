import type { TrialStageAct, TrialVerdict } from "./live-trial";
import { TRIAL_HEX } from "./live-trial-palette";
import { createDisposableRegistry, type DisposableRegistry } from "./village-memory-resources";

/**
 * Bản dựng Three.js của sân khấu "Phiên toà sống".
 *
 * KHÔNG `import` three ở đầu file - chỉ `import type`. Cả module này đi qua một
 * `import()` động cùng lúc với three trong `TrialStageCanvas`, và một import
 * tĩnh ở đây sẽ kéo cả thư viện vào chunk đầu của phòng chơi, tức là vào lượt
 * tải của mọi người - kể cả những người để tính năng này TẮT, và mặc định là
 * tắt.
 *
 * Sổ tài nguyên thì dùng lại `village-memory-resources`: nó không biết Three.js
 * tồn tại (toàn kiểu cấu trúc), nên `import` nó không mở lại cánh cửa vừa đóng.
 *
 * BỐN luật của cả file, cả bốn đều là luật hiệu năng:
 *
 *   1. Mọi geometry, material và vật thể sinh ra ở `buildTrialScene`. Sau lời
 *      gọi đó, đổi chặng hay đổi số phiếu chỉ là đặt lại thông số - không có
 *      renderer thứ hai, không có scene thứ hai, không một `new` nào.
 *   2. Vòng vẽ không cấp phát: không mảng mới, không `Vector3` mới. Những gì
 *      cần đã nằm sẵn ở `tmp*`.
 *   3. Hình khối dựng tại chỗ bằng primitive của three. Không GLTF, và file này
 *      không tự tải gì từ ngoài - nó không được phép nhắc tới `TextureLoader`.
 *
 *      MỘT ngoại lệ, và nó không phá luật mà đi vòng qua: chân dung bị cáo là
 *      một texture. Nhưng file này không tải nó - `TrialStageCanvas` đưa hàm
 *      tải vào qua `options.loadTexture`. Nhờ vậy việc dựng cảnh vẫn là một
 *      phép đồng bộ, vẫn chạy trong `node:test` không cần mạng lẫn GPU, và
 *      quan trọng nhất: bục KHÔNG BAO GIỜ trống trong lúc chờ - khối đầu trơn
 *      ở nguyên đó cho tới khi texture về, và ở lại luôn nếu nó không về.
 *   4. Không shadow map, không post-processing. Chiều sâu đến từ ba nguồn sáng
 *      và hai quầng sáng giả - tất cả gần như miễn phí.
 *
 * Và một luật KHÔNG phải hiệu năng, quan trọng hơn cả bốn luật trên: cảnh này
 * không bao giờ biết ai đã bỏ phiếu gì. Nó nhận đúng hai con số đã tính trọng
 * số cùng một độ nghiêng, và vòng khán giả thì dựng từ sĩ số phòng - một con số
 * công khai, đứng yên suốt cả phiên. Không có đường nào để đọc ngược ra danh
 * tính, vì dữ liệu ấy chưa từng đi vào đây.
 */

type ThreeModule = typeof import("three");
type Scene3D = import("three").Scene;
type Camera3D = import("three").PerspectiveCamera;
type Object3D = import("three").Object3D;
type Mesh3D = import("three").Mesh;
type Material3D = import("three").MeshBasicMaterial;
type Standard3D = import("three").MeshLambertMaterial;
type Vector3D = import("three").Vector3;
type Light3D = import("three").DirectionalLight;
type BufferGeometry3D = import("three").BufferGeometry;
type Texture3D = import("three").Texture;

/** Cú lia camera giữa hai chặng. Ngắn hơn hẳn một nhịp thao tác. */
export const CAMERA_GLIDE_MS = 900;
/** Một con dấu rơi vào đĩa cân. */
export const STAMP_MS = 560;
/** Nhịp phán quyết: trần trên của "khoảng 1-1,5 giây". */
export const VERDICT_MS = 1200;
/** Đèn ấm chuyển trạng thái. */
export const LIGHT_FADE_MS = 700;
/** Cán cân nghiêng tới tương quan mới. */
export const TILT_MS = 420;

/**
 * Số con dấu dựng sẵn cho MỖI bên, và nó là một cái trần cố ý.
 *
 * Phiếu tới dồn dập là chuyện bình thường ở cuối pha. Nếu mỗi lá phiếu sinh ra
 * một vật thể mới thì một phòng 15 người sẽ để lại vài chục con dấu trong bộ
 * nhớ GPU, và hàng đợi hiệu ứng còn diễn tiếp sau khi bảng số đã đứng yên từ
 * lâu - tức là hình ảnh đang mô tả một trạng thái đã lỗi thời. Bốn con dấu quay
 * vòng thì con dấu thứ năm cướp lại chỗ của con dấu cũ nhất: hiệu ứng luôn nói
 * về lá phiếu VỪA tới, và số lượng vật thể không bao giờ nhích lên.
 */
export const TOKENS_PER_SIDE = 4;

/** Bị cáo lệch trái, cán cân lệch phải: cả hai cùng lọt khung ở chặng bỏ phiếu. */
export const ACCUSED_X = -0.95;
export const SCALES_X = 1.85;

/** Góc nghiêng tối đa của đòn cân (radian). Đủ đọc, chưa tới mức đổ. */
const MAX_TILT = 0.3;

export interface TrialSceneModel {
  /**
   * Số bóng người trong vòng khán giả.
   *
   * Sĩ số phòng, không phải số cử tri và càng không phải số phiếu. Xem
   * `TrialStageView.audience`.
   */
  audience: number;
  /**
   * Sprite sheet chân dung của bị cáo, hoặc null/thiếu thì để khối đầu trơn.
   *
   * Đường dẫn tới file 4 frame ngang, đúng bộ mà lớp chân dung 2D đang dùng -
   * xem `character-art.ts`. Cảnh chỉ lấy frame `idle` và frame `dead`.
   *
   * Null ở ba trường hợp: người chơi tự tải ảnh lên (ảnh đó không phải sheet 4
   * frame nên cắt UV 25% sẽ ra một dải vô nghĩa), avatar chưa có sheet, và
   * Save-Data. Cả ba đều rơi về khối đầu, y như trước khi có tính năng này.
   */
  portrait?: string | null;
}

export interface TrialSceneState {
  act: TrialStageAct;
  /** -1 (Tha) đến 1 (Treo). Bên gọi tính bằng `scaleTilt`. */
  tilt: number;
  verdict: TrialVerdict | null;
}

export interface TrialBeatOptions {
  /** Người xem đã bật giảm chuyển động: không lia, không rung, không token bay. */
  reduced: boolean;
  /** `performance.now()` của bên gọi. Cảnh không tự đọc đồng hồ. */
  atMs: number;
}

export interface TrialSceneHandle {
  /**
   * Đặt trạng thái hiện tại. KHÔNG dựng lại gì - chỉ đổi đích của những vật thể
   * đã có. Gọi được bao nhiêu lần cũng được, kể cả mỗi snapshot.
   */
  setState(state: TrialSceneState, options: TrialBeatOptions): void;
  /** Camera tiến tới bục xét xử. Chỉ ở cạnh mở phiên toà. */
  playOpening(options: TrialBeatOptions): void;
  /** Một con dấu ẩn danh đi vào bên tương ứng. */
  playStamp(side: "guilty" | "innocent", options: TrialBeatOptions): void;
  /** Nhịp tuyên án. */
  playVerdict(verdict: TrialVerdict, options: TrialBeatOptions): void;
  /** Một khung hình. `nowMs` lấy từ `performance.now()` của bên gọi. */
  update(nowMs: number, camera: Camera3D): void;
  dispose(): void;
}

export interface TrialSceneOptions {
  /**
   * Sổ tài nguyên do bên gọi giữ - cùng lý do như `buildVillageScene`: hàm này
   * tạo vài chục geometry rồi mới trả handle, nên hỏng ở giữa thì phần đã tạo
   * mà chưa kịp `scene.add` sẽ không còn ai cầm.
   */
  registry?: DisposableRegistry;
  /**
   * Cách tải texture chân dung. KHÔNG có mặc định, và đó là chủ ý.
   *
   * File này có một luật đã đặt từ trước và vẫn còn đúng: bản dựng cảnh không
   * tự tải tài nguyên ngoài - không `TextureLoader`, không `GLTFLoader`. Luật
   * ấy giữ cho việc dựng cảnh là một phép ĐỒNG BỘ, thuần, chạy được trong
   * `node:test` không cần mạng lẫn GPU, và không có đường nào để một cú fetch
   * chen vào giữa một phiên toà đang diễn.
   *
   * Nên chân dung đi ngược lại: bên gọi - `TrialStageCanvas`, nơi vốn đã sở
   * hữu renderer, sổ tài nguyên và cả đường xử lý mất WebGL context - đưa hàm
   * tải vào. Thiếu nó thì cảnh chỉ đơn giản không có chân dung, y như trước.
   *
   * Tiện thể: tiêm được nghĩa là test khẳng định được CẢ HAI nửa của đường bất
   * đồng bộ - lúc texture chưa về, và lúc nó về.
   */
  loadTexture?: (url: string, onLoad: () => void) => Texture3D;
}

// ---------------------------------------------------------------------------

/**
 * Một quầng sáng tròn, đặc ở tâm và tan dần ra mép.
 *
 * Thay cho ba thứ mà luật hiệu năng ở đầu file cấm: vũng đèn dưới chân bị cáo
 * (không cần SpotLight), quầng trăng (không cần bloom), và vòng loang của nhịp
 * tuyên án (không cần post-processing). Alpha nướng thẳng vào màu đỉnh, nên MỘT
 * geometry đơn vị dùng chung cho mọi quầng: đổi sắc bằng `material.color`, đổi
 * cỡ bằng `mesh.scale`, đổi độ đậm bằng `material.opacity`.
 */
function glowGeometry(THREE: ThreeModule, segments: number): BufferGeometry3D {
  const positions: number[] = [0, 0, 0];
  const colors: number[] = [1, 1, 1, 1];
  const indices: number[] = [];

  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    positions.push(Math.cos(angle), Math.sin(angle), 0);
    colors.push(1, 1, 1, 0);
    indices.push(0, index + 1, ((index + 1) % segments) + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  return geometry;
}

/** 0→1 mượt hai đầu. Dùng cho cả cú lia camera lẫn con dấu rơi. */
function easeInOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
}

/** Tiến độ của một nhịp đã bắt đầu ở `startMs`; 1 là đã diễn xong. */
function progress(nowMs: number, startMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, (nowMs - startMs) / durationMs));
}

/** Vị trí camera và điểm nhìn của từng chặng. Sáu con số, không hơn. */
interface CameraPose {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
}

/**
 * Khung hình của từng chặng.
 *
 * DEFENSE tiến sát bục và bỏ cán cân ra ngoài mép: lúc ấy chưa có phiếu nào để
 * mà nhìn, và thứ duy nhất đang diễn ra là một người đang nói. FINAL_VOTE lùi
 * lại vừa đủ để cả bị cáo lẫn cán cân cùng trong khung - đó mới là lúc hai thứ
 * đó nói chuyện với nhau.
 */
const POSES: Record<TrialStageAct, CameraPose> = {
  DEFENSE: { px: -0.55, py: 1.95, pz: 4.9, tx: ACCUSED_X, ty: 1.05, tz: 0 },
  FINAL_VOTE: { px: 0.3, py: 2.35, pz: 6.5, tx: 0.35, ty: 1.0, tz: 0 },
  VERDICT: { px: 0.15, py: 2.15, pz: 6.0, tx: 0.2, ty: 1.0, tz: 0 },
};

/** Khung mở màn: đứng xa hơn hẳn, để cú tiến vào bục có chỗ mà diễn. */
const OPENING_POSE: CameraPose = { px: -0.3, py: 3.1, pz: 8.6, tx: ACCUSED_X, ty: 0.9, tz: 0 };

/** Độ sáng đèn ấm theo chặng. Phán quyết ghi đè lên bảng này. */
const LAMP_LEVEL: Record<TrialStageAct, number> = {
  // Biện hộ: đèn dồn hết vào bị cáo.
  DEFENSE: 1,
  // Bỏ phiếu: hạ xuống một nấc và trả ánh sáng về cho cả quảng trường - lúc này
  // câu hỏi không còn là "người này nói gì" mà là "cả làng đang nghiêng về đâu".
  FINAL_VOTE: 0.62,
  VERDICT: 0.62,
};

// ---------------------------------------------------------------------------

interface Token {
  mesh: Mesh3D;
  material: Material3D;
  /** Mốc bắt đầu rơi; `-1` là đang không dùng. */
  startMs: number;
  /** Cao độ xuất phát và điểm đáp, tính sẵn để vòng vẽ khỏi phải tính lại. */
  fromY: number;
  toY: number;
}

export function buildTrialScene(
  THREE: ThreeModule,
  scene: Scene3D,
  model: TrialSceneModel,
  options: TrialSceneOptions = {},
): TrialSceneHandle {
  const registry = options.registry ?? createDisposableRegistry();
  const track = registry.track;
  const owned = options.registry === undefined;

  try {
    return assemble(THREE, scene, model, registry, track, owned, options.loadTexture);
  } catch (error) {
    // Sổ của chính mình thì tự dọn trước khi ném tiếp; sổ của bên gọi thì để
    // bên gọi dọn - họ còn cầm cả những thứ khác của cùng lần khởi tạo này.
    if (owned) registry.disposeAll();
    throw error;
  }
}

function assemble(
  THREE: ThreeModule,
  scene: Scene3D,
  model: TrialSceneModel,
  registry: DisposableRegistry,
  track: DisposableRegistry["track"],
  owned: boolean,
  load: TrialSceneOptions["loadTexture"],
): TrialSceneHandle {
  const root = new THREE.Group();
  scene.add(root);

  // ---- Ánh sáng: ba nguồn, không hơn ----
  const hemi = new THREE.HemisphereLight(TRIAL_HEX.fillSky, TRIAL_HEX.fillGround, 0.6);
  root.add(hemi);

  const moonLight: Light3D = new THREE.DirectionalLight(TRIAL_HEX.moonLight, 0.7);
  moonLight.position.set(-3.5, 5.5, -2.5);
  root.add(moonLight);

  /*
   * Đèn ấm là nguồn sáng DUY NHẤT thay đổi trong cả cảnh.
   *
   * Nó tắt dần khi bị treo và mở rộng khi được tha, nên nó phải là một tay cầm
   * riêng chứ không phải một thông số nằm lẫn trong bảng. Đây cũng là lý do
   * không dùng SpotLight: một cái đèn rọi thật cần shadow map mới ra hình, mà
   * shadow map thì cả file này đã cấm ở dòng đầu.
   */
  const lampLight: Light3D = new THREE.DirectionalLight(TRIAL_HEX.lamp, 0.95);
  lampLight.position.set(1.6, 3.2, 3.4);
  root.add(lampLight);

  // ---- Vật liệu dùng chung ----
  const lambert = (hex: number): Standard3D =>
    track(new THREE.MeshLambertMaterial({ color: hex }));

  const groundMat = lambert(TRIAL_HEX.groundOuter);
  const plazaMat = lambert(TRIAL_HEX.plaza);
  const daisMat = lambert(TRIAL_HEX.dais);
  const daisShadeMat = lambert(TRIAL_HEX.daisShade);
  const accusedMat = lambert(TRIAL_HEX.accused);
  const accusedShadeMat = lambert(TRIAL_HEX.accusedShade);
  const crowdMat = lambert(TRIAL_HEX.crowd);
  const frameMat = lambert(TRIAL_HEX.scaleFrame);
  const guiltyMat = lambert(TRIAL_HEX.guilty);
  const innocentMat = lambert(TRIAL_HEX.innocent);

  const glow = track(glowGeometry(THREE, 40));
  const glowMaterial = (hex: number, opacity: number): Material3D =>
    track(
      new THREE.MeshBasicMaterial({
        color: hex,
        vertexColors: true,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );

  // ---- Nền: đất, quảng trường, quầng sáng ----
  const groundGeo = track(new THREE.CircleGeometry(11, 40));
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);

  const plazaGeo = track(new THREE.CircleGeometry(4.4, 32));
  const plaza = new THREE.Mesh(plazaGeo, plazaMat);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.01;
  root.add(plaza);

  const plazaGlowMat = glowMaterial(TRIAL_HEX.plazaGlow, 0.2);
  const plazaGlow = new THREE.Mesh(glow, plazaGlowMat);
  plazaGlow.rotation.x = -Math.PI / 2;
  plazaGlow.position.y = 0.02;
  plazaGlow.scale.setScalar(5.2);
  root.add(plazaGlow);

  // ---- Trăng: điểm lạnh của cảnh, đứng yên suốt phiên ----
  const moonGeo = track(new THREE.CircleGeometry(0.62, 24));
  const moonMat = track(new THREE.MeshBasicMaterial({ color: TRIAL_HEX.moon }));
  const moon = new THREE.Mesh(moonGeo, moonMat);
  moon.position.set(-5.4, 5.2, -9);
  root.add(moon);

  const moonHalo = new THREE.Mesh(glow, glowMaterial(TRIAL_HEX.moonHalo, 0.42));
  moonHalo.position.copy(moon.position);
  moonHalo.position.z -= 0.05;
  moonHalo.scale.setScalar(2.6);
  root.add(moonHalo);

  // ---- Bục xét xử ----
  const daisGeo = track(new THREE.CylinderGeometry(1.35, 1.5, 0.42, 10));
  const dais = new THREE.Mesh(daisGeo, daisMat);
  dais.position.set(ACCUSED_X, 0.21, 0);
  root.add(dais);

  const stepGeo = track(new THREE.CylinderGeometry(1.7, 1.85, 0.16, 10));
  const daisStep = new THREE.Mesh(stepGeo, daisShadeMat);
  daisStep.position.set(ACCUSED_X, 0.08, 0);
  root.add(daisStep);

  // ---- Bị cáo: tâm điểm, và cố ý không mang một dấu hiệu vai nào ----
  const accused = new THREE.Group();
  accused.position.set(ACCUSED_X, 0.42, 0);
  root.add(accused);

  const portraitUrl = model.portrait ?? null;

  /*
   * Có mặt người thật ở trên thì thân phải là QUẦN ÁO.
   *
   * `TRIAL_HEX.accused` là một sắc sáng trung tính, và dưới ngọn đèn ấm - điểm
   * ấm duy nhất của cảnh - nó đọc ra như da thịt. Chấp nhận được khi cái đầu
   * cũng cùng màu ấy, vì cả hình nộm là một khối trừu tượng. Nhưng khi bên trên
   * là một khuôn mặt được vẽ, cái thân sáng màu da bên dưới biến nhân vật thành
   * một người không mặc gì. Sắc tối hơn kéo nó về đúng nghĩa áo.
   */
  const bodyGeo = track(new THREE.CylinderGeometry(0.23, 0.32, 0.92, 6));
  const body = new THREE.Mesh(bodyGeo, portraitUrl ? accusedShadeMat : accusedMat);
  body.position.y = 0.46;
  accused.add(body);

  const cloakGeo = track(new THREE.ConeGeometry(0.42, 0.58, 6));
  const cloak = new THREE.Mesh(cloakGeo, accusedShadeMat);
  cloak.position.y = 0.72;
  accused.add(cloak);

  const headGeo = track(new THREE.IcosahedronGeometry(0.17, 0));
  const head = new THREE.Mesh(headGeo, accusedMat);
  head.position.y = 1.12;
  head.name = "accused-head";
  accused.add(head);

  /*
   * Khuôn mặt bị cáo, và vì sao nó dựng theo kiểu "cả hai cùng tồn tại".
   *
   * Hàm dựng cảnh là ĐỒNG BỘ, còn tải texture thì không. Ẩn khối đầu ngay lúc
   * dựng nghĩa là có một quãng bục TRỐNG - rơi đúng vào lúc camera đang tiến
   * tới nó ở cạnh mở phiên toà. Nên khối đầu cứ ở đó, billboard dựng sẵn nhưng
   * ẩn, và chỉ khi texture về hai thứ mới đổi vai cho nhau.
   *
   * Phần thưởng: nếu ảnh 404 hay mạng chết thì `onLoad` không bao giờ chạy, và
   * cảnh ở nguyên trạng thái cũ. Đường lui có sẵn mà không phải viết một nhánh
   * xử lý lỗi nào.
   *
   * `MeshBasicMaterial` chứ KHÔNG phải lambert: cảnh này rất tối và chỉ có một
   * nguồn ấm, nên bất cứ khuôn mặt nào ăn đèn của nó đều chìm thành một mảng
   * bệt. Dựng thử cả hai rồi mới chốt - bản ăn đèn tệ hơn hẳn.
   */
  let portraitMesh: Mesh3D | null = null;
  let portraitTex: Texture3D | null = null;

  if (portraitUrl && load) {
    const tex = load(portraitUrl, () => {
      if (!portraitMesh) return;
      portraitMesh.visible = true;
      head.visible = false;
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    // Bốn frame nằm ngang; lấy frame 0 (`idle`). Xem `PORTRAIT_FRAMES`.
    tex.repeat.set(0.25, 1);
    tex.offset.set(0, 0);
    track(tex);
    portraitTex = tex;

    const portraitGeo = track(new THREE.PlaneGeometry(0.46, 0.46));
    const portraitMat = track(
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    portraitMesh = new THREE.Mesh(portraitGeo, portraitMat);
    /*
     * Cao 1.06 chứ không phải 1.12 của khối đầu: bức chân dung là ảnh BÁN THÂN,
     * nên mép dưới của nó phải chìm vào bóng áo choàng thay vì cắt ngang qua.
     * Nhích ra trước một chút để không z-fight với cái nón áo choàng.
     */
    portraitMesh.position.set(0, 1.06, 0.05);
    portraitMesh.visible = false;
    portraitMesh.name = "accused-portrait";
    accused.add(portraitMesh);
  }

  /*
   * Vũng đèn dưới chân, và quầng ấm sau lưng.
   *
   * Hai mảnh này là toàn bộ "ánh sáng tập trung vào bị cáo" mà thiết kế đòi -
   * cộng với `lampLight`. Cả ba cùng một tay cầm độ sáng, nên khi phán quyết là
   * Treo thì chúng tắt CÙNG NHAU chứ không phải cái tắt trước cái tắt sau.
   */
  const lampPoolMat = glowMaterial(TRIAL_HEX.lamp, 0.5);
  const lampPool = new THREE.Mesh(glow, lampPoolMat);
  lampPool.rotation.x = -Math.PI / 2;
  lampPool.position.set(ACCUSED_X, 0.44, 0);
  lampPool.scale.setScalar(1.75);
  root.add(lampPool);

  const lampAuraMat = glowMaterial(TRIAL_HEX.lampWarm, 0.24);
  const lampAura = new THREE.Mesh(glow, lampAuraMat);
  lampAura.position.set(ACCUSED_X, 1.05, -0.55);
  lampAura.scale.setScalar(1.9);
  root.add(lampAura);

  // ---- Vòng khán giả: bối cảnh, và CHỈ bối cảnh ----
  /*
   * `InstancedMesh` chứ không phải mười lăm cặp mesh rời: một lời gọi vẽ cho cả
   * đám đông thay vì ba mươi. Chúng dùng chung MỘT vật liệu và không bao giờ
   * được đặt màu riêng cho từng cá thể - đó vừa là chuyện hiệu năng, vừa là
   * chuyện giữ bí mật: không có cách nào để một bóng người sáng lên vì ai đó
   * vừa bỏ phiếu, bởi vì chúng không có màu riêng để mà sáng.
   */
  const audience = Math.max(6, Math.min(18, Math.round(model.audience) || 6));
  const crowdBodyGeo = track(new THREE.CylinderGeometry(0.14, 0.2, 0.72, 5));
  const crowdHeadGeo = track(new THREE.IcosahedronGeometry(0.13, 0));
  const crowdBodies = new THREE.InstancedMesh(crowdBodyGeo, crowdMat, audience);
  const crowdHeads = new THREE.InstancedMesh(crowdHeadGeo, crowdMat, audience);
  root.add(crowdBodies);
  root.add(crowdHeads);

  // Ma trận dựng MỘT LẦN ở đây, không phải mỗi khung hình.
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < audience; index += 1) {
    // Chừa một khoảng trống phía trước máy quay để đám đông không che mất bục.
    const angle = Math.PI * 0.32 + (index / audience) * Math.PI * 2 * 0.86;
    const radius = 4.9 + ((index * 37) % 7) * 0.11;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    matrix.makeTranslation(x, 0.36, z);
    crowdBodies.setMatrixAt(index, matrix);
    matrix.makeTranslation(x, 0.86, z);
    crowdHeads.setMatrixAt(index, matrix);
  }
  crowdBodies.instanceMatrix.needsUpdate = true;
  crowdHeads.instanceMatrix.needsUpdate = true;

  // ---- Cán cân ----
  const scales = new THREE.Group();
  scales.position.set(SCALES_X, 0, 0.35);
  root.add(scales);

  const baseGeo = track(new THREE.CylinderGeometry(0.42, 0.5, 0.14, 8));
  const scaleBase = new THREE.Mesh(baseGeo, frameMat);
  scaleBase.position.y = 0.07;
  scales.add(scaleBase);

  const postGeo = track(new THREE.CylinderGeometry(0.06, 0.09, 1.5, 6));
  const post = new THREE.Mesh(postGeo, frameMat);
  post.position.y = 0.82;
  scales.add(post);

  const beam = new THREE.Group();
  beam.position.y = 1.55;
  scales.add(beam);

  const beamGeo = track(new THREE.BoxGeometry(1.62, 0.06, 0.09));
  const beamBar = new THREE.Mesh(beamGeo, frameMat);
  beam.add(beamBar);

  const cordGeo = track(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 4));
  /*
   * Hai đĩa cân KHÁC HÌNH, không chỉ khác màu.
   *
   * Đĩa Treo là một hình sáu cạnh có góc; đĩa Tha là một đĩa tròn trơn. Màu vẫn
   * còn đó và vẫn giúp, nhưng nó là lớp thứ hai: người không phân biệt được đỏ
   * với lục vẫn tách được hai bên bằng hình - và ở lớp DOM phía trên, hai bên
   * còn có nhãn chữ riêng.
   */
  const guiltyPanGeo = track(new THREE.CylinderGeometry(0.3, 0.26, 0.06, 6));
  const innocentPanGeo = track(new THREE.CylinderGeometry(0.3, 0.26, 0.06, 20));

  function hangPan(x: number, geometry: BufferGeometry3D, material: Standard3D): Object3D {
    const arm = new THREE.Group();
    arm.position.x = x;
    beam.add(arm);

    const cord = new THREE.Mesh(cordGeo, frameMat);
    cord.position.y = -0.18;
    arm.add(cord);

    const pan = new THREE.Mesh(geometry, material);
    pan.position.y = -0.36;
    arm.add(pan);
    return arm;
  }

  // Treo bên trái, Tha bên phải - cùng thứ tự với hai con số ở lớp DOM, nên mắt
  // không phải đổi chiều khi nhìn từ bảng số xuống cán cân.
  const guiltyArm = hangPan(-0.76, guiltyPanGeo, guiltyMat);
  const innocentArm = hangPan(0.76, innocentPanGeo, innocentMat);

  // ---- Con dấu: bể dựng sẵn, quay vòng ----
  const tokenGeo = track(new THREE.CylinderGeometry(0.1, 0.1, 0.035, 8));
  function makeTokens(arm: Object3D, hex: number): Token[] {
    return Array.from({ length: TOKENS_PER_SIDE }, () => {
      // Một vật liệu cho MỖI con dấu: chúng mờ dần lệch pha nhau, và một vật
      // liệu dùng chung sẽ khiến bốn con dấu cùng nhạt đi một lượt. Bốn vật
      // liệu tạo đúng một lần lúc dựng, không phải mỗi lá phiếu.
      const material = track(
        new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0 }),
      );
      const mesh = new THREE.Mesh(tokenGeo, material);
      // Đặt tên để bộ test tìm được đúng những con dấu này giữa vài chục vật
      // thể khác - không có tên thì "giảm chuyển động không có token bay" chỉ
      // kiểm được một tập rỗng và luôn xanh.
      mesh.name = "token";
      mesh.visible = false;
      arm.add(mesh);
      return { mesh, material, startMs: -1, fromY: 0.9, toY: -0.29 };
    });
  }
  const tokens: Record<"guilty" | "innocent", Token[]> = {
    guilty: makeTokens(guiltyArm, TRIAL_HEX.guilty),
    innocent: makeTokens(innocentArm, TRIAL_HEX.innocent),
  };
  const tokenCursor = { guilty: 0, innocent: 0 };

  // ---- Vòng loang của nhịp tuyên án ----
  const pulseMat = glowMaterial(TRIAL_HEX.lamp, 0);
  const pulse = new THREE.Mesh(glow, pulseMat);
  pulse.rotation.x = -Math.PI / 2;
  pulse.position.set(ACCUSED_X, 0.46, 0);
  pulse.visible = false;
  root.add(pulse);

  // ---- Trạng thái động. Mọi thứ dưới đây là SỐ, không phải vật thể mới ----
  let pose: CameraPose = POSES.DEFENSE;
  let poseFrom: CameraPose = POSES.DEFENSE;
  let poseStart = 0;
  let poseDuration = 0;

  let tiltCurrent = 0;
  let tiltFrom = 0;
  let tiltTarget = 0;
  let tiltStart = 0;
  let tiltDuration = 0;

  let lampFrom = LAMP_LEVEL.DEFENSE;
  let lampTarget = LAMP_LEVEL.DEFENSE;
  let lampStart = 0;
  let lampDuration = 0;
  let lampLevel = LAMP_LEVEL.DEFENSE;

  let pulseStart = -1;
  let pulseSpread = 3.4;

  let currentAct: TrialStageAct | null = null;
  let currentVerdict: TrialVerdict | null = null;
  let disposed = false;

  // Vector tạm của vòng vẽ: hai cái, dựng một lần, không bao giờ thay bằng cái mới.
  const tmpPosition: Vector3D = new THREE.Vector3();
  const tmpTarget: Vector3D = new THREE.Vector3();

  /*
   * Điểm XUẤT PHÁT của cú lia được CHÉP vào một ô nhớ riêng.
   *
   * Không giữ tham chiếu: chỗ gọi thường truyền vào chính khung camera đang
   * hiện, mà ô nhớ tính khung ấy (`poseScratch`) bị ghi đè ở mỗi khung hình.
   * Giữ tham chiếu tới nó nghĩa là điểm xuất phát của cú lia chạy theo camera,
   * và cú lia sẽ không bao giờ đi tới đâu cả.
   */
  const poseAnchor: CameraPose = { ...POSES.DEFENSE };

  function aimCamera(next: CameraPose, from: CameraPose, options: TrialBeatOptions): void {
    poseAnchor.px = from.px;
    poseAnchor.py = from.py;
    poseAnchor.pz = from.pz;
    poseAnchor.tx = from.tx;
    poseAnchor.ty = from.ty;
    poseAnchor.tz = from.tz;
    poseFrom = poseAnchor;
    pose = next;
    poseStart = options.atMs;
    // Giảm chuyển động thì KHÔNG lia: nhảy thẳng tới khung mới.
    poseDuration = options.reduced ? 0 : CAMERA_GLIDE_MS;
  }

  /** Khung hiện tại của camera, dùng làm điểm xuất phát cho cú lia kế tiếp. */
  function currentPose(nowMs: number, into: CameraPose): CameraPose {
    const t = easeInOut(progress(nowMs, poseStart, poseDuration));
    into.px = poseFrom.px + (pose.px - poseFrom.px) * t;
    into.py = poseFrom.py + (pose.py - poseFrom.py) * t;
    into.pz = poseFrom.pz + (pose.pz - poseFrom.pz) * t;
    into.tx = poseFrom.tx + (pose.tx - poseFrom.tx) * t;
    into.ty = poseFrom.ty + (pose.ty - poseFrom.ty) * t;
    into.tz = poseFrom.tz + (pose.tz - poseFrom.tz) * t;
    return into;
  }

  // Ô nhớ cho `currentPose`: nó được gọi ở đường đổi chặng, không phải mỗi khung
  // hình, nhưng vẫn không có lý do gì để cấp phát một object mới mỗi lần.
  const poseScratch: CameraPose = { ...POSES.DEFENSE };

  function setLamp(level: number, options: TrialBeatOptions, durationMs: number): void {
    lampFrom = lampLevel;
    lampTarget = level;
    lampStart = options.atMs;
    lampDuration = options.reduced ? 0 : durationMs;
  }

  const handle: TrialSceneHandle = {
    setState(state, options) {
      if (disposed) return;

      /*
       * Bản án Treo làm khuôn mặt tái đi.
       *
       * Frame 3 của sheet là bản đã rút sắc và nâng sáng - cùng tấm ảnh, không
       * tốn thêm byte nào. Đổi ở đây chứ không ở `playVerdict` vì `setState` là
       * đường DUY NHẤT mà mọi phiên toà đều đi qua, kể cả khi khôi phục lại một
       * ván đang dở: một người vào lại phòng sau khi bản án đã tuyên vẫn phải
       * thấy đúng khuôn mặt ấy.
       */
      if (portraitTex) {
        portraitTex.offset.x = state.verdict === "LYNCHED" ? 0.75 : 0;
      }

      if (state.act !== currentAct) {
        // Đổi chặng: lia từ khung ĐANG hiện chứ không từ khung của chặng trước.
        // Một cú lia bị cắt ngang giữa chừng mà nhảy về điểm xuất phát cũ là một
        // cú giật, và nó rơi đúng vào lúc chuyển sang bỏ phiếu.
        aimCamera(POSES[state.act], currentPose(options.atMs, poseScratch), options);
        currentAct = state.act;
        // Phán quyết có mức sáng riêng, đặt ở `playVerdict`; đừng ghi đè nó.
        if (!currentVerdict) setLamp(LAMP_LEVEL[state.act], options, LIGHT_FADE_MS);
      }

      const tilt = Math.max(-1, Math.min(1, state.tilt));
      if (tilt !== tiltTarget) {
        tiltFrom = tiltCurrent;
        tiltTarget = tilt;
        tiltStart = options.atMs;
        tiltDuration = options.reduced ? 0 : TILT_MS;
      }

      // Trạng thái phán quyết đến từ snapshot, nên nó cũng phải dựng được TRỰC
      // TIẾP: người nối lại giữa ELIMINATION không có nhịp diễn nào, nhưng vẫn
      // phải thấy đúng ánh sáng của một phiên đã tuyên.
      if (state.verdict && state.verdict !== currentVerdict) {
        currentVerdict = state.verdict;
        setLamp(state.verdict === "LYNCHED" ? 0 : 1.15, options, VERDICT_MS);
      } else if (!state.verdict && currentVerdict) {
        currentVerdict = null;
        setLamp(LAMP_LEVEL[state.act], options, LIGHT_FADE_MS);
      }
    },

    playOpening(options) {
      if (disposed) return;
      // Camera đứng xa rồi TIẾN vào bục. Giảm chuyển động thì `aimCamera` cho
      // thời lượng 0, tức là đứng thẳng ở khung biện hộ - không có cú lia nào.
      aimCamera(POSES.DEFENSE, options.reduced ? POSES.DEFENSE : OPENING_POSE, options);
      currentAct = "DEFENSE";
      currentVerdict = null;
      setLamp(LAMP_LEVEL.DEFENSE, options, LIGHT_FADE_MS);
    },

    playStamp(side, options) {
      // Giảm chuyển động: không có token bay. Con số ở DOM đã đổi rồi, và cán
      // cân cũng đã nghiêng thẳng tới tương quan mới ở `setState`.
      if (disposed || options.reduced) return;
      const pool = tokens[side];
      const token = pool[tokenCursor[side] % pool.length];
      tokenCursor[side] += 1;
      token.startMs = options.atMs;
      token.mesh.visible = true;
    },

    playVerdict(verdict, options) {
      if (disposed) return;
      currentVerdict = verdict;
      setLamp(verdict === "LYNCHED" ? 0 : 1.15, options, VERDICT_MS);
      if (options.reduced) return;
      // Một nhịp duy nhất: vòng loang từ chân bục. Không rung máy, không chớp
      // trắng, và không có gì mô phỏng một cái giá treo cổ.
      pulseStart = options.atMs;
      pulseSpread = verdict === "LYNCHED" ? 3.2 : 4.6;
      pulseMat.color.setHex(verdict === "LYNCHED" ? TRIAL_HEX.guilty : TRIAL_HEX.innocent);
      pulse.visible = true;
    },

    update(nowMs, camera) {
      if (disposed) return;

      // --- Camera ---
      const now = currentPose(nowMs, poseScratch);
      tmpPosition.set(now.px, now.py, now.pz);
      tmpTarget.set(now.tx, now.ty, now.tz);
      camera.position.copy(tmpPosition);
      camera.lookAt(tmpTarget);

      /*
       * Mặt quay theo camera, và phải làm SAU khi camera đã về chỗ của khung
       * hình này - làm trước thì mặt luôn chậm một khung, và ở cạnh mở phiên
       * toà (camera đang lia) một khung chậm là nhìn ra được.
       */
      if (portraitMesh) portraitMesh.lookAt(camera.position);

      // --- Cán cân ---
      const tiltT = easeInOut(progress(nowMs, tiltStart, tiltDuration));
      tiltCurrent = tiltFrom + (tiltTarget - tiltFrom) * tiltT;
      /*
       * Dấu CỘNG, và đây là chỗ đã từng sai.
       *
       * Đĩa Treo treo ở đầu ÂM của đòn cân (`hangPan(-0.76, ...)`). Quay quanh
       * trục Z một góc dương thì điểm ở x âm đi XUỐNG - y' = x·sin(θ) - và đó
       * đúng là điều một cái cân phải làm khi bên đó nặng hơn. Bản đầu để dấu
       * trừ, nên `tilt = 1` (Treo nhiều phiếu hơn) lại nâng đĩa Treo lên cao
       * hơn đĩa Tha: một cái cân chạy ngược, và người chơi đọc ngược luôn tình
       * thế của phiên toà.
       */
      beam.rotation.z = tiltCurrent * MAX_TILT;
      // Đĩa cân luôn NẰM NGANG: chúng treo trên dây, nên chúng không nghiêng
      // theo đòn cân. Xoay ngược đúng bằng góc của đòn là đủ, và nó cũng là thứ
      // làm cán cân đọc ra như một cái cân chứ như một cái bập bênh.
      guiltyArm.rotation.z = -tiltCurrent * MAX_TILT;
      innocentArm.rotation.z = -tiltCurrent * MAX_TILT;
      // Bên nặng hơn tụt xuống: đòn nghiêng đã nói điều đó, đây chỉ là phần bù
      // để hai đĩa không lơ lửng ngang nhau.
      guiltyArm.position.y = -tiltCurrent * 0.06;
      innocentArm.position.y = tiltCurrent * 0.06;

      // --- Đèn ấm ---
      const lampT = easeInOut(progress(nowMs, lampStart, lampDuration));
      lampLevel = lampFrom + (lampTarget - lampFrom) * lampT;
      lampLight.intensity = 0.95 * lampLevel;
      lampPoolMat.opacity = 0.5 * lampLevel;
      lampAuraMat.opacity = 0.24 * lampLevel;
      // Quảng trường sáng lên khi đèn của bị cáo tắt đi: cảnh không bao giờ rơi
      // hẳn vào đen, kể cả ở nhịp treo cổ. Người chơi vẫn phải nhìn thấy bàn.
      plazaGlowMat.opacity = 0.2 + 0.12 * (1 - Math.min(1, lampLevel));

      // --- Con dấu đang rơi ---
      for (const side of ["guilty", "innocent"] as const) {
        for (const token of tokens[side]) {
          if (token.startMs < 0) continue;
          const t = progress(nowMs, token.startMs, STAMP_MS);
          if (t >= 1) {
            token.startMs = -1;
            token.mesh.visible = false;
            token.material.opacity = 0;
            continue;
          }
          const fall = easeInOut(Math.min(1, t / 0.72));
          token.mesh.position.y = token.fromY + (token.toY - token.fromY) * fall;
          // Hiện nhanh, đọng một nhịp, rồi tan: con dấu là một tín hiệu "vừa có
          // thêm một phiếu", không phải một vật thể ở lại trên đĩa cân. Ở lại
          // thì bốn con dấu sẽ trông như bốn phiếu, mà chúng không phải.
          token.material.opacity = t < 0.72 ? Math.min(1, t / 0.2) : 1 - (t - 0.72) / 0.28;
        }
      }

      // --- Vòng loang của phán quyết ---
      if (pulseStart >= 0) {
        const t = progress(nowMs, pulseStart, VERDICT_MS * 0.55);
        if (t >= 1) {
          pulseStart = -1;
          pulse.visible = false;
          pulseMat.opacity = 0;
        } else {
          const spread = 0.8 + (pulseSpread - 0.8) * easeInOut(t);
          pulse.scale.setScalar(spread);
          pulseMat.opacity = 0.5 * (1 - t);
        }
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      // Sổ của bên gọi thì bên gọi dọn - `teardownVillage` gọi `disposeAll` ngay
      // sau lời gọi này, và dọn hai lần là dọn thừa chứ không phải dọn kỹ.
      if (owned) registry.disposeAll();
      crowdBodies.dispose();
      crowdHeads.dispose();
      root.removeFromParent();
      root.clear();
    },
  };

  return handle;
}
