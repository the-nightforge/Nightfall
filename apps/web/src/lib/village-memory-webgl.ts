import type { VillageMemoryModel, VillageStep } from "./village-memory";
import {
  BEAT,
  CAMERA_FOV,
  CAMERA_GLIDE_MS,
  MOON_DISTANCE,
  VIEW_DIR,
  afterProgress,
  collectFramePoints,
  easeInOutCubic,
  effectIntensity,
  fitDistance,
  framedTarget,
  framingFor,
  impactProgress,
  moonDirection,
  shakeFor,
  smootherStep,
  tellProgress,
  type Point3,
} from "./village-memory-camera";
import { ACCENT_HEX, CURSED_HEX, EFFECT_HEX, SCENE_HEX } from "./village-memory-palette";
import { createDisposableRegistry, type DisposableRegistry } from "./village-memory-resources";

/**
 * Bản dựng Three.js của "Hồi ức Ngôi Làng".
 *
 * KHÔNG `import` three ở đầu file - chỉ `import type`. Cả module này được nạp
 * qua `import()` động cùng lúc với three, và một import tĩnh ở đây sẽ kéo ~600KB
 * vào chunk đầu của mọi người, kể cả người không bao giờ bấm nút mở.
 *
 * Cùng lẽ đó, những gì lớp React cần biết - bảng màu, phép tính khung hình - đã
 * dọn sang `village-memory-palette` và `village-memory-camera`. File này chỉ còn
 * đúng một việc: dựng hình. Không component nào được `import` tĩnh nó, và có
 * test canh đúng điều đó.
 *
 * BỐN luật của cả file, và cả bốn đều là luật hiệu năng chứ không phải sở thích:
 *
 *   1. Mọi geometry, material và vật thể sinh ra ở `buildVillageScene`. Sau lời
 *      gọi đó, đổi bước chỉ bật/tắt và đặt lại thông số.
 *   2. Vòng vẽ không cấp phát: không `new`, không mảng mới, không `Vector3` mới.
 *      Những gì cần thì đã có sẵn ở `tmp*`.
 *   3. Hình khối đều dựng tại chỗ - hộp, chóp, đĩa, vành, và hai hình quạt tự
 *      dựng cho quầng sáng. Không một file GLTF hay một tấm texture nào.
 *   4. Không shadow map, không post-processing, không bloom. Chiều sâu đến từ
 *      ba nguồn sáng, hai lớp nền và bóng tiếp đất GIẢ - tất cả đều gần như
 *      miễn phí.
 */

type ThreeModule = typeof import("three");
type Scene3D = import("three").Scene;
type Camera3D = import("three").PerspectiveCamera;
type Object3D = import("three").Object3D;
type Mesh3D = import("three").Mesh;
type BufferGeometry3D = import("three").BufferGeometry;
type Material3D = import("three").MeshBasicMaterial;
type Blending3D = import("three").Blending;

/**
 * Thời lượng phần DIỄN của một hiệu ứng.
 *
 * Ngắn hơn `STEP_DURATION_MS` để cảnh diễn xong rồi còn một nhịp lặng trước khi
 * bước sau bắt đầu. Hết khoảng này thì `t` bị kẹp ở 1 và cảnh ĐỨNG YÊN ở trạng
 * thái cuối - đó là trạng thái mà người bấm Tạm dừng, hay quay lại một bước đã
 * xem, sẽ thấy. Vì vậy trạng thái cuối phải còn đọc được: xem `effectIntensity`.
 */
export const EFFECT_MS = 3600;

export interface VillageSceneHandle {
  /**
   * Đổi bước. KHÔNG dựng lại gì - chỉ đặt lại vị trí, màu và mốc thời gian của
   * những vật thể đã có sẵn từ lúc mở.
   */
  setStep(step: VillageStep | null, options: { glide: boolean; reduced: boolean; atMs: number }): void;
  /** Một khung hình. `nowMs` lấy từ `performance.now()` của bên gọi. */
  update(nowMs: number, camera: Camera3D): void;
  dispose(): void;
}

export interface VillageSceneOptions {
  /**
   * Sổ tài nguyên do bên gọi giữ.
   *
   * Bản đầu để sổ này là một biến cục bộ trong `buildVillageScene`, và đó là
   * một lỗ hổng có thật: hàm này tạo vài chục geometry rồi mới trả về handle,
   * nên nếu nó ném ở giữa - hết bộ nhớ đồ hoạ, một hằng số của three đổi tên
   * sau khi nâng phiên bản - thì sổ ấy mất theo stack cùng với mọi thứ chưa kịp
   * `scene.add`. Cái vét scene ở `teardownVillage` chỉ với tới được những gì đã
   * VÀO scene; phần còn lại rơi im lặng.
   *
   * Truyền sổ từ ngoài thì bên gọi dọn được cả hai loại. Không truyền cũng an
   * toàn: hàm tự dựng một sổ nội bộ và tự dọn trước khi ném tiếp.
   */
  registry?: DisposableRegistry;
}

interface HouseNode {
  id: string;
  group: Object3D;
  windowMaterial: Material3D;
  /** Chiều cao thân nhà - mốc để đặt mái, phong thư và dấu Sói. */
  baseY: number;
  x: number;
  z: number;
  accentHex: number;
}

/** Ba dáng nhà. Chiều cao thân đi kèm để không phải tra lại từ geometry. */
const BODY_HEIGHTS = [0.9, 1.15, 0.78];

/** Băm ổn định một chỉ số thành 0..1. Không `Math.random`, không đọc đồng hồ. */
function jitter(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Một hình quạt tròn với độ trong suốt tản dần theo bán kính.
 *
 * Đây là công cụ chính của cả bản nâng cấp, và nó thay thế đúng những thứ mà
 * yêu cầu cấm: quầng trăng mềm mà không phải một vòng tròn UI, bóng tiếp đất mà
 * không cần shadow map, vũng sáng dưới cửa sổ mà không cần PointLight cho từng
 * nhà, sương mà không cần một tấm texture.
 *
 * Cách làm: màu đỉnh trắng, còn ALPHA giảm dần từ tâm ra mép, nướng thẳng vào
 * thuộc tính `color` bốn thành phần của geometry. `MeshBasicMaterial` nhân màu
 * vật liệu với màu đỉnh, nên MỘT geometry đơn vị dùng lại được cho mọi quầng
 * sáng: đổi sắc bằng `material.color`, đổi cỡ bằng `mesh.scale`, đổi độ đậm
 * bằng `material.opacity`.
 *
 * `stops` là các vành đồng tâm; đặt vành đầu ở bán kính 0 thì ra một quầng đặc
 * tâm, đặt nó ở bán kính dương thì ra một vành sáng mềm cả hai mép.
 */
function radialGeometry(
  THREE: ThreeModule,
  stops: readonly { r: number; a: number }[],
  segments: number,
): BufferGeometry3D {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const stop of stops) {
    // Vành bán kính 0 chỉ cần MỘT đỉnh ở tâm; lặp nó ra `segments` lần thì
    // tam giác suy biến và GPU vẽ thừa.
    const count = stop.r === 0 ? 1 : segments;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      positions.push(Math.cos(angle) * stop.r, Math.sin(angle) * stop.r, 0);
      colors.push(1, 1, 1, stop.a);
    }
  }

  let base = 0;
  for (let ring = 0; ring < stops.length - 1; ring += 1) {
    const innerCount = stops[ring].r === 0 ? 1 : segments;
    const outerStart = base + innerCount;
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments;
      const o0 = outerStart + index;
      const o1 = outerStart + next;
      if (innerCount === 1) {
        indices.push(base, o0, o1);
      } else {
        const i0 = base + index;
        const i1 = base + next;
        indices.push(i0, o0, o1, i0, o1, i1);
      }
    }
    base = outerStart;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Dựng toàn bộ ngôi làng MỘT LẦN.
 *
 * Mọi vật thể của mọi hiệu ứng đều được tạo ở đây rồi ẩn đi (`visible = false`),
 * và `setStep` chỉ bật/tắt với đặt lại thông số. Đó là điều kiện để đổi bước
 * không sinh rác GPU, và để `dispose()` biết chắc nó đã trả lại hết.
 */
export function buildVillageScene(
  THREE: ThreeModule,
  scene: Scene3D,
  model: VillageMemoryModel,
  options?: VillageSceneOptions,
): VillageSceneHandle {
  const registry = options?.registry ?? createDisposableRegistry();
  const track = registry.track;

  try {
    return assemble(THREE, scene, model, registry, track);
  } catch (error) {
    // Dựng hỏng giữa chừng thì TRẢ LẠI trước rồi mới ném tiếp. Kể cả những
    // geometry chưa kịp vào scene - đó chính là loại mà phép vét scene ở
    // `teardownVillage` không với tới được.
    registry.disposeAll();
    throw error;
  }
}

function assemble(
  THREE: ThreeModule,
  scene: Scene3D,
  model: VillageMemoryModel,
  registry: DisposableRegistry,
  track: DisposableRegistry["track"],
): VillageSceneHandle {
  const AD = THREE.AdditiveBlending;
  const ringRadius = Math.max(1, Math.hypot(model.houses[0]?.x ?? 4, model.houses[0]?.z ?? 0));
  const squareRadius = Math.max(1.6, model.groundRadius * 0.3);

  // ---- Trời và sương ----

  scene.background = new THREE.Color(SCENE_HEX.sky);
  /*
   * Sương của cả thung lũng: rẻ hơn mọi tấm phẳng trong suốt, và nó làm rìa làng
   * nhoà đi đúng như một diorama đặt trong hộp kính.
   *
   * Dải phải rộng hơn KHOẢNG CÁCH CAMERA, không chỉ hơn bán kính làng: ở khung
   * dọc camera lùi ra rất xa, và một dải sương tính theo riêng bán kính sẽ có
   * mặt phẳng xa nằm TRƯỚC cả ngôi làng, nhấn chìm cảnh thành một màu nền phẳng.
   */
  scene.fog = new THREE.Fog(SCENE_HEX.sky, model.groundRadius * 2.6, model.groundRadius * 9);

  // ---- Ánh sáng ----

  /*
   * Ba nguồn, và không cái nào thừa:
   *
   *   - `moonKey` là trăng: lạnh, chếch cao, dựng khối chính.
   *   - `rimLight` hắt từ phía đối diện để mái và sống nhà có một đường viền
   *     lạnh tách khỏi nền. Đây là thứ chữa lỗi "mái nhà, thân nhà và cây hoà
   *     thành một mảng đen" - không phải kéo cả cảnh sáng lên.
   *   - `HemisphereLight` là fill: trời xanh nhạt ở trên, đất tối ở dưới, nên
   *     mặt bên khuất trăng vẫn đọc được hình mà không bị bẹt.
   *
   * Không cái nào đổ bóng. Với khối low-poly thì riêng chênh sáng giữa các mặt
   * đã đủ dựng hình, còn shadow map là khoản đắt nhất có thể thêm vào cảnh này.
   */
  const moonKey = new THREE.DirectionalLight(SCENE_HEX.moonLight, 1.55);
  moonKey.position.set(-6, 9, 4);
  scene.add(moonKey);

  const rimLight = new THREE.DirectionalLight(SCENE_HEX.rimLight, 0.85);
  rimLight.position.set(5.5, 4.5, -7);
  scene.add(rimLight);

  const fillLight = new THREE.HemisphereLight(SCENE_HEX.fillSky, SCENE_HEX.fillGround, 0.6);
  scene.add(fillLight);

  const ambient = new THREE.AmbientLight(SCENE_HEX.ambient, 0.75);
  scene.add(ambient);

  // ---- Hai hình quạt dùng chung cho mọi quầng sáng ----

  /** Quầng đặc tâm, tản dần ra mép. */
  const glowGeo = track(radialGeometry(THREE, [{ r: 0, a: 1 }, { r: 0.55, a: 0.55 }, { r: 1, a: 0 }], 28));
  /** Vành sáng mềm cả hai mép - không có cạnh cứng nào để đọc ra "gizmo". */
  const ringGeo = track(
    radialGeometry(THREE, [{ r: 0.55, a: 0 }, { r: 0.78, a: 1 }, { r: 1, a: 0 }], 28),
  );

  const softMaterial = (hex: number, opacity: number, blending: Blending3D = AD) =>
    track(
      new THREE.MeshBasicMaterial({
        color: hex,
        vertexColors: true,
        transparent: true,
        opacity,
        depthWrite: false,
        blending,
        fog: false,
        side: THREE.DoubleSide,
      }),
    );

  // ---- Nền đất, ba lớp ----

  /*
   * Ba vành thay vì một mặt đất phẳng lì. Không phải để trang trí: một đĩa đơn
   * sắc rộng bằng cả khung hình không cho mắt một mốc nào để đọc khoảng cách,
   * nên ngôi làng trông như dán lên nền. Mỗi vành sáng hơn vành ngoài nó một
   * nấc, và quảng trường là nấc sáng nhất - ánh nhìn đi vào giữa.
   */
  const groundGeo = track(new THREE.CircleGeometry(model.groundRadius, 56));
  const ground = new THREE.Mesh(groundGeo, track(new THREE.MeshLambertMaterial({ color: SCENE_HEX.groundOuter })));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const midGeo = track(new THREE.CircleGeometry(ringRadius + 1.5, 48));
  const mid = new THREE.Mesh(midGeo, track(new THREE.MeshLambertMaterial({ color: SCENE_HEX.groundMid })));
  mid.rotation.x = -Math.PI / 2;
  mid.position.y = 0.004;
  scene.add(mid);

  const squareGeo = track(new THREE.CircleGeometry(squareRadius, 40));
  const square = new THREE.Mesh(squareGeo, track(new THREE.MeshLambertMaterial({ color: SCENE_HEX.square })));
  square.rotation.x = -Math.PI / 2;
  square.position.y = 0.008;
  scene.add(square);

  const squareGlowMat = softMaterial(SCENE_HEX.squareGlow, 0.2);
  const squareGlow = new THREE.Mesh(glowGeo, squareGlowMat);
  squareGlow.rotation.x = -Math.PI / 2;
  squareGlow.position.y = 0.012;
  squareGlow.scale.setScalar(squareRadius * 1.5);
  squareGlow.renderOrder = 2;
  scene.add(squareGlow);

  // ---- Điểm neo giữa quảng trường ----

  /*
   * Giếng đá và vòng đá họp làng.
   *
   * Quảng trường trống là một cái đĩa, và một cái đĩa không nói gì cả. Cụm này
   * cho nó một tâm để nhìn vào khi chưa có sự kiện nào diễn ra.
   *
   * TẤT CẢ đều thấp: bệ 0.16, thành giếng 0.52, cột đá cao nhất 0.66 - trong khi
   * con dấu bỏ phiếu bay ở độ cao 0.8 trở lên. Đây là điều kiện để điểm neo
   * không bao giờ che phiên xử, và nó là một ràng buộc về SỐ chứ không phải một
   * lời hứa suông.
   */
  const stoneMat = track(new THREE.MeshLambertMaterial({ color: SCENE_HEX.stone }));
  const stoneDarkMat = track(new THREE.MeshLambertMaterial({ color: SCENE_HEX.stoneShade }));

  const dais = new THREE.Mesh(track(new THREE.CylinderGeometry(1.32, 1.46, 0.16, 12)), stoneDarkMat);
  dais.position.y = 0.08;
  scene.add(dais);

  const wellBody = new THREE.Mesh(track(new THREE.CylinderGeometry(0.48, 0.54, 0.52, 8)), stoneMat);
  wellBody.position.y = 0.34;
  scene.add(wellBody);

  const wellMouth = new THREE.Mesh(
    track(new THREE.CircleGeometry(0.4, 8)),
    track(new THREE.MeshBasicMaterial({ color: 0x04070e })),
  );
  wellMouth.rotation.x = -Math.PI / 2;
  wellMouth.position.y = 0.601;
  scene.add(wellMouth);

  const STONE_COUNT = 6;
  const stones = new THREE.InstancedMesh(
    track(new THREE.BoxGeometry(0.24, 1, 0.2)),
    stoneMat,
    STONE_COUNT,
  );
  stones.frustumCulled = false;
  const dummy = new THREE.Object3D();
  for (let index = 0; index < STONE_COUNT; index += 1) {
    const angle = (index / STONE_COUNT) * Math.PI * 2 + 0.4;
    const height = 0.42 + jitter(index, 3) * 0.24;
    dummy.position.set(Math.cos(angle) * 1.92, height / 2, Math.sin(angle) * 1.92);
    dummy.rotation.set(0, angle, (jitter(index, 7) - 0.5) * 0.16);
    dummy.scale.set(1, height, 1);
    dummy.updateMatrix();
    stones.setMatrixAt(index, dummy.matrix);
  }
  stones.instanceMatrix.needsUpdate = true;
  scene.add(stones);

  // ---- Rừng, hai lớp ----

  /*
   * Một `InstancedMesh` cho cả rừng: 34 gốc cây trong MỘT lời gọi vẽ.
   *
   * Hai vành bán kính khác nhau, và lớp trong sáng hơn lớp ngoài. Đó là toàn bộ
   * mẹo tạo chiều sâu ở đây - hai lớp cùng màu thì thành một bức tường răng cưa
   * phẳng, còn chênh nhau một nấc thì thành rìa của một khu rừng.
   */
  const FOREST_COUNT = 34;
  const treeGeo = track(new THREE.ConeGeometry(0.46, 1.75, 6));
  // Vật liệu để TRẮNG, màu thật nằm ở từng thể hiện: `instanceColor` NHÂN với
  // màu vật liệu, nên đặt cả hai cùng một sắc xanh sẫm sẽ cho ra bình phương
  // của nó - cả khu rừng đen kịt và dính vào nền trời.
  const treeMat = track(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const forest = new THREE.InstancedMesh(treeGeo, treeMat, FOREST_COUNT);
  forest.frustumCulled = false;
  /** Gốc cây: vị trí và cỡ, để phép đung đưa mỗi khung hình khỏi phải tính lại. */
  const treeBase = new Float32Array(FOREST_COUNT * 4);
  const treeColor = new THREE.Color();
  for (let index = 0; index < FOREST_COUNT; index += 1) {
    const outer = index % 2 === 1;
    const angle = (index / FOREST_COUNT) * Math.PI * 2 + (outer ? 0.31 : 0.09);
    const radius = model.groundRadius * (outer ? 0.97 : 0.84);
    const scale = 0.82 + jitter(index, 11) * 0.42;
    treeBase[index * 4] = Math.cos(angle) * radius;
    treeBase[index * 4 + 1] = Math.sin(angle) * radius;
    treeBase[index * 4 + 2] = scale;
    treeBase[index * 4 + 3] = jitter(index, 17) * Math.PI * 2;
    dummy.position.set(treeBase[index * 4], 0.86 * scale, treeBase[index * 4 + 1]);
    dummy.rotation.set(0, treeBase[index * 4 + 3], 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    forest.setMatrixAt(index, dummy.matrix);
    forest.setColorAt(index, treeColor.setHex(outer ? SCENE_HEX.treeFar : SCENE_HEX.treeNear));
  }
  forest.instanceMatrix.needsUpdate = true;
  if (forest.instanceColor) forest.instanceColor.needsUpdate = true;
  scene.add(forest);

  // ---- Bóng tiếp đất giả ----

  /*
   * Một vũng tối mềm dưới mỗi khối, trong MỘT lời gọi vẽ.
   *
   * Không phải bóng thật và không giả vờ là bóng thật: nó không có hướng, không
   * theo trăng. Việc của nó chỉ là dán khối xuống mặt đất - thiếu nó thì nhà và
   * cây trông như đang lơ lửng, và đó là điều duy nhất mà mắt đọc ra ngay lập
   * tức khi một cảnh 3D thiếu bóng.
   */
  const CONTACT_COUNT = model.houses.length + FOREST_COUNT;
  const contactShadows = new THREE.InstancedMesh(
    glowGeo,
    softMaterial(SCENE_HEX.contactShadow, 0.5, THREE.NormalBlending),
    Math.max(1, CONTACT_COUNT),
  );
  contactShadows.frustumCulled = false;
  contactShadows.renderOrder = 1;
  scene.add(contactShadows);

  const placeShadow = (slot: number, x: number, z: number, radius: number) => {
    dummy.position.set(x, 0.016, z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.setScalar(radius);
    dummy.updateMatrix();
    contactShadows.setMatrixAt(slot, dummy.matrix);
  };
  model.houses.forEach((house, index) => placeShadow(index, house.x, house.z, 1.25));
  for (let index = 0; index < FOREST_COUNT; index += 1) {
    placeShadow(
      model.houses.length + index,
      treeBase[index * 4],
      treeBase[index * 4 + 1],
      0.62 * treeBase[index * 4 + 2],
    );
  }
  contactShadows.instanceMatrix.needsUpdate = true;

  // ---- Nhà ----

  const bodyGeos = [
    track(new THREE.BoxGeometry(1.2, BODY_HEIGHTS[0], 1.0)),
    track(new THREE.BoxGeometry(1.0, BODY_HEIGHTS[1], 0.9)),
    track(new THREE.BoxGeometry(1.35, BODY_HEIGHTS[2], 1.1)),
  ];
  const roofGeos = [
    track(new THREE.ConeGeometry(0.95, 0.68, 4)),
    track(new THREE.ConeGeometry(0.82, 0.84, 4)),
    track(new THREE.ConeGeometry(1.05, 0.6, 4)),
  ];
  const wallMat = track(new THREE.MeshLambertMaterial({ color: SCENE_HEX.wall }));
  const plinthMat = track(new THREE.MeshLambertMaterial({ color: SCENE_HEX.wallShade }));
  const roofMat = track(new THREE.MeshLambertMaterial({ color: SCENE_HEX.roof }));
  const chimneyMat = track(new THREE.MeshLambertMaterial({ color: SCENE_HEX.chimney }));
  const windowGeo = track(new THREE.PlaneGeometry(0.34, 0.3));
  const plinthGeo = track(new THREE.BoxGeometry(1.42, 0.1, 1.22));
  const chimneyGeo = track(new THREE.BoxGeometry(0.16, 0.38, 0.16));

  const houses: HouseNode[] = model.houses.map((house) => {
    const variant = house.variant % bodyGeos.length;
    const height = BODY_HEIGHTS[variant];
    const group = new THREE.Group();
    group.position.set(house.x, 0, house.z);
    // Mặt tiền quay vào quảng trường: cửa sổ là thứ mang ánh đèn, và nó phải
    // nhìn về phía camera đang đứng chứ không quay lưng ra rừng.
    group.rotation.y = Math.atan2(-house.x, -house.z);

    // Bệ nhà tối hơn thân: một đường cắt ngang ở chân tường, đủ để thân nhà
    // không dính liền vào mặt đất thành một khối duy nhất.
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.y = 0.05;
    group.add(plinth);

    const body = new THREE.Mesh(bodyGeos[variant], wallMat);
    body.position.y = height / 2 + 0.08;
    group.add(body);

    const roof = new THREE.Mesh(roofGeos[variant], roofMat);
    roof.position.y = height + 0.38;
    roof.rotation.y = Math.PI / 4;
    group.add(roof);

    /*
     * Ống khói, bằng vật liệu sáng hơn hẳn mái.
     *
     * Một khối bé xíu, và nó gánh hai việc: phá đường mái để mười lăm nếp nhà
     * không thành mười lăm cái nêm giống hệt nhau, và cho mỗi căn một mẩu bắt
     * trăng nằm cao hơn tất cả - tức là một đường viền sáng tách mái khỏi nền
     * trời ngay cả khi nhà quay lưng lại camera.
     *
     * Đặt lệch khỏi đỉnh chóp: một ống khói mọc đúng giữa nóc đọc ra là một cái
     * cột, không phải một ống khói.
     */
    const chimney = new THREE.Mesh(chimneyGeo, chimneyMat);
    chimney.position.set(0.3, height + 0.42, -0.2);
    group.add(chimney);

    /*
     * Ô cửa ở CẢ HAI mặt trước và sau.
     *
     * Camera đứng ngoài vòng nhà, nên nửa số nhà quay lưng lại - và một căn nhà
     * quay lưng thì không còn ánh đèn nào để đọc. Mà "nhà nào còn sáng" là thông
     * tin CHÍNH của cả trải nghiệm, không phải một chi tiết trang trí. Hai tấm
     * phẳng dùng CHUNG một vật liệu, nên tắt đèn vẫn là một phép gán.
     */
    const windowMaterial = track(
      new THREE.MeshBasicMaterial({ color: SCENE_HEX.windowLit, transparent: true, opacity: 1, fog: false }),
    );
    const front = new THREE.Mesh(windowGeo, windowMaterial);
    front.position.set(0, height * 0.55 + 0.08, 0.52);
    group.add(front);
    const back = new THREE.Mesh(windowGeo, windowMaterial);
    back.position.set(0, height * 0.55 + 0.08, -0.52);
    back.rotation.y = Math.PI;
    group.add(back);

    scene.add(group);
    return {
      id: house.playerId,
      group,
      windowMaterial,
      baseY: height + 0.08,
      x: house.x,
      z: house.z,
      accentHex: ACCENT_HEX[house.accent],
    };
  });
  const houseById = new Map(houses.map((house) => [house.id, house]));
  const houseIndex = new Map(houses.map((house, index) => [house.id, index]));
  const houseCount = Math.max(1, houses.length);

  /*
   * Vũng sáng dưới chân nhà: ấm khi còn đèn, xanh xám khi đã tắt.
   *
   * Thay cho một `PointLight` mỗi nhà - mười lăm nguồn sáng động là khoản đắt
   * nhất mà một cảnh như thế này có thể tự chuốc vào - và thay luôn cho lớp
   * sương riêng của nhà đã tắt. Một `InstancedMesh`, màu theo từng thể hiện, một
   * lời gọi vẽ.
   */
  const houseAura = new THREE.InstancedMesh(glowGeo, softMaterial(0xffffff, 0.26), houseCount);
  houseAura.frustumCulled = false;
  houseAura.renderOrder = 3;
  scene.add(houseAura);

  /*
   * Vành sắc vai dưới chân nhà - NHỎ và MỜ hơn hẳn bản đầu.
   *
   * Bản đầu dùng `RingGeometry` với hai mép cứng, bán kính gần bằng cả căn nhà,
   * độ mờ 0.38 và luôn bật cho mọi nhà. Kết quả đọc ra không phải "ánh sắc vai"
   * mà là "vòng chọn đối tượng" của một trình biên tập 3D. Ba thứ đổi cùng lúc:
   * hình có mép tản mềm, bán kính co lại còn hơn nửa, và độ đậm phụ thuộc bước
   * đang chiếu - chỉ nguồn, mục tiêu hay người trong cuộc mới sáng rõ.
   *
   * Vai vẫn đọc được bằng CHỮ trong `VillageRoster`; vành này chưa bao giờ là
   * lớp thông tin duy nhất, và giờ thì nó cũng không giả vờ là thế nữa.
   */
  const accentRings = new THREE.InstancedMesh(ringGeo, softMaterial(0xffffff, 0.85), houseCount);
  accentRings.frustumCulled = false;
  accentRings.renderOrder = 4;
  scene.add(accentRings);

  houses.forEach((house, index) => {
    dummy.position.set(house.x, 0.024, house.z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.setScalar(1.28);
    dummy.updateMatrix();
    houseAura.setMatrixAt(index, dummy.matrix);
    dummy.position.y = 0.03;
    dummy.scale.setScalar(0.94);
    dummy.updateMatrix();
    accentRings.setMatrixAt(index, dummy.matrix);
  });
  houseAura.instanceMatrix.needsUpdate = true;
  accentRings.instanceMatrix.needsUpdate = true;

  // ---- Bầu trời: trăng, quầng và sao ----

  /*
   * Cả bầu trời nằm trong MỘT nhóm bám theo camera.
   *
   * Trăng ở xa vô cùng nên thị sai bằng không - dời nó theo camera là đúng về
   * mặt vật lý. Nhưng lý do thật là khung hình: camera chúc xuống 35 độ trong
   * khi nửa góc mở dọc chỉ 21 độ, nên KHÔNG có điểm nào của bầu trời thật lọt
   * vào khung. Trăng phải sống trong hệ toạ độ camera thì mới có mặt, và một
   * nhóm duy nhất giữ trăng, quầng và sao đi cùng nhau bằng một phép gán mỗi
   * khung hình.
   *
   * Chiều sâu vẫn đúng: cả nhóm ở cách 58 đơn vị, xa hơn mặt đất, nên rìa rừng
   * vẫn che khuất sao đúng như một đường chân trời.
   */
  const sky = new THREE.Group();
  scene.add(sky);

  const moonCoreMat = track(new THREE.MeshBasicMaterial({ color: SCENE_HEX.moon, fog: false }));
  const moon = new THREE.Mesh(track(new THREE.CircleGeometry(2.35, 32)), moonCoreMat);
  moon.renderOrder = -2;
  sky.add(moon);

  /*
   * Quầng trăng: HAI lớp quạt tản mềm, không phải một vòng tròn thứ hai.
   *
   * Lớp trong ôm sát lõi và sáng; lớp ngoài rộng gấp ba, nhạt hơn nhiều. Chồng
   * hai đường tản khác độ dốc lên nhau cho ra một vệt sáng không có mép - đó là
   * khác biệt giữa một quầng trăng và một cái nhẫn vẽ trên giao diện.
   */
  const moonHaloInnerMat = softMaterial(SCENE_HEX.moon, 0.4);
  const moonHaloInner = new THREE.Mesh(glowGeo, moonHaloInnerMat);
  moonHaloInner.scale.setScalar(4.6);
  moonHaloInner.renderOrder = -3;
  sky.add(moonHaloInner);

  const moonHaloOuterMat = softMaterial(SCENE_HEX.moonHalo, 0.2);
  const moonHaloOuter = new THREE.Mesh(glowGeo, moonHaloOuterMat);
  moonHaloOuter.scale.setScalar(13);
  moonHaloOuter.renderOrder = -4;
  sky.add(moonHaloOuter);

  /*
   * Sao: một `Points` duy nhất, 36 chấm, vị trí tất định theo chỉ số.
   *
   * Nằm trong nửa trên của hình nón nhìn để chúng rơi vào vùng trời của khung
   * hình; những chấm rơi xuống dưới đường chân trời thì bị rìa rừng che, và đó
   * là ý muốn chứ không phải một sai sót.
   */
  const STAR_COUNT = 36;
  const starPositions = new Float32Array(STAR_COUNT * 3);
  for (let index = 0; index < STAR_COUNT; index += 1) {
    const spread = (jitter(index, 23) - 0.5) * 1.7;
    const lift = 0.06 + jitter(index, 29) * 0.62;
    const depth = -1;
    const scale = MOON_DISTANCE * (1.02 + jitter(index, 31) * 0.1);
    starPositions[index * 3] = spread * scale;
    starPositions[index * 3 + 1] = lift * scale;
    starPositions[index * 3 + 2] = depth * scale;
  }
  const starGeo = track(new THREE.BufferGeometry());
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(
    starGeo,
    track(
      new THREE.PointsMaterial({
        color: SCENE_HEX.star,
        size: 2.2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        fog: false,
      }),
    ),
  );
  stars.renderOrder = -5;
  sky.add(stars);

  // ---- Sương trôi ----

  /*
   * Ba mảng sương nằm sát đất, trôi rất chậm quanh làng.
   *
   * Sát đất và rất nhạt: chuyển động nền phải ở ngưỡng "cảnh không đứng hình"
   * chứ không được tranh sự chú ý với hiệu ứng đang diễn, và không được che nhà.
   */
  const FOG_COUNT = 3;
  const fogMat = softMaterial(SCENE_HEX.fog, 0.06);
  const fogPatches: Mesh3D[] = [];
  for (let index = 0; index < FOG_COUNT; index += 1) {
    const patch = new THREE.Mesh(glowGeo, fogMat);
    patch.rotation.x = -Math.PI / 2;
    patch.position.y = 0.07 + index * 0.01;
    patch.scale.setScalar(model.groundRadius * (0.55 + index * 0.14));
    patch.renderOrder = 5;
    scene.add(patch);
    fogPatches.push(patch);
  }

  // ---- Diễn viên của các hiệu ứng, dựng sẵn và ẩn đi ----

  /*
   * Bóng Sói: một con sói low-poly ĐỌC RA ĐƯỢC, không phải một khối cầu đỏ.
   *
   * Bản đầu dùng đúng một `SphereGeometry` bị bóp dẹt, tô màu đỏ sẫm. Ở khung
   * hình thật nó là một vệt nhỏ trượt trên mặt đất, và không ai đọc ra đó là con
   * sói. Sáu khối - thân, đầu, mõm, hai tai, đuôi - vẫn là low-poly, vẫn dùng
   * chung hai vật liệu, nhưng cái bóng thì có hình.
   *
   * Hơi trong suốt và rất tối: đây là bóng của con sói, không phải con sói. Hai
   * mắt đỏ bé xíu là chi tiết sáng duy nhất, và cũng là thứ mắt người tìm thấy
   * trước nhất trong bóng tối.
   */
  const wolf = new THREE.Group();
  const wolfMat = track(
    new THREE.MeshLambertMaterial({ color: 0x1a0a10, transparent: true, opacity: 0.85 }),
  );
  const wolfEyeMat = track(new THREE.MeshBasicMaterial({ color: 0xff4433, fog: false }));
  const wolfBody = new THREE.Mesh(track(new THREE.BoxGeometry(0.92, 0.34, 0.34)), wolfMat);
  wolfBody.position.set(0, 0.42, 0);
  wolf.add(wolfBody);
  const wolfHead = new THREE.Mesh(track(new THREE.BoxGeometry(0.32, 0.3, 0.3)), wolfMat);
  wolfHead.position.set(0.52, 0.54, 0);
  wolf.add(wolfHead);
  const wolfSnout = new THREE.Mesh(track(new THREE.BoxGeometry(0.24, 0.14, 0.16)), wolfMat);
  wolfSnout.position.set(0.74, 0.48, 0);
  wolf.add(wolfSnout);
  const earGeo = track(new THREE.ConeGeometry(0.09, 0.18, 4));
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, wolfMat);
    ear.position.set(0.46, 0.74, side * 0.1);
    wolf.add(ear);
    const eye = new THREE.Mesh(track(new THREE.SphereGeometry(0.035, 6, 5)), wolfEyeMat);
    eye.position.set(0.68, 0.56, side * 0.085);
    wolf.add(eye);
  }
  const wolfTail = new THREE.Mesh(track(new THREE.ConeGeometry(0.1, 0.46, 4)), wolfMat);
  wolfTail.position.set(-0.56, 0.52, 0);
  wolfTail.rotation.z = Math.PI / 2 + 0.5;
  wolf.add(wolfTail);
  wolf.scale.setScalar(1);
  wolf.visible = false;
  scene.add(wolf);

  /** Vệt sương kéo theo sau Sói: bốn vũng tối mờ dần về phía rừng. */
  const TRAIL_COUNT = 4;
  const trailMat = softMaterial(EFFECT_HEX.WOLF_ATTACK, 0.3);
  const trail: Mesh3D[] = [];
  for (let index = 0; index < TRAIL_COUNT; index += 1) {
    const puff = new THREE.Mesh(glowGeo, trailMat);
    puff.rotation.x = -Math.PI / 2;
    puff.position.y = 0.05;
    puff.renderOrder = 6;
    puff.visible = false;
    scene.add(puff);
    trail.push(puff);
  }

  /*
   * Khiên: mái vòm + hai cung + vòng gợn dưới chân.
   *
   * Bản đầu chỉ có một cái `TorusGeometry` nằm ngang lơ lửng ngang tầm mái, và
   * nó đọc ra là một cái vòng chứ không phải một lớp che chở. Mái vòm là thứ nói
   * "căn nhà này được BỌC lại"; hai cung cắt nhau cho nó một cấu trúc; vòng gợn
   * lan ra từ chân nhà nói cú chặn đã xảy ra ở đâu.
   */
  /*
   * Mái vòm KHÔNG dùng `softMaterial`.
   *
   * Hàm đó bật `vertexColors` vì hai hình quạt dùng chung đều nướng độ trong
   * suốt vào thuộc tính màu của đỉnh. Một `SphereGeometry` thì không có thuộc
   * tính ấy, và `vertexColors: true` trên một geometry thiếu nó cho ra màu đỉnh
   * bằng không - tức là một mái vòm ĐEN úp lên căn nhà, đúng thứ ngược lại với
   * việc nó phải làm.
   */
  const domeMat = track(
    new THREE.MeshBasicMaterial({
      color: EFFECT_HEX.SHIELD_SAVE,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: AD,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  const dome = new THREE.Mesh(
    track(new THREE.SphereGeometry(1.25, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)),
    domeMat,
  );
  dome.visible = false;
  dome.renderOrder = 7;
  scene.add(dome);

  const arcGeo = track(new THREE.TorusGeometry(1.24, 0.025, 6, 28, Math.PI));
  const arcMat = track(
    new THREE.MeshBasicMaterial({
      color: EFFECT_HEX.SHIELD_SAVE,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: AD,
      fog: false,
    }),
  );
  const arcs: Mesh3D[] = [];
  for (let index = 0; index < 2; index += 1) {
    const arc = new THREE.Mesh(arcGeo, arcMat);
    arc.rotation.z = 0;
    arc.rotation.y = index * (Math.PI / 2);
    arc.visible = false;
    arc.renderOrder = 8;
    scene.add(arc);
    arcs.push(arc);
  }

  const rippleMat = softMaterial(EFFECT_HEX.SHIELD_SAVE, 0.5);
  const ripple = new THREE.Mesh(ringGeo, rippleMat);
  ripple.rotation.x = -Math.PI / 2;
  ripple.visible = false;
  ripple.renderOrder = 6;
  scene.add(ripple);

  /** Chớp sáng ngắn: dùng cho cú chạm khiên và cho ánh lửa đầu nòng. */
  const flashMat = softMaterial(0xffffff, 0.6);
  const flash = new THREE.Mesh(glowGeo, flashMat);
  flash.visible = false;
  flash.renderOrder = 9;
  scene.add(flash);

  /*
   * Bể hạt DÙNG CHUNG: sáu khối tám mặt bé xíu.
   *
   * Cùng sáu khối ấy làm hạt sáng của Bình Cứu, giọt độc của Bình Độc và tia lửa
   * của phát súng - ba hiệu ứng không bao giờ diễn cùng lúc, nên ba bể riêng chỉ
   * là ba lần trả tiền cho một chỗ ngồi. Sáu là trần cứng, và cộng cả cảnh lại
   * thì số hạt sống cùng lúc không bao giờ quá ba chục.
   */
  const MOTE_COUNT = 6;
  const moteGeo = track(new THREE.OctahedronGeometry(0.09, 0));
  const moteMat = track(
    new THREE.MeshBasicMaterial({ color: EFFECT_HEX.WITCH_HEAL, transparent: true, opacity: 0.9, fog: false }),
  );
  const motes: Mesh3D[] = [];
  for (let index = 0; index < MOTE_COUNT; index += 1) {
    const mote = new THREE.Mesh(moteGeo, moteMat);
    mote.visible = false;
    scene.add(mote);
    motes.push(mote);
  }

  /*
   * Tia sáng HAI LỚP: lõi mảnh và quầng trong suốt bọc ngoài.
   *
   * Một hình trụ đơn sắc là một cái que. Hai hình trụ đồng trục - lõi gần như
   * trắng, vỏ rộng gấp bốn và rất mờ - đọc ra là ánh sáng. Dùng lại cho cả tia
   * bạc của Tiên Tri, vệt đạn của Thợ Săn lẫn luồng thuốc của Phù Thuỷ: cùng một
   * hình, khác màu và khác nhịp.
   */
  const beamGeo = track(new THREE.CylinderGeometry(0.028, 0.028, 1, 6));
  const beamCoreMat = track(
    new THREE.MeshBasicMaterial({ color: EFFECT_HEX.SEER_BEAM, transparent: true, opacity: 0.9, blending: AD, depthWrite: false, fog: false }),
  );
  const beamCore = new THREE.Mesh(beamGeo, beamCoreMat);
  beamCore.visible = false;
  beamCore.renderOrder = 8;
  scene.add(beamCore);

  const beamHaloMat = track(
    new THREE.MeshBasicMaterial({ color: EFFECT_HEX.SEER_BEAM, transparent: true, opacity: 0.28, blending: AD, depthWrite: false, fog: false }),
  );
  const beamHalo = new THREE.Mesh(beamGeo, beamHaloMat);
  beamHalo.visible = false;
  beamHalo.renderOrder = 7;
  scene.add(beamHalo);

  /** Điểm sáng chạy dọc tia - thứ nói tia này ĐI từ đâu tới đâu. */
  const beamDotMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
  const beamDot = new THREE.Mesh(track(new THREE.SphereGeometry(0.075, 8, 6)), beamDotMat);
  beamDot.visible = false;
  beamDot.renderOrder = 9;
  scene.add(beamDot);

  /** Dấu Sói: một vành đỏ mềm nổi trên mái. Chỉ dùng khi hồ sơ ĐÃ nói đó là Sói. */
  const markMat = softMaterial(EFFECT_HEX.WOLF_ATTACK, 0.8);
  const mark = new THREE.Mesh(ringGeo, markMat);
  mark.visible = false;
  mark.renderOrder = 9;
  scene.add(mark);

  /** Sương màu dưới chân một căn nhà: độc, lời nguyền, hay một nhịp trung tính. */
  const mistMat = softMaterial(EFFECT_HEX.WITCH_POISON, 0.4);
  const mist = new THREE.Mesh(glowGeo, mistMat);
  mist.rotation.x = -Math.PI / 2;
  mist.position.y = 0.04;
  mist.visible = false;
  mist.renderOrder = 6;
  scene.add(mist);

  /** Vành mảnh dâng lên từ chân nhà. Thay cho khối cầu đặc của bản đầu. */
  const auraMat = softMaterial(EFFECT_HEX.CURSED_MOON, 0.75);
  const aura = new THREE.Mesh(ringGeo, auraMat);
  aura.rotation.x = -Math.PI / 2;
  aura.visible = false;
  aura.renderOrder = 7;
  scene.add(aura);

  /*
   * Con dấu bỏ phiếu: một BỂ CỐ ĐỊNH tám cái.
   *
   * Tám là trần cứng chứ không phải số phiếu. Số phiếu thật nằm trong lớp phủ
   * DOM ("6 phiếu treo, 2 phiếu tha") vì đó là chỗ đọc được chính xác; dựng đúng
   * số đĩa trên nền 3D sẽ thành một biểu đồ mà người xem phải đếm, và đếm sai
   * thì thành nói dối. Ở đây chúng chỉ diễn CHUYỂN ĐỘNG hội tụ.
   *
   * Con dấu ĐỨNG, quay mặt về camera - không nằm sấp trên mặt đất. Bản đầu để
   * chúng nằm phẳng, và ở góc nhìn chếch 35 độ thì một cái đĩa bị bóp còn hơn
   * nửa chiều cao rồi tan vào chính nền đất cùng tông ngay dưới nó.
   */
  const SEAL_COUNT = 8;
  const sealGeo = track(new THREE.CircleGeometry(0.26, 8));
  const sealMat = track(
    new THREE.MeshBasicMaterial({
      color: EFFECT_HEX.TRIAL_SCALES,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  const seals: Mesh3D[] = [];
  for (let index = 0; index < SEAL_COUNT; index += 1) {
    const seal = new THREE.Mesh(sealGeo, sealMat);
    seal.visible = false;
    seal.renderOrder = 9;
    scene.add(seal);
    seals.push(seal);
  }

  /*
   * Cán cân của phiên xử: một đòn ngang và hai đĩa.
   *
   * Đây là thứ biến "mấy đồng xu đặt ngẫu nhiên" thành một kết quả ĐỌC ĐƯỢC
   * BẰNG BỐ CỤC: đòn cân nghiêng về bên nào thì bên ấy thắng, và con dấu xếp
   * thành hai nhóm có trật tự trên hai đĩa thay vì rải quanh quảng trường.
   */
  const SCALE_ARM = 1.4;
  const SCALE_HEIGHT = 1.62;
  const scaleBeam = new THREE.Mesh(track(new THREE.BoxGeometry(SCALE_ARM * 2, 0.05, 0.05)), stoneMat);
  scaleBeam.visible = false;
  scene.add(scaleBeam);
  const panGeo = track(new THREE.CylinderGeometry(0.52, 0.52, 0.04, 12));
  // Dây treo: thiếu chúng thì hai cái đĩa lơ lửng dưới một cái đòn, và cả cụm
  // đọc ra là ba vật thể rời chứ không phải một cái cân.
  const hangerGeo = track(new THREE.BoxGeometry(0.03, 1, 0.03));
  const pans: Mesh3D[] = [];
  const hangers: Mesh3D[] = [];
  for (let index = 0; index < 2; index += 1) {
    const pan = new THREE.Mesh(panGeo, stoneMat);
    pan.visible = false;
    scene.add(pan);
    pans.push(pan);
    const hanger = new THREE.Mesh(hangerGeo, stoneMat);
    hanger.visible = false;
    scene.add(hanger);
    hangers.push(hanger);
  }

  /*
   * Phong bì: thân, nắp gập quanh mép trên, và dấu niêm sáp.
   *
   * Nắp treo trong một `Group` riêng đặt ĐÚNG ở mép trên, vì `rotation` của
   * Three.js quay quanh gốc của vật thể - gắn thẳng vào tấm nắp thì nó xoay
   * quanh chính giữa mình và trông như một cánh quạt chứ không như một cái nắp
   * mở ra.
   *
   * Nội dung thư KHÔNG ở đây: chữ nằm trong thẻ DOM bên dưới, nên không có 3D
   * text nào phải lo về font tiếng Việt có dấu.
   */
  const envelope = new THREE.Group();
  const envelopeMat = track(new THREE.MeshLambertMaterial({ color: SCENE_HEX.letterAmber }));
  envelope.add(new THREE.Mesh(track(new THREE.BoxGeometry(0.62, 0.4, 0.04)), envelopeMat));
  const flapPivot = new THREE.Group();
  flapPivot.position.set(0, 0.2, 0);
  const flap = new THREE.Mesh(track(new THREE.BoxGeometry(0.62, 0.2, 0.03)), envelopeMat);
  flap.position.set(0, -0.1, 0.025);
  flapPivot.add(flap);
  envelope.add(flapPivot);
  const sealDot = new THREE.Mesh(
    track(new THREE.CircleGeometry(0.08, 12)),
    track(new THREE.MeshBasicMaterial({ color: SCENE_HEX.letterSeal })),
  );
  sealDot.position.set(0, 0, 0.03);
  envelope.add(sealDot);
  envelope.visible = false;
  scene.add(envelope);

  // ---- Trạng thái phát ----

  let current: VillageStep | null = null;
  let stepStartedAt = 0;
  let builtAt = 0;
  let reducedMotion = false;
  let litSet = new Set(model.houses.map((house) => house.playerId));
  let extinguishSet = new Set<string>();
  let focusSet = new Set<string>();
  let cursed = false;

  /** Độ sáng cửa sổ của từng nhà TRONG khung hình đang vẽ. Hiệu ứng ghi đè lên đây. */
  const levels = new Float32Array(houseCount);
  /** Mức nền của bước hiện tại: 1 là còn đèn, 0 là đã tắt. */
  const baseLevels = new Float32Array(houseCount);
  baseLevels.fill(1);

  /**
   * Nạn nhân của cảnh Sói, theo đúng thứ tự evidence, lưu bằng CHỈ SỐ NHÀ.
   *
   * Lập một lần ở `setStep`. Bản đầu dựng lại danh sách này bằng
   * `targetIds.map(houseOf).filter(...)` ngay trong `runEffect`, tức hai mảng
   * rác cho mỗi khung hình của mỗi cảnh Sói - và một cảnh dài 3,6 giây ở 60fps
   * là hơn hai trăm mảng.
   */
  const victimSlots = new Int32Array(houseCount);
  let victimCount = 0;

  /*
   * ĐÍCH của camera là một khung hình phải tính; NGUỒN là một chỗ đứng đã có.
   *
   * Hai thứ khác loại nhau, và bản đầu gộp chúng vào cùng một kiểu: hai ô `View`
   * hoán đổi vai, ô đích cũ trở thành ô nguồn mới. Cách đó đúng khi cú lia trước
   * đã chạy xong, và sai ở đúng lúc người xem hay bấm nhất - bấm Tiếp khi camera
   * mới đi được một phần ba đường. Lúc ấy "đích cũ" là một chỗ camera CHƯA từng
   * tới, nên khung hình kế tiếp nhảy thẳng tới đó rồi mới bò sang đích mới.
   *
   * Nguồn giờ là một tư thế ĐÔNG CỨNG trong không gian, do `capturePose` chụp
   * lại đúng chỗ camera đang đứng vào thời điểm đổi bước. Nó không mang theo
   * chùm điểm hay `fill`, và cũng không cần: đóng khung là việc của cái đích,
   * còn nguồn chỉ là quá khứ mà camera đang rời khỏi. Đích vẫn giữ đủ dữ liệu
   * để tính lại khi tỉ lệ khung đổi.
   */
  interface View {
    look: Point3;
    points: Point3[];
    fill: number;
    distance: number;
  }
  const toView: View = { look: { x: 0, y: 0.85, z: 0 }, points: [], fill: 0.9, distance: 12 };
  const fromPose = { look: { x: 0, y: 0.85, z: 0 }, distance: 12 };
  let framedAspect = 0;
  let glideStartedAt = 0;
  let glideMs = 0;

  /**
   * Tiến độ cú lia tại một mốc thời gian. `1` là đã tới nơi, hoặc không lia.
   *
   * Một hàm duy nhất cho cả `update` lẫn `capturePose`: hai chỗ đó phải đọc ra
   * cùng một con số ở cùng một `nowMs`, nếu không thì chính thao tác đổi bước
   * lại tạo ra cú nhảy mà nó đang phải tránh.
   */
  function glideAt(nowMs: number): number {
    return glideMs > 0 ? smootherStep((nowMs - glideStartedAt) / glideMs) : 1;
  }

  /**
   * Đông cứng tư thế camera hiện tại thành nguồn của cú lia kế tiếp.
   *
   * `a += (b - a) * g` chính là phép nội suy mà `update` dùng, nên ngay sau lời
   * gọi này camera vẫn ở đúng chỗ cũ - chỉ khác là chỗ ấy giờ là điểm xuất phát
   * chứ không còn là một điểm giữa đường.
   */
  function capturePose(nowMs: number): void {
    const glide = glideAt(nowMs);
    fromPose.look.x += (toView.look.x - fromPose.look.x) * glide;
    fromPose.look.y += (toView.look.y - fromPose.look.y) * glide;
    fromPose.look.z += (toView.look.z - fromPose.look.z) * glide;
    fromPose.distance += (toView.distance - fromPose.distance) * glide;
  }

  const tmpColor = new THREE.Color();
  const litColor = new THREE.Color(SCENE_HEX.windowLit);
  const darkColor = new THREE.Color(SCENE_HEX.windowDark);
  const mistColor = new THREE.Color(SCENE_HEX.fog);
  const tmpVec = new THREE.Vector3();
  const tmpVecB = new THREE.Vector3();
  const moonAt = new THREE.Vector3();
  const upAxis = new THREE.Vector3(0, 1, 0);
  const framePoint = { x: 0, z: 0 };
  /**
   * Những chỗ mà bước hiện tại phải đóng khung.
   *
   * Kiểu chỉ là `{x, z}` chứ không phải `HouseNode`: phần lớn là nhà, nhưng
   * cảnh Sói còn phải chứa cả chỗ bóng Sói rời rừng - một điểm trống trên mặt
   * đất, không phải một căn nhà. Mảng dùng lại, không cấp phát mỗi lần.
   */
  const frameHouses: { x: number; z: number }[] = [];
  /** Chỗ bóng Sói rời rừng, khi bước này cần nó nằm trong khung. */
  const wolfEdge = { x: 0, z: 0 };

  function houseOf(id: string | null | undefined): HouseNode | undefined {
    return id ? houseById.get(id) : undefined;
  }

  function hideActors(): void {
    wolf.visible = false;
    for (const puff of trail) puff.visible = false;
    dome.visible = false;
    for (const arc of arcs) arc.visible = false;
    ripple.visible = false;
    flash.visible = false;
    for (const mote of motes) mote.visible = false;
    beamCore.visible = false;
    beamHalo.visible = false;
    beamDot.visible = false;
    mark.visible = false;
    mist.visible = false;
    aura.visible = false;
    for (const seal of seals) seal.visible = false;
    scaleBeam.visible = false;
    for (const pan of pans) pan.visible = false;
    for (const hanger of hangers) hanger.visible = false;
    envelope.visible = false;
  }

  /** Trăng, quầng và ánh môi trường ngả đỏ - hoặc trở lại lạnh. */
  function setCursed(on: boolean): void {
    cursed = on;
    moonCoreMat.color.setHex(on ? CURSED_HEX.moon : SCENE_HEX.moon);
    moonHaloInnerMat.color.setHex(on ? CURSED_HEX.moon : SCENE_HEX.moon);
    moonHaloOuterMat.color.setHex(on ? CURSED_HEX.moonHalo : SCENE_HEX.moonHalo);
    moonKey.color.setHex(on ? CURSED_HEX.moonLight : SCENE_HEX.moonLight);
    rimLight.color.setHex(on ? CURSED_HEX.rimLight : SCENE_HEX.rimLight);
    ambient.color.setHex(on ? CURSED_HEX.ambient : SCENE_HEX.ambient);
  }

  function setStep(step: VillageStep | null, options: { glide: boolean; reduced: boolean; atMs: number }): void {
    current = step;
    stepStartedAt = options.atMs;
    reducedMotion = options.reduced;
    hideActors();

    /*
     * Cảnh mở đầu (`step === null`) vẽ ngôi làng LÚC MÀN KHÉP LẠI: ai còn sống
     * thì còn đèn, ai đã ngã xuống thì nhà tối và có sương.
     *
     * Không phải "bật hết đèn cho đẹp". Đây là trạng thái người chơi vừa rời
     * khỏi ở màn kết thúc ván, nên nó là chỗ đứng duy nhất mà họ nhận ra ngay -
     * và từ đó cả trải nghiệm mới đọc ra là một cuộc tua NGƯỢC về xem ngôi làng
     * đã thành ra như vậy bằng cách nào.
     */
    litSet = new Set(
      step
        ? step.litIds
        : model.houses.filter((house) => house.aliveAtEnd).map((house) => house.playerId),
    );
    extinguishSet = new Set(step ? step.extinguishIds : []);
    focusSet = new Set(
      step
        ? [...step.targetIds, ...step.participantIds, ...(step.originId ? [step.originId] : [])]
        : [],
    );

    for (let index = 0; index < houses.length; index += 1) {
      baseLevels[index] = litSet.has(houses[index].id) ? 1 : 0;
      houses[index].group.position.set(houses[index].x, 0, houses[index].z);
    }

    // Danh sách nạn nhân lập MỘT LẦN cho cả bước - xem `victimSlots`.
    victimCount = 0;
    if (step?.effect === "WOLF_ATTACK") {
      for (const id of step.targetIds) {
        const slot = houseIndex.get(id);
        if (slot !== undefined && victimCount < victimSlots.length) {
          victimSlots[victimCount] = slot;
          victimCount += 1;
        }
      }
    }

    setCursed(step?.effect === "CURSED_MOON");

    // ---- Đóng khung ----

    const framing = framingFor(step?.effect ?? null);
    // Chụp chỗ camera ĐANG đứng làm điểm xuất phát - kể cả khi cú lia trước mới
    // đi được một phần. Xem chú thích ở chỗ khai báo `fromPose`.
    capturePose(options.atMs);

    frameHouses.length = 0;
    if (step) {
      for (const id of step.targetIds) {
        const house = houseOf(id);
        if (house) frameHouses.push(house);
      }
      const origin = houseOf(step.originId);
      if (origin) frameHouses.push(origin);
      /*
       * Bóng Sói xuất phát từ RÌA RỪNG, không từ một mái nhà - `bloodbath` và
       * `guard-save` đều không có `originId`, và đó là đúng: bầy Sói không có
       * nhà riêng trong mô hình này.
       *
       * Nhưng khung hình thì vẫn phải chứa chỗ nó chạy tới. Thiếu điểm này,
       * phép đóng khung chỉ thấy căn nhà với quảng trường, camera tiến sát vào
       * mái nhà nạn nhân, và cú lao của Sói diễn ra hoàn toàn ngoài màn hình.
       */
      const first = frameHouses[0];
      if (first && (step.effect === "WOLF_ATTACK" || step.effect === "SHIELD_SAVE")) {
        forestEdge(first, wolfEdge);
        frameHouses.push(wolfEdge);
      }
      if (frameHouses.length === 0) {
        for (const id of step.participantIds) {
          const house = houseOf(id);
          if (house) frameHouses.push(house);
        }
      }
    }
    // Không có ai để nhìn - "ván khép nhanh", hay một loại điểm ngoặt chưa có
    // nhà nào đi kèm - thì nhìn cả làng. Đó là câu trả lời đúng, chứ không phải
    // dí camera vào một căn nhà chọn bừa.
    if (frameHouses.length === 0) {
      for (const house of houses) frameHouses.push(house);
    }

    framePoint.x = 0;
    framePoint.z = 0;
    for (const house of frameHouses) {
      framePoint.x += house.x / frameHouses.length;
      framePoint.z += house.z / frameHouses.length;
    }
    const pulled = framedTarget(framePoint, framing.pull);
    toView.look.x = pulled.x;
    toView.look.y = step ? 0.95 : 0.85;
    toView.look.z = pulled.z;
    toView.fill = framing.fill;
    collectFramePoints(frameHouses, framing.square, squareRadius, toView.points);
    // Khoảng cách tính lại ngay ở đây với tỉ lệ khung ĐANG dùng; `update` chỉ
    // tính lại khi tỉ lệ đó thật sự đổi.
    toView.distance = fitDistance(toView.points, toView.look, framedAspect || 1.6, toView.fill);

    glideStartedAt = options.atMs;
    // Giảm chuyển động: đổi cảnh TỨC THÌ. Không phải "lia nhanh hơn" - một cú
    // lia 200ms vẫn là một cú lia.
    glideMs = options.glide ? CAMERA_GLIDE_MS : 0;
  }

  // ---- Đặt hình cho từng hiệu ứng ----

  /** Kéo dài và xoay một hình trụ đơn vị thành đoạn nối hai điểm. */
  function placeBeam(
    mesh: Mesh3D,
    from: { x: number; z: number },
    fromY: number,
    to: { x: number; z: number },
    toY: number,
    progress: number,
    thickness: number,
  ): void {
    const dx = to.x - from.x;
    const dy = toY - fromY;
    const dz = to.z - from.z;
    const length = Math.max(0.001, Math.hypot(dx, dy, dz) * progress);
    mesh.scale.set(thickness, length, thickness);
    mesh.position.set(from.x + (dx * progress) / 2, fromY + (dy * progress) / 2, from.z + (dz * progress) / 2);
    // Hình trụ mọc dọc trục Y, nên xoay trục đó về đúng hướng nối hai đầu.
    tmpVec.set(dx, dy, dz).normalize();
    mesh.quaternion.setFromUnitVectors(upAxis, tmpVec);
  }

  /** Điểm xuất phát ở rìa rừng, trên đường thẳng từ tâm làng qua căn nhà. */
  function forestEdge(house: { x: number; z: number }, out: { x: number; z: number }): void {
    const reach = Math.max(0.4, Math.hypot(house.x, house.z));
    const factor = 1 + 2.9 / reach;
    out.x = house.x * factor;
    out.z = house.z * factor;
  }

  const edge = { x: 0, z: 0 };

  /**
   * Vành sắc vai của một nhà sáng tới đâu ở bước đang chiếu.
   *
   * `sinceStep` là thời gian từ lúc BƯỚC bắt đầu, không phải từ lúc mở cảnh:
   * nhịp đập là của bước này, và nó phải đập lại ở mỗi bước.
   */
  function accentLevel(id: string, sinceStep: number): number {
    if (!current) return 0.24;
    if (!focusSet.has(id)) return 0.12;
    // Một nhịp đập DUY NHẤT lúc bước bắt đầu, rồi ổn định. Nhấp nháy lặp lại là
    // thứ mà giảm chuyển động dựng ra để chặn, và cũng là thứ làm người xem
    // không đọc nổi cái gì đang thật sự thay đổi.
    const pulse = reducedMotion ? 0 : Math.max(0, 1 - sinceStep / 620) * 0.4;
    return 0.46 + pulse;
  }

  function runEffect(step: VillageStep, t: number): void {
    const origin = houseOf(step.originId);
    const primary = houseOf(step.targetIds[0]);
    const tell = tellProgress(t);
    const hit = impactProgress(t);
    const after = afterProgress(t);

    switch (step.effect) {
      case "WOLF_ATTACK": {
        if (victimCount === 0) break;
        /*
         * Nhiều nạn nhân thì xử lý TUẦN TỰ: chia đều thời lượng bước cho từng
         * người theo đúng thứ tự trong evidence, không đánh một lượt cho cả đám.
         *
         * Cả nhánh này phải là một HÀM CỦA `t`, không phải một chuỗi thay đổi
         * cộng dồn qua các khung hình: `update` đặt lại `levels` từ mức nền
         * trước mỗi lần gọi, và người xem thì tạm dừng, kéo lui, hoặc bỏ tab
         * chạy nền cho tới khi trình duyệt ngừng cấp khung. Bản đầu chỉ ghi cho
         * nạn nhân của phân đoạn ĐANG chạy, nên đúng lúc Sói quay sang người thứ
         * hai thì ô cửa của người thứ nhất sáng trở lại - cái chết vừa kể xong
         * bị xoá khỏi khung hình.
         */
        const slice = 1 / victimCount;
        const which = Math.min(victimCount - 1, Math.floor(t / slice));
        const victim = houses[victimSlots[which]];
        const local = Math.min(1, (t - which * slice) / slice);
        const localTell = tellProgress(local);
        const localHit = impactProgress(local);
        const localAfter = afterProgress(local);

        forestEdge(victim, edge);
        // BÁO TRƯỚC: bóng Sói rời rìa rừng, đi chậm. VA CHẠM: lao tới. DƯ ÂM:
        // tan vào sương ngay tại chân nhà.
        const travel = localTell * 0.45 + localHit * 0.55;
        const fade = 1 - localAfter;
        wolf.visible = fade > 0.02;
        wolf.position.set(
          edge.x + (victim.x - edge.x) * travel,
          0,
          edge.z + (victim.z - edge.z) * travel,
        );
        wolf.rotation.y = Math.atan2(-(victim.z - edge.z), victim.x - edge.x);
        wolf.scale.setScalar((0.85 + travel * 0.2) * (0.4 + fade * 0.6));
        wolfMat.opacity = 0.85 * fade;

        for (let index = 0; index < TRAIL_COUNT; index += 1) {
          const lag = travel - (index + 1) * 0.09;
          const puff = trail[index];
          puff.visible = lag > 0 && fade > 0.02;
          if (!puff.visible) continue;
          puff.position.set(edge.x + (victim.x - edge.x) * lag, 0.05, edge.z + (victim.z - edge.z) * lag);
          puff.scale.setScalar(0.85 - index * 0.12);
        }
        trailMat.opacity = 0.26 * fade;

        /*
         * Duyệt HẾT danh sách nạn nhân mỗi khung hình, không chỉ người đang bị
         * tấn công:
         *
         *   - đã qua lượt  → giữ trạng thái cuối, tức tắt hẳn nếu người đó nằm
         *                    trong `extinguishIds`;
         *   - đang tới lượt → tắt dần theo tiến độ;
         *   - chưa tới lượt → không đụng tới, giữ nguyên mức nền của dữ liệu.
         *
         * Và trả MỌI nhà nạn nhân về đúng toạ độ gốc trước khi áp cú rung. Bản
         * đầu chỉ ghi vị trí khi đang rung và không bao giờ ghi lại, nên căn nhà
         * đứng lệch vĩnh viễn ở chỗ khung hình cuối cùng của cú rung bỏ nó lại.
         */
        for (let index = 0; index < victimCount; index += 1) {
          const slot = victimSlots[index];
          const house = houses[slot];
          house.group.position.x = house.x;
          if (index < which && extinguishSet.has(house.id)) levels[slot] = 0;
        }

        // Cửa sổ chớp lên một nhịp ngay trước cú va chạm, rồi tắt nếu người đó
        // ngã xuống. Không có gì đỏ, không có gì vỡ - đèn tắt là đủ.
        const slot = victimSlots[which];
        if (localHit > 0 && localHit < 1) levels[slot] = Math.min(1, levels[slot] + 0.5 * (1 - localHit));
        if (extinguishSet.has(victim.id)) levels[slot] *= 1 - localAfter;

        if (!reducedMotion && localHit >= 1 && localAfter < 0.35) {
          // Nhà rung nhẹ: một dao động tắt dần, không phải một cơn địa chấn.
          const decay = 1 - localAfter / 0.35;
          victim.group.position.x = victim.x + Math.sin(localAfter * 120) * 0.05 * decay;
        }

        mist.visible = localAfter > 0;
        mistMat.color.setHex(EFFECT_HEX.WOLF_ATTACK);
        mistMat.opacity = 0.34 * localAfter;
        mist.position.set(victim.x, 0.04, victim.z);
        mist.scale.setScalar(1.1 + localAfter * 0.5);
        break;
      }

      case "SHIELD_SAVE": {
        if (!primary) break;
        forestEdge(primary, edge);
        const travel = tell * 0.5 + hit * 0.5;
        // Bóng Sói chạm khiên rồi lùi lại; đèn nhà KHÔNG tắt, và đó là toàn bộ
        // nội dung của cảnh này.
        const recoil = after > 0 ? travel - after * 0.5 : travel;
        wolf.visible = after < 0.75;
        wolf.position.set(
          edge.x + (primary.x - edge.x) * recoil,
          0,
          edge.z + (primary.z - edge.z) * recoil,
        );
        wolf.rotation.y = Math.atan2(-(primary.z - edge.z), primary.x - edge.x);
        wolf.scale.setScalar(1);
        wolfMat.opacity = 0.85 * (1 - after * 0.8);

        const rise = easeInOutCubic(tell);
        dome.visible = true;
        dome.position.set(primary.x, 0.02, primary.z);
        dome.scale.set(1, 0.62 + rise * 0.24, 1);
        domeMat.opacity = effectIntensity(t, 0.34, 0.14, 1.5);

        for (let index = 0; index < arcs.length; index += 1) {
          const arc = arcs[index];
          arc.visible = true;
          arc.position.set(primary.x, 0.02, primary.z);
          arc.rotation.set(0, index * (Math.PI / 2) + (reducedMotion ? 0 : t * 0.5), 0);
        }
        arcMat.opacity = effectIntensity(t, 0.55, 0.2, 1.5);

        // Vòng gợn lan ra từ CHÂN nhà - chỗ cú chặn thật sự xảy ra.
        ripple.visible = true;
        ripple.position.set(primary.x, 0.03, primary.z);
        ripple.scale.setScalar(0.9 + hit * 1.5 + after * 0.6);
        rippleMat.opacity = 0.5 * (1 - after) * (0.3 + hit * 0.7);

        // Chớp NGẮN đúng lúc chạm, và không chói: đỉnh 0.5 rồi tắt trong nhịp
        // dư âm đầu tiên.
        const strike = hit >= 1 && after < 0.3 ? 1 - after / 0.3 : 0;
        flash.visible = strike > 0;
        if (strike > 0) {
          flashMat.color.setHex(EFFECT_HEX.SHIELD_SAVE);
          flashMat.opacity = 0.5 * strike;
          flash.position.set(primary.x, 1.0, primary.z);
          flash.scale.setScalar(1.6 + (1 - strike) * 0.8);
        }
        break;
      }

      case "WITCH_HEAL": {
        if (!primary) break;
        /*
         * Hồ sơ KHÔNG nói Phù Thuỷ ngồi nhà nào - `witch-save` chỉ mang id người
         * được cứu. Nên luồng thuốc đi từ giữa quảng trường, không phải từ một
         * căn nhà chọn bừa: dựng một nguồn không có trong dữ liệu là bịa ra một
         * chuyện đã không xảy ra, và đây là màn XEM LẠI.
         */
        const source = origin ?? { x: 0, z: 0, baseY: 0.6 };
        beamHalo.visible = true;
        beamHaloMat.color.setHex(EFFECT_HEX.WITCH_HEAL);
        beamHaloMat.opacity = 0.2 * (1 - after * 0.7);
        placeBeam(beamHalo, source, 0.6, primary, primary.baseY * 0.8, Math.min(1, tell + hit), 4.5);

        // Hạt sáng xoáy LÊN quanh nhà: sự sống đi lên, không rơi xuống.
        const swirl = tell * 0.5 + hit * 0.5;
        for (let index = 0; index < MOTE_COUNT; index += 1) {
          const mote = motes[index];
          mote.visible = swirl > index / MOTE_COUNT;
          if (!mote.visible) continue;
          const phase = index / MOTE_COUNT;
          const climb = Math.min(1, (swirl - phase) * 1.6 + after * 0.6);
          const angle = phase * Math.PI * 2 + climb * 2.4;
          mote.position.set(
            primary.x + Math.cos(angle) * (0.95 - climb * 0.35),
            0.2 + climb * 1.6,
            primary.z + Math.sin(angle) * (0.95 - climb * 0.35),
          );
          mote.scale.setScalar(1 - climb * 0.4);
        }
        moteMat.color.setHex(EFFECT_HEX.WITCH_HEAL);
        moteMat.opacity = 0.9 * (1 - after * 0.55);

        mist.visible = true;
        mistMat.color.setHex(EFFECT_HEX.WITCH_HEAL);
        mistMat.opacity = effectIntensity(t, 0.3, 0.14, 1.4);
        mist.position.set(primary.x, 0.04, primary.z);
        mist.scale.setScalar(1.2 + hit * 0.3);

        // "Đèn nhà sáng trở lại" - Bình Cứu là lúc DUY NHẤT một ô cửa sáng LÊN.
        const slot = houseIndex.get(primary.id);
        if (slot !== undefined) levels[slot] = Math.max(levels[slot], Math.min(1, 0.25 + Math.max(tell, hit)));
        break;
      }

      case "WITCH_POISON": {
        if (!primary) break;
        const source = origin ?? { x: 0, z: 0 };
        /*
         * Vài giọt bay theo CUNG rồi sương tím ôm chân nhà. Không một khối cầu
         * đặc nào: bản đầu bọc cả căn nhà trong một quả cầu tím, và thứ duy nhất
         * còn đọc được sau đó là quả cầu.
         */
        /*
         * Bốn giọt rời khỏi nguồn LỆCH NHAU rồi cùng tới nơi ở cuối nhịp va
         * chạm. `journey` chạy trọn 0→1 qua cả hai nhịp đầu, và mỗi giọt trừ đi
         * phần trễ của mình - một cách chia thì tự nhiên chỉ có một tham số, và
         * quan trọng hơn là nó không bao giờ bão hoà sớm.
         */
        const journey = tell * 0.55 + hit * 0.45;
        for (let index = 0; index < 4; index += 1) {
          const mote = motes[index];
          const phase = index * 0.12;
          const flight = Math.min(1, Math.max(0, (journey - phase) / (1 - phase)));
          mote.visible = journey < 1 && flight > 0;
          if (!mote.visible) continue;
          mote.position.set(
            source.x + (primary.x - source.x) * flight,
            0.7 + Math.sin(flight * Math.PI) * 1.15,
            source.z + (primary.z - source.z) * flight,
          );
          mote.scale.setScalar(0.9 + index * 0.06);
        }
        for (let index = 4; index < MOTE_COUNT; index += 1) motes[index].visible = false;
        moteMat.color.setHex(EFFECT_HEX.WITCH_POISON);
        moteMat.opacity = 0.85;

        mist.visible = hit > 0;
        mistMat.color.setHex(EFFECT_HEX.WITCH_POISON);
        mistMat.opacity = Math.max(0.22, 0.5 * hit) * (1 - after * 0.3);
        mist.position.set(primary.x, 0.04, primary.z);
        mist.scale.setScalar(0.9 + hit * 0.5 + after * 0.25);

        const slot = houseIndex.get(primary.id);
        if (slot !== undefined && extinguishSet.has(primary.id)) levels[slot] *= 1 - after;
        break;
      }

      case "SEER_BEAM": {
        if (!primary || !origin) break;
        // Tia DÂNG lên, giữ ngắn, rồi tan - và luôn nối đúng hai mái nhà.
        const reach = Math.min(1, tell * 0.7 + hit * 0.3);
        const strength = 1 - after * 0.72;
        const fromY = origin.baseY * 0.85;
        const toY = primary.baseY * 0.85;
        beamCore.visible = true;
        beamHalo.visible = true;
        beamCoreMat.color.setHex(EFFECT_HEX.SEER_BEAM);
        beamHaloMat.color.setHex(EFFECT_HEX.SEER_BEAM);
        beamCoreMat.opacity = 0.9 * strength;
        beamHaloMat.opacity = 0.3 * strength;
        placeBeam(beamCore, origin, fromY, primary, toY, reach, 1);
        placeBeam(beamHalo, origin, fromY, primary, toY, reach, 6.5);

        // Một điểm sáng chạy dọc tia: nó nói tia này ĐI theo hướng nào.
        beamDot.visible = reach < 1;
        beamDot.position.set(
          origin.x + (primary.x - origin.x) * reach,
          fromY + (toY - fromY) * reach,
          origin.z + (primary.z - origin.z) * reach,
        );

        // Cả hai đầu sáng nhẹ - người xem phải đọc được "từ nhà này soi sang nhà
        // kia", không chỉ "có một cái que trắng".
        const originSlot = houseIndex.get(origin.id);
        const targetSlot = houseIndex.get(primary.id);
        if (originSlot !== undefined) levels[originSlot] = Math.min(1, levels[originSlot] + 0.25 * strength);
        if (targetSlot !== undefined) levels[targetSlot] = Math.min(1, levels[targetSlot] + 0.3 * hit * strength);

        /*
         * Dấu Sói trên mái. Chỉ dùng được vì hồ sơ đã KHẲNG ĐỊNH đó là Sói:
         * `selectHighlights` chỉ sinh điểm ngoặt `seer-check` khi `isWolf`, nên
         * đây là kể lại chứ không phải đoán. Và cũng chỉ hợp lệ ở GAME_OVER, khi
         * vai đã công khai.
         */
        mark.visible = hit > 0;
        markMat.opacity = 0.8 * hit * (1 - after * 0.45);
        mark.position.set(primary.x, primary.baseY + 0.95, primary.z);
        mark.rotation.x = -Math.PI / 2;
        mark.scale.setScalar(0.55 + hit * 0.25);
        break;
      }

      case "HUNTER_SHOT": {
        if (!primary || !origin) break;
        const fromY = origin.baseY * 0.8;
        const toY = primary.baseY * 0.8;
        // Ánh lửa đầu nòng: rất ngắn, ngay ở nhà Thợ Săn, trong nhịp báo trước.
        const muzzle = tell < 1 ? 1 - tell : 0;
        flash.visible = muzzle > 0;
        if (muzzle > 0) {
          flashMat.color.setHex(EFFECT_HEX.HUNTER_SHOT);
          flashMat.opacity = 0.55 * muzzle;
          flash.position.set(origin.x, fromY, origin.z);
          flash.scale.setScalar(0.7 + (1 - muzzle) * 0.5);
        }

        // Vệt đạn RẤT nhanh, rồi đọng lại thành một đường mờ: người xem tạm dừng
        // ở bước này vẫn phải thấy phát bắn đi từ đâu tới đâu.
        const strength = Math.max(0.28, 1 - after);
        beamCore.visible = true;
        beamHalo.visible = true;
        beamCoreMat.color.setHex(EFFECT_HEX.HUNTER_SHOT);
        beamHaloMat.color.setHex(EFFECT_HEX.HUNTER_SHOT);
        beamCoreMat.opacity = 0.95 * strength;
        beamHaloMat.opacity = 0.22 * strength;
        placeBeam(beamCore, origin, fromY, primary, toY, Math.min(1, hit * 3 + tell * 0.2), 0.7);
        placeBeam(beamHalo, origin, fromY, primary, toY, Math.min(1, hit * 3 + tell * 0.2), 3.5);
        beamCore.visible = true;

        // Vài tia lửa low-poly ở điểm chạm. Không có vụ nổ nào.
        const spark = hit >= 1 ? Math.min(1, after * 3) : 0;
        for (let index = 0; index < MOTE_COUNT; index += 1) {
          const mote = motes[index];
          mote.visible = spark > 0 && spark < 1;
          if (!mote.visible) continue;
          const angle = (index / MOTE_COUNT) * Math.PI * 2;
          mote.position.set(
            primary.x + Math.cos(angle) * spark * 0.75,
            toY + Math.sin(angle * 1.7) * spark * 0.5 + spark * 0.2,
            primary.z + Math.sin(angle) * spark * 0.75,
          );
          mote.scale.setScalar(1 - spark * 0.6);
        }
        moteMat.color.setHex(EFFECT_HEX.HUNTER_SHOT);
        moteMat.opacity = 0.9 * (1 - spark);

        const slot = houseIndex.get(primary.id);
        if (slot !== undefined && extinguishSet.has(primary.id)) levels[slot] *= 1 - after;
        break;
      }

      case "LYNCH":
      case "TRIAL_SCALES": {
        const lynch = step.effect === "LYNCH";
        const accused = primary;
        // Ánh quảng trường DÂNG LÊN đúng lúc phán quyết - khoảnh khắc này diễn
        // ra ở đây, và ánh sáng phải nói điều đó.
        squareGlowMat.opacity = 0.2 + 0.34 * hit * (1 - after * 0.4);

        if (lynch) {
          /*
           * Các con dấu HỘI TỤ về giữa quảng trường rồi xếp thành một cột chặt.
           * Chuyển động phải đọc ra là "cả làng dồn về một phía", nên chúng đi
           * theo cùng một nhịp chứ không rơi lả tả mỗi cái một kiểu.
           */
          const gather = easeInOutCubic(Math.min(1, tell * 0.55 + hit * 0.45));
          const spread = Math.max(2.1, model.groundRadius * 0.44);
          for (let index = 0; index < SEAL_COUNT; index += 1) {
            const seal = seals[index];
            seal.visible = true;
            const angle = (index / SEAL_COUNT) * Math.PI * 2;
            /*
             * Bán kính cuối là 0.85, KHÔNG phải 0.
             *
             * Cho chúng chụm hẳn vào một điểm thì tám con dấu chồng lên nhau
             * thành một cục đỏ, và một cục thì không đếm được, không đọc ra là
             * phiếu. Dừng lại ở một vòng khép chặt quanh miệng giếng thì vẫn là
             * "cả làng dồn về một phía" mà mỗi lá phiếu vẫn còn là một lá phiếu.
             */
            const radius = spread * (1 - gather) + 0.85 * gather;
            seal.position.set(
              Math.cos(angle) * radius,
              0.95 + gather * 0.5 + (index % 2) * 0.1,
              Math.sin(angle) * radius,
            );
          }
          sealMat.color.setHex(EFFECT_HEX.LYNCH);
          sealMat.opacity = Math.max(0.5, 0.92 - after * 0.4);
        } else {
          /*
           * Cán cân. Đòn nghiêng theo `tally` khi hồ sơ CÓ con số; không có thì
           * hai bên cân bằng - `vote-swing` chỉ ghi lại một lá phiếu đổi chiều,
           * và dựng ra một tỉ lệ ở đó là bịa.
           *
           * Bên nào THẤP hơn là bên nặng hơn, đúng như một cái cân thật, nên kết
           * quả đọc được bằng bố cục chứ không cần đếm.
           */
          const tally = step.tally;
          const total = tally ? tally.hang + tally.spare : 0;
          const bias = total > 0 ? (tally!.hang - tally!.spare) / total : 0;
          /*
           * Độ nghiêng đi theo CĂN của chênh lệch, không tuyến tính theo nó.
           *
           * Tuyến tính thì một phiên toà 5-3 chỉ nghiêng vài độ, và ở khoảng
           * cách camera của bước này thì vài độ là không nghiêng. Đường cong căn
           * giữ nguyên DẤU và thứ tự - bên nào nặng hơn vẫn là bên nào nặng hơn
           * - nên nó không nói sai điều gì; con số chính xác đã nằm bằng chữ
           * trong lớp phủ DOM, còn cán cân chỉ trả lời "nghiêng về đâu".
           */
          const lean = Math.sign(bias) * Math.sqrt(Math.abs(bias)) * 0.5;
          const tilt = easeInOutCubic(Math.min(1, tell * 0.5 + hit * 0.5)) * lean;
          scaleBeam.visible = true;
          scaleBeam.position.set(0, SCALE_HEIGHT, 0);
          scaleBeam.rotation.set(0, Math.PI / 4, tilt);
          const arm = SCALE_ARM;
          for (let index = 0; index < 2; index += 1) {
            /*
             * Đĩa 0 là bên "treo", và nó đi XUỐNG khi phiếu treo nhiều hơn -
             * đúng như một cái cân thật, nên kết quả đọc được bằng bố cục.
             *
             * Hai đầu đòn nằm ở đâu thì suy từ chính phép quay của đòn, không
             * đặt riêng: đòn quay `Ry(π/4)` sau khi nghiêng `Rz(tilt)`, nên đầu
             * `+X` rơi vào hướng `(cos45, sin tilt, -sin45)`. Đặt tay hai con
             * số cho hai chỗ phải khớp nhau là cách chắc chắn nhất để đĩa treo
             * lửng giữa trời cách đòn cân một quãng.
             */
            const dir = index === 0 ? -1 : 1;
            const endY = SCALE_HEIGHT + dir * Math.sin(tilt) * arm;
            const pan = pans[index];
            pan.visible = true;
            pan.position.set(dir * Math.SQRT1_2 * arm, endY - 0.5, -dir * Math.SQRT1_2 * arm);

            const hanger = hangers[index];
            hanger.visible = true;
            hanger.scale.set(1, endY - pan.position.y, 1);
            hanger.position.set(pan.position.x, (endY + pan.position.y) / 2, pan.position.z);

            for (let seat = 0; seat < SEAL_COUNT / 2; seat += 1) {
              const seal = seals[index * (SEAL_COUNT / 2) + seat];
              seal.visible = true;
              // Hai hàng hai cột trên đĩa: một trật tự đọc được, không phải mấy
              // đồng xu rơi đâu nằm đấy.
              seal.position.set(
                pan.position.x + (seat % 2 === 0 ? -0.27 : 0.27),
                pan.position.y + 0.16 + Math.floor(seat / 2) * 0.3,
                pan.position.z + (seat % 2 === 0 ? 0.18 : -0.18),
              );
            }
          }
          sealMat.color.setHex(EFFECT_HEX.TRIAL_SCALES);
          sealMat.opacity = 0.92;
        }

        if (lynch && accused) {
          const slot = houseIndex.get(accused.id);
          if (slot !== undefined && extinguishSet.has(accused.id)) levels[slot] *= 1 - after;
          mist.visible = after > 0;
          mistMat.color.setHex(EFFECT_HEX.LYNCH);
          mistMat.opacity = 0.28 * after;
          mist.position.set(accused.x, 0.04, accused.z);
          mist.scale.setScalar(1.1 + after * 0.4);
        }
        break;
      }

      case "CURSED_MOON": {
        if (!primary) break;
        /*
         * Trăng và quầng đã đỏ từ `setStep`, ánh môi trường cũng vậy. Ở CHÂN nhà
         * chỉ có một vành mảnh dâng lên và một làn sương đỏ.
         *
         * Bản đầu bọc căn nhà trong một khối cầu đặc bán kính gần 1 đơn vị, và
         * ở khung hình thật nó che gần hết mái. Nhà KHÔNG tắt đèn - đổi phe
         * không phải là chết - nên căn nhà phải nhìn thấy được, nếu không thì
         * cảnh này không kể được gì cả.
         */
        aura.visible = true;
        auraMat.opacity = effectIntensity(t, 0.8, 0.34, 1.3);
        // Vành nở ra và dâng lên, cao nhất tới quá nửa thân nhà. Cố ý dừng thấp
        // hơn mái: căn nhà là chủ thể, không phải cái vành.
        aura.position.set(primary.x, 0.05 + Math.min(0.55, hit * 0.55), primary.z);
        aura.scale.setScalar(0.95 + hit * 0.35);

        mist.visible = true;
        mistMat.color.setHex(EFFECT_HEX.CURSED_MOON);
        mistMat.opacity = effectIntensity(t, 0.34, 0.16, 1.2);
        mist.position.set(primary.x, 0.04, primary.z);
        mist.scale.setScalar(1.15 + hit * 0.25);

        mark.visible = hit > 0;
        markMat.opacity = 0.7 * hit * (1 - after * 0.4);
        mark.position.set(primary.x, primary.baseY + 1.0, primary.z);
        mark.rotation.x = -Math.PI / 2;
        mark.scale.setScalar(0.5 + hit * 0.2);
        break;
      }

      case "LONE_LIGHT": {
        /*
         * Toàn làng tối xuống, một căn còn sáng. Hiệu ứng DUY NHẤT được phép làm
         * mờ những nhà mà dòng thời gian nói là còn sáng - và nó chỉ làm mờ,
         * không tắt: người sống vẫn còn ánh đèn le lói.
         */
        const dim = easeInOutCubic(Math.min(1, tell * 0.6 + hit * 0.4));
        for (let index = 0; index < houses.length; index += 1) {
          if (step.targetIds.includes(houses[index].id)) continue;
          levels[index] *= 1 - dim * 0.82;
        }
        if (primary) {
          const slot = houseIndex.get(primary.id);
          if (slot !== undefined) levels[slot] = 1;
          // Sương quanh nhà cuối cùng TÁCH RA thay vì phủ lên: một vũng ấm rộng
          // dần, không phải một lớp mù.
          mist.visible = true;
          mistMat.color.setHex(EFFECT_HEX.LONE_LIGHT);
          mistMat.opacity = 0.16 + 0.16 * hit;
          mist.position.set(primary.x, 0.04, primary.z);
          mist.scale.setScalar(1.6 + hit * 0.9 + after * 0.4);
        }
        break;
      }

      case "GENERIC": {
        /*
         * Chưa có cảnh riêng thì KHÔNG bịa thêm hành động. Một nhịp sáng nhẹ ở
         * những người trong cuộc, và chữ trong lớp phủ DOM làm nốt phần kể
         * chuyện. Nhưng cảnh cũng không được đứng hình: một bước không có gì
         * chuyển động đọc ra là một lỗi hiển thị.
         */
        const pulse = effectIntensity(t, 0.45, 0.16, 1.1);
        for (const id of step.participantIds.length > 0 ? step.participantIds : step.targetIds) {
          const slot = houseIndex.get(id);
          if (slot !== undefined) levels[slot] = Math.min(1, levels[slot] + pulse * 0.55);
        }
        if (primary) {
          mist.visible = true;
          mistMat.color.setHex(EFFECT_HEX.GENERIC);
          mistMat.opacity = pulse * 0.5;
          mist.position.set(primary.x, 0.04, primary.z);
          mist.scale.setScalar(1.2);
        }
        break;
      }
    }

    // Phong thư: phong bì nổi lên trên mái nhà tác giả và nắp gập mở ra. Nội
    // dung chữ ở thẻ DOM bên dưới, không một ký tự nào dựng bằng 3D.
    const letter = step.letters[0];
    const author = houseOf(letter?.authorId);
    if (letter && author) {
      const rise = Math.min(1, Math.max(0, (t - BEAT.tell) / 0.4));
      envelope.visible = true;
      envelope.position.set(author.x, author.baseY + 1.15 + rise * 0.3, author.z);
      // Giảm chuyển động: nắp đã mở sẵn, không có gì gập ra trước mắt.
      flapPivot.rotation.x = reducedMotion ? -Math.PI * 0.8 : -Math.PI * 0.8 * rise;
    }
  }

  // ---- Vẽ ----

  function paintHouses(elapsed: number, sinceStep: number): void {
    for (let index = 0; index < houses.length; index += 1) {
      const house = houses[index];
      let level = Math.min(1, Math.max(0, levels[index]));

      /*
       * Nhấp nháy của ngọn đèn: BIÊN ĐỘ 4%, và chỉ trên nhà đang sáng.
       *
       * Đủ để ánh đèn có vẻ là lửa chứ không phải một hình chữ nhật tô màu, chưa
       * đủ để ai đó nhầm nó với một tín hiệu. Công thức tất định theo chỉ số nhà,
       * nên mười lăm ô cửa không nháy cùng nhịp.
       */
      if (!reducedMotion && level > 0.35) {
        level *= 0.96 + 0.04 * Math.sin(elapsed * 0.004 + index * 2.1);
      }

      tmpColor.copy(darkColor).lerp(litColor, level);
      house.windowMaterial.color.copy(tmpColor);
      house.windowMaterial.opacity = 0.55 + 0.45 * level;

      // Vũng sáng dưới chân: ấm theo ánh đèn, và luôn còn một chút sương xanh
      // xám ở nhà đã tắt - "tối và có sương, nhưng vẫn nhìn thấy hình dáng".
      tmpColor.copy(mistColor).multiplyScalar(0.34).lerp(litColor, level * 0.9);
      tmpColor.multiplyScalar(0.22 + level * 0.45);
      houseAura.setColorAt(index, tmpColor);

      tmpColor.setHex(house.accentHex).multiplyScalar(accentLevel(house.id, sinceStep));
      accentRings.setColorAt(index, tmpColor);
    }
    if (houseAura.instanceColor) houseAura.instanceColor.needsUpdate = true;
    if (accentRings.instanceColor) accentRings.instanceColor.needsUpdate = true;
  }

  /** Sương trôi và cây đung đưa. Tắt hẳn khi người dùng bật giảm chuyển động. */
  function drift(elapsed: number): void {
    for (let index = 0; index < FOG_COUNT; index += 1) {
      const patch = fogPatches[index];
      const angle = elapsed * 0.000045 * (index + 1) + index * 2.3;
      const radius = model.groundRadius * (0.2 + index * 0.13);
      patch.position.x = Math.cos(angle) * radius;
      patch.position.z = Math.sin(angle) * radius;
    }

    for (let index = 0; index < FOREST_COUNT; index += 1) {
      const scale = treeBase[index * 4 + 2];
      const sway = Math.sin(elapsed * 0.0006 + treeBase[index * 4 + 3]) * 0.022;
      dummy.position.set(treeBase[index * 4], 0.86 * scale, treeBase[index * 4 + 1]);
      dummy.rotation.set(sway, treeBase[index * 4 + 3], sway * 0.6);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      forest.setMatrixAt(index, dummy.matrix);
    }
    forest.instanceMatrix.needsUpdate = true;
  }

  return {
    setStep,

    update(nowMs, camera) {
      if (builtAt === 0) builtAt = nowMs;
      const elapsed = nowMs - builtAt;

      // Góc mở phải khớp với phép tính đóng khung, nếu không thì mọi con số ở
      // `village-memory-camera` nói về một camera khác.
      if (camera.fov !== CAMERA_FOV) {
        camera.fov = CAMERA_FOV;
        camera.updateProjectionMatrix();
      }
      /*
       * Tỉ lệ khung đổi được giữa chừng - xoay điện thoại, thanh địa chỉ trượt
       * đi - và khoảng cách phải tính lại theo nó. Chỉ tính lại khi nó THẬT SỰ
       * đổi: phép dò khoảng cách chiếu vài chục điểm hai mươi lần, quá đắt để
       * chạy mỗi khung hình và hoàn toàn thừa khi không có gì đổi.
       */
      if (camera.aspect !== framedAspect) {
        framedAspect = camera.aspect;
        /*
         * Chỉ tính lại cái ĐÍCH. Nguồn là một tư thế đã đông cứng trong không
         * gian, và một chỗ đứng thì không phụ thuộc tỉ lệ khung hình - đóng
         * khung lại nó sẽ dịch camera ngay giữa cú lia, đúng thứ cần tránh.
         * Xoay máy giữa chừng vì vậy chỉ đổi nơi camera đang đi TỚI.
         */
        toView.distance = fitDistance(toView.points, toView.look, framedAspect, toView.fill);
        // Hướng trăng cũng chỉ phụ thuộc tỉ lệ khung. Tính ở đây thì khung hình
        // bình thường không cấp phát gì cả - `moonDirection` trả về một vật thể
        // mới, và một vật thể mới mỗi khung hình là rác mỗi khung hình.
        const direction = moonDirection(framedAspect);
        moonAt.set(
          direction.x * MOON_DISTANCE,
          direction.y * MOON_DISTANCE,
          direction.z * MOON_DISTANCE,
        );
        moon.position.copy(moonAt);
        // Quầng đặt LÙI RA SAU lõi một chút: hai cái đĩa đồng phẳng ở cùng độ
        // sâu thì tranh nhau từng pixel, và vết tranh đó hiện ra thành một
        // đường nứt chạy ngang mặt trăng.
        moonHaloInner.position.copy(moonAt).multiplyScalar(1.02);
        moonHaloOuter.position.copy(moonAt).multiplyScalar(1.04);
      }

      const glide = glideAt(nowMs);
      const distance = fromPose.distance + (toView.distance - fromPose.distance) * glide;
      const lookX = fromPose.look.x + (toView.look.x - fromPose.look.x) * glide;
      const lookY = fromPose.look.y + (toView.look.y - fromPose.look.y) * glide;
      const lookZ = fromPose.look.z + (toView.look.z - fromPose.look.z) * glide;

      // Rung máy: cả ba điều kiện - hiệu ứng nào, lúc nào, có giảm chuyển động
      // không - nằm gọn trong `shakeFor`, nơi chúng test được.
      const shake = shakeFor(current?.effect ?? null, nowMs - stepStartedAt, EFFECT_MS, reducedMotion);

      camera.position.set(
        lookX + VIEW_DIR.x * distance + shake,
        lookY + VIEW_DIR.y * distance + shake * 0.6,
        lookZ + VIEW_DIR.z * distance,
      );
      tmpVecB.set(lookX, lookY, lookZ);
      camera.lookAt(tmpVecB);

      // Bầu trời đi theo camera - xem chú thích ở chỗ dựng `sky`.
      sky.position.copy(camera.position);
      sky.quaternion.copy(camera.quaternion);

      if (envelope.visible) envelope.quaternion.copy(camera.quaternion);
      if (seals[0].visible) for (const seal of seals) seal.quaternion.copy(camera.quaternion);
      if (flash.visible) flash.quaternion.copy(camera.quaternion);

      if (!reducedMotion) drift(elapsed);

      const sinceStep = nowMs - stepStartedAt;
      squareGlowMat.opacity = 0.2;
      levels.set(baseLevels);
      if (current) {
        /*
         * Giảm chuyển động: đứng thẳng ở TRẠNG THÁI CUỐI của hiệu ứng.
         *
         * Không phải "không vẽ gì": người xem vẫn phải biết ai đã ngã xuống, ai
         * được cứu, tia soi nối hai nhà nào. Mất chuyển động thì không được mất
         * thông tin - nên `t = 1`, tức đúng cái khung hình mà người xem bình
         * thường thấy khi cảnh diễn xong.
         */
        const t = reducedMotion ? 1 : Math.min(1, Math.max(0, sinceStep / EFFECT_MS));
        runEffect(current, t);
      }
      paintHouses(elapsed, sinceStep);
    },

    dispose() {
      // Gỡ khỏi scene TRƯỚC khi dispose: một vật thể còn trong graph mà vật liệu
      // đã trả về GPU là một khung hình nữa sẽ ném lỗi nếu vòng vẽ chưa kịp dừng.
      scene.clear();
      scene.background = null;
      scene.fog = null;
      registry.disposeAll();
      houseById.clear();
      houseIndex.clear();
    },
  };
}
