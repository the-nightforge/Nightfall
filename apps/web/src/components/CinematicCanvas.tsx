"use client";

import { useEffect, useRef, useState } from "react";
import type { CinematicKind } from "@/lib/cinematic-transition";
import { renderScale } from "@/lib/cinematic-webgl";

type ThreeModule = typeof import("three");
type Scene3D = import("three").Scene;
type Renderer3D = import("three").WebGLRenderer;

/**
 * MỘT renderer cho cả phiên.
 *
 * Component này bị remount mỗi lần đổi cảnh, nhưng context WebGL thì không được
 * đi theo. Tạo context tốn hàng chục ms, trình duyệt chỉ cấp vài context đồng
 * thời, và `renderer.dispose()` KHÔNG thật sự trả context lại ở mọi trình duyệt.
 * Dựng lại mỗi cảnh nghĩa là mười lần một ván - đủ để chạm trần rồi
 * `getContext` bắt đầu trả null giữa ván.
 */
let sharedRenderer: Renderer3D | null = null;

function getRenderer(THREE: ThreeModule): Renderer3D {
  if (!sharedRenderer) {
    sharedRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
  }
  return sharedRenderer;
}

/**
 * Vứt hẳn renderer. CHỈ gọi khi context đã mất - lúc đó nó không cứu được nữa.
 *
 * `forceContextLoss()` trước `dispose()`: dispose một mình để lại context sống
 * trong một số trình duyệt, và đó đúng là thứ đang làm hết quota.
 */
function destroyRenderer(): void {
  if (!sharedRenderer) return;
  sharedRenderer.forceContextLoss();
  sharedRenderer.dispose();
  sharedRenderer = null;
}

interface Props {
  kind: CinematicKind;
  /** Cảnh phải trọn vẹn trong khoảng này. Overlay tự gọi finish khi hết. */
  durationMs: number;
  /** Dựng hỏng hoặc mất context. Bên gọi rơi vĩnh viễn về đường video/CSS. */
  onFail: () => void;
}

/**
 * Lớp 3D nằm CHỒNG LÊN cảnh CSS, không thay nó.
 *
 * Giống hệt cách `<video>` đang làm trong cùng overlay: mờ 0 cho tới khung hình
 * đầu tiên rồi hiện dần vào. Nhờ vậy lưới an toàn có sẵn mà không phải viết gì -
 * WebGL chết giữa chừng thì cảnh CSS vẫn đang nằm bên dưới, người chơi thấy bản
 * phẳng chứ không thấy màn đen.
 */
export function CinematicCanvas({ kind, durationMs, onFail }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let painted = false;
    let frame = 0;
    let cleanup: (() => void) | undefined;

    /*
     * `import()` động, không import tĩnh ở đầu file.
     *
     * Đúng lý do mà `MotionProvider` lazy-load `domAnimation`: import tĩnh sẽ
     * gói ~600KB three.js vào chunk đầu của MỌI người, kể cả người không bao
     * giờ thấy một cảnh 3D nào.
     */
    void (async () => {
      try {
        const THREE = await import("three");
        if (disposed) return;

        // Renderer ở CẤP MODULE, không dựng lại mỗi cảnh. Component này bị
        // remount mỗi lần đổi cảnh (key theo lần phát), nhưng context thì
        // không được đi theo: tạo context tốn hàng chục ms, và
        // `renderer.dispose()` KHÔNG thật sự trả context ở mọi trình duyệt -
        // lặp mười lần một ván là chạm trần context rồi `getContext` trả null.
        const renderer = getRenderer(THREE);
        renderer.setPixelRatio(renderScale(window.devicePixelRatio));
        renderer.setSize(host.clientWidth, host.clientHeight);
        host.append(renderer.domElement);

        // Mất context là chuyện có thật trên điện thoại khi máy thiếu bộ nhớ.
        // Báo lên để bên gọi thôi hẳn, chứ không thử lại vô ích.
        const onLost = (event: Event) => {
          event.preventDefault();
          // Dừng vòng vẽ TRƯỚC khi huỷ renderer: `onFail` của bên gọi là một
          // setState, mà React gộp lô state - nên vẫn còn ít nhất một khung
          // hình được lên lịch, và khung đó sẽ gọi render() trên một renderer
          // đã dispose rồi ném lỗi. Mất context vốn đã là lúc máy đang thiếu
          // bộ nhớ; không nên chồng thêm một lỗi nữa lên đó.
          disposed = true;
          cancelAnimationFrame(frame);
          destroyRenderer();
          onFail();
        };
        renderer.domElement.addEventListener("webglcontextlost", onLost);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(
          50,
          host.clientWidth / host.clientHeight,
          0.1,
          100,
        );
        camera.position.set(0, 0, 6);

        const built = buildNightfall(THREE, scene);

        const started = performance.now();
        const tick = () => {
          if (disposed) return;
          // Tiến độ theo THỜI GIAN, không theo số khung đã vẽ: máy chậm phải
          // thấy cùng một cảnh với ít khung hơn, chứ không phải một cảnh chạy
          // chậm lại rồi bị overlay cắt ngang giữa chừng.
          const t = Math.min(1, (performance.now() - started) / durationMs);
          built.update(t, camera);
          renderer.render(scene, camera);
          // Cờ cục bộ, KHÔNG đọc state `ready`: cho `ready` vào deps của effect
          // thì lần setReady đầu tiên sẽ chạy lại effect, tháo scene rồi dựng
          // lại, vẽ tiếp, và lặp vô tận.
          if (!painted) {
            painted = true;
            setReady(true);
          }
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);

        const onResize = () => {
          renderer.setSize(host.clientWidth, host.clientHeight);
          camera.aspect = host.clientWidth / host.clientHeight;
          camera.updateProjectionMatrix();
        };
        window.addEventListener("resize", onResize);

        cleanup = () => {
          cancelAnimationFrame(frame);
          window.removeEventListener("resize", onResize);
          renderer.domElement.removeEventListener("webglcontextlost", onLost);
          // Trả GPU memory của SCENE. Renderer thì giữ lại - nó dùng chung cho
          // mọi cảnh trong phiên, và huỷ nó là tự chuốc lấy đúng cái trần
          // context mà singleton này sinh ra để tránh.
          built.dispose();
          scene.clear();
          renderer.domElement.remove();
        };
      } catch {
        // three.js không tải được, hoặc máy từ chối cấp context. Không có gì
        // để cứu - báo lên và để cảnh CSS bên dưới làm nốt việc.
        if (!disposed) onFail();
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cleanup?.();
    };
    // `ready` KHÔNG được nằm trong deps - xem chú thích ở chỗ setReady. `onFail`
    // phải ổn định (bên gọi bọc trong useCallback), nếu không thì mỗi lần cha
    // render lại là một lần tháo/dựng lại scene.
  }, [kind, durationMs, onFail]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={`absolute inset-0 transition-opacity duration-300 ${
        ready ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

interface BuiltScene {
  update(t: number, camera: import("three").PerspectiveCamera): void;
  dispose(): void;
}

/**
 * Nhịp chung cho mọi chuyển động trong cảnh.
 *
 * Không có gì trong tự nhiên khởi hành từ đứng yên rồi chạy đều. Bản đầu để
 * trăng và sương đi tuyến tính trong khi làng lại có easing, nên hai nửa cảnh
 * chạy hai nhịp khác nhau - đó là một phần của cảm giác "giả".
 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Một nếp nhà: thân, mái LỆCH, và có thể có ống khói.
 *
 * Dựng bằng `Shape` PHẲNG chứ không phải `BoxGeometry`. Camera nhìn hơi chếch
 * nên một khối hộp lộ cả mặt nóc lẫn mặt hông - mà siluet thì theo định nghĩa
 * chỉ có một mặt, và cái nóc lộ ra chính là thứ tố cáo "đây là mấy cái hộp".
 *
 * Nóc lệch và ống khói không phải trang trí. Tám hình ngũ giác đối xứng hoàn
 * hảo xếp cạnh nhau đọc ra một hàng rào răng cưa, không phải một xóm - đó là
 * cái "giả" mà mắt bắt được trước cả khi kịp nghĩ tại sao.
 *
 * Gốc toạ độ đặt ở ĐÁY nhà, nên đặt nó lên đường chân trời là xong.
 */
function cottageShape(
  THREE: ThreeModule,
  width: number,
  body: number,
  roof: number,
  apexBias: number,
  chimney: boolean,
) {
  const half = width / 2;
  const apexX = apexBias * half;
  const ridge = body + roof;
  const shape = new THREE.Shape();

  shape.moveTo(-half, 0);
  shape.lineTo(-half, body);
  shape.lineTo(apexX, ridge);

  if (chimney) {
    // Ống khói phải mọc TỪ mặt mái dốc, nên chân nó lấy theo đúng đường thẳng
    // từ nóc xuống diềm - cắm một hình chữ nhật lơ lửng là lộ ngay.
    const onRoof = (x: number) => ridge + ((body - ridge) * (x - apexX)) / (half - apexX);
    const startX = apexX + (half - apexX) * 0.42;
    const stackW = width * 0.13;
    const top = ridge + roof * 0.5;
    shape.lineTo(startX, onRoof(startX));
    shape.lineTo(startX, top);
    shape.lineTo(startX + stackW, top);
    shape.lineTo(startX + stackW, onRoof(startX + stackW));
  }

  shape.lineTo(half, body);
  shape.lineTo(half, 0);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/**
 * Nhà thờ: thân rộng, tháp nhọn vươn hẳn lên.
 *
 * Một cái mốc cao trong đường chân trời. Xóm nào cũng có một thứ cao hơn hẳn
 * phần còn lại, và thiếu nó thì tám nóc nhà xấp xỉ nhau trông như đồ hoạ tự
 * sinh chứ không phải một nơi có người ở.
 */
function chapelShape(THREE: ThreeModule, width: number, body: number, spire: number) {
  const half = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-half, 0);
  shape.lineTo(-half, body);
  shape.lineTo(-half * 0.62, body + spire * 0.22);
  shape.lineTo(-half * 0.30, body + spire * 0.24);
  shape.lineTo(-half * 0.16, body + spire * 0.52);
  shape.lineTo(0, body + spire);
  shape.lineTo(half * 0.16, body + spire * 0.52);
  shape.lineTo(half * 0.30, body + spire * 0.24);
  shape.lineTo(half * 0.62, body + spire * 0.22);
  shape.lineTo(half, body);
  shape.lineTo(half, 0);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/**
 * Cây thông: ba tầng tán so le trên một thân mảnh.
 *
 * Cây làm việc mà nhà không làm được: nó phá nhịp mái-tường-mái-tường. Một
 * đường chân trời chỉ toàn nhà thì đều đặn một cách máy móc.
 */
function coniferShape(THREE: ThreeModule, width: number, height: number) {
  const half = width / 2;
  const trunk = width * 0.1;
  const shape = new THREE.Shape();
  shape.moveTo(-trunk, 0);
  shape.lineTo(-trunk, height * 0.16);
  shape.lineTo(-half, height * 0.2);
  shape.lineTo(-half * 0.52, height * 0.44);
  shape.lineTo(-half * 0.8, height * 0.46);
  shape.lineTo(-half * 0.34, height * 0.74);
  shape.lineTo(-half * 0.52, height * 0.75);
  shape.lineTo(0, height);
  shape.lineTo(half * 0.52, height * 0.75);
  shape.lineTo(half * 0.34, height * 0.74);
  shape.lineTo(half * 0.8, height * 0.46);
  shape.lineTo(half * 0.52, height * 0.44);
  shape.lineTo(half, height * 0.2);
  shape.lineTo(trunk, height * 0.16);
  shape.lineTo(trunk, 0);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

const SKY_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/*
 * Trời, trăng và sương vẽ TRONG shader, không phải bằng vật thể.
 *
 * Bản đầu dựng sương bằng ba tấm `PlaneGeometry` màu đặc: chúng có cạnh chữ
 * nhật cứng và trôi ngang nguyên khối, nên mắt bắt được ngay đó là ba tấm kính
 * màu chứ không phải sương. Nhiễu trong shader thì không có cạnh nào để thấy.
 *
 * Trăng cũng vậy: bản đầu là `SphereGeometry` chiếu bằng `PointLight` đặt gần
 * như bên trong nó, cho ra một quả cầu có đốm sáng và rìa tối. Trăng thật ở xa
 * vô cùng nên là một ĐĨA sáng đều. Vẽ bằng distance field vừa đúng hơn vừa rẻ.
 *
 * Và đây là chỗ lời hứa "trăng đổ sáng lên sương" mới thành thật: quầng sáng
 * của trăng nhân thẳng vào độ sáng của sương. Bản đầu CÓ `PointLight`, nhưng
 * sương và nhà đều dùng `MeshBasicMaterial` - vật liệu KHÔNG nhận ánh sáng -
 * nên hai cái đèn trong scene chưa từng chiếu lên bất cứ thứ gì.
 */
const SKY_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform float uT;
uniform float uAspect;
uniform vec2 uMoon;
uniform float uMoonR;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * valueNoise(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return sum;
}

void main() {
  // Bang mau noi tiep .cine-nightfall cua ban CSS, khong ve lai tu dau.
  // (GLSL nam trong template literal nen tuyet doi khong duoc co dau backtick)
  vec3 high = vec3(0.039, 0.071, 0.149);
  vec3 mid = vec3(0.020, 0.035, 0.078);
  vec3 low = vec3(0.008, 0.012, 0.039);
  vec3 sky = mix(low, mid, smoothstep(0.0, 0.55, vUv.y));
  sky = mix(sky, high, smoothstep(0.45, 1.0, vUv.y));

  // Màn đêm buông: cả bầu trời trầm xuống trong suốt cảnh.
  sky *= mix(1.10, 0.58, uT);

  vec2 d = vec2((vUv.x - uMoon.x) * uAspect, vUv.y - uMoon.y);
  float dist = length(d);

  // Đĩa trăng: biên mềm vừa đủ để không răng cưa, KHÔNG đổ khối cầu.
  float disc = 1.0 - smoothstep(uMoonR * 0.93, uMoonR, dist);
  // Quầng sáng toả - đây là thứ làm trăng nằm TRONG bầu trời thay vì dán lên.
  float halo = exp(-dist * 9.0) * 0.42 + exp(-dist * 3.2) * 0.07;

  vec3 moonColor = vec3(0.87, 0.91, 1.0);
  vec3 color = sky + moonColor * halo * (0.35 + 0.65 * uT);
  color = mix(color, moonColor, disc);

  // Sương bám chân trời rồi tan dần lên cao - không còn cạnh nào để nhìn thấy.
  float band = smoothstep(0.46, 0.02, vUv.y);
  vec2 fp = vec2(vUv.x * uAspect, vUv.y);
  // Trôi theo easing chứ không đều: uT đã là 0..1 nên bình phương cho nó nhích
  // chậm lúc đầu rồi trôi nhanh dần, giống một luồng khí bắt đầu chuyển động.
  float drift = uT * uT;
  float near = fbm(fp * vec2(4.2, 9.0) + vec2(-drift * 1.9, 0.0));
  float far = fbm(fp * vec2(2.1, 5.5) + vec2(-drift * 0.85, 4.3));
  // Nang len luy thua: keo phan mong xuong gan 0 va chi giu lai dinh, nen no
  // thanh tung luon thay vi mot mang xam deu phu ca day khung.
  float fog = pow((near * 0.62 + far * 0.38) * band, 1.9);
  // Suong day dan khi dem xuong, va sang len o phia co trang.
  fog *= 0.35 + 0.65 * uT;
  color += vec3(0.40, 0.55, 0.80) * fog * (0.42 + halo * 2.2);

  // Anh sang con sot lai o chan troi.
  //
  // Khong phai trang tri: siluet mau den chi doc duoc khi co cai gi SANG HON
  // ngay sau lung no. Khong co dai nay thi lang den tan vao bau troi den va
  // bien mat hoan toan - dung loi da mac o ban truoc.
  float horizon = smoothstep(0.44, 0.15, vUv.y) * smoothstep(0.01, 0.13, vUv.y);
  color += vec3(0.085, 0.115, 0.200) * horizon * mix(1.0, 0.45, uT);

  // Sat day khung thi toi han, de mat lang co chan de dung.
  color = mix(color, vec3(0.006, 0.009, 0.026), smoothstep(0.10, 0.0, vUv.y) * 0.85);

  // Toi bon goc de mat don vao giua khung.
  float vign = smoothstep(1.15, 0.35, length(vUv - vec2(0.5)));
  gl_FragColor = vec4(color * mix(0.72, 1.0, vign), 1.0);
}
`;

/**
 * Màn đêm buông xuống.
 *
 * Trời, trăng và sương nằm trong một shader phủ khung nhìn; chỉ siluet làng còn
 * là vật thể thật, vì đó là chỗ DUY NHẤT cần chiều sâu hình học.
 *
 * Camera chỉ nhích rất nhẹ: đây là đoạn chuyển cảnh 1,2 giây xem mười lần một
 * ván, không phải một đoạn phim mở đầu.
 */
function buildNightfall(THREE: ThreeModule, scene: Scene3D): BuiltScene {
  const disposables: { dispose(): void }[] = [];

  /*
   * Mặt phẳng phủ kín khung nhìn, vẽ TRƯỚC mọi thứ.
   *
   * `depthTest: false` cộng `renderOrder = -1` nên nó luôn nằm sau, không cần
   * đẩy ra thật xa rồi lo bị far plane cắt. Kích thước tính lại từ frustum
   * trong `update`, nên đổi cỡ cửa sổ giữa cảnh vẫn phủ đủ.
   */
  const skyGeo = new THREE.PlaneGeometry(1, 1);
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uT: { value: 0 },
      uAspect: { value: 1 },
      uMoon: { value: new THREE.Vector2(0.76, 0.62) },
      uMoonR: { value: 0.085 },
    },
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1;
  scene.add(sky);
  disposables.push(skyGeo, skyMat);

  /*
   * Siluet làng - phần DUY NHẤT còn là vật thể thật.
   *
   * Hai hàng ở hai độ sâu, nên camera nhích là chúng trượt khác tốc độ. Hàng xa
   * tô nhạt hơn: phối cảnh khí quyển là tín hiệu chiều sâu mạnh hơn cả thị sai,
   * và nó hoạt động kể cả khi camera đứng yên.
   */
  const nearMat = new THREE.MeshBasicMaterial({ color: 0x010206 });
  /*
   * Hàng xa chỉ nhạt hơn MỘT CHÚT.
   *
   * Bản trước dùng 0x0a1020, và trên nền trời gần như đen ở chân trời thì nó
   * đọc ra mấy tấm bìa xanh nhạt dán phía sau chứ không phải nhà ở xa. Phối
   * cảnh khí quyển ban đêm rất nhẹ - có sương thì vật ở xa mờ đi, không sáng
   * lên thành một màu khác.
   */
  const farMat = new THREE.MeshBasicMaterial({ color: 0x040711 });
  disposables.push(nearMat, farMat);

  /*
   * Bố cục một cái xóm nhìn TỪ XA.
   *
   * Bản trước sai ở TỈ LỆ, và đó mới là thứ làm nó giả chứ không phải hình
   * dáng. Camera fov 50 ở z=6 cho 1 đơn vị thế giới khoảng 119px, nên một nếp
   * nhà rộng 1.3 hiện ra 155px và cao 107px - kích thước của một toà nhà cách
   * hai chục mét, không phải một xóm ở chân trời. Mắt đọc ngay ra là mấy khối
   * hộp to đùng dán vào nền trời.
   *
   * Giờ mỗi nhà rộng 0.4-0.7 đơn vị, tức 50-85px: đủ để thấy mái và ống khói,
   * đủ nhỏ để cả cụm đọc ra một cái xóm. Nhiều khối hơn nhưng nhỏ hơn - đó là
   * cách một đường chân trời có người ở trông ra như vậy.
   *
   * Mái cũng DỐC hơn hẳn: trước kia mái chỉ bằng ~35% thân nên gần như phẳng,
   * và `apex` lệch tới 0.4 làm một bên thoải đến mức thành nóc bằng. Giờ mái
   * bằng 60-90% thân và độ lệch tối đa 0.18.
   */
  const layout: {
    kind: "cottage" | "chapel" | "conifer";
    x: number;
    w: number;
    body: number;
    roof: number;
    apex: number;
    chimney: boolean;
    lift: number;
    far: boolean;
  }[] = [
    { kind: "conifer", x: -5.15, w: 0.42, body: 0.95, roof: 0, apex: 0, chimney: false, lift: -0.03, far: true },
    { kind: "cottage", x: -4.72, w: 0.52, body: 0.30, roof: 0.24, apex: -0.12, chimney: true, lift: 0.02, far: true },
    { kind: "cottage", x: -4.24, w: 0.44, body: 0.38, roof: 0.28, apex: 0.10, chimney: false, lift: -0.01, far: false },
    { kind: "cottage", x: -3.62, w: 0.66, body: 0.34, roof: 0.30, apex: 0.15, chimney: true, lift: 0.03, far: true },
    { kind: "conifer", x: -3.05, w: 0.34, body: 0.72, roof: 0, apex: 0, chimney: false, lift: 0.01, far: false },
    { kind: "cottage", x: -2.55, w: 0.58, body: 0.42, roof: 0.32, apex: -0.16, chimney: false, lift: -0.02, far: false },
    { kind: "cottage", x: -2.02, w: 0.46, body: 0.28, roof: 0.26, apex: 0.08, chimney: true, lift: 0.02, far: true },
    { kind: "chapel", x: -1.28, w: 0.54, body: 0.46, roof: 0, apex: 0, chimney: false, lift: 0.0, far: false },
    { kind: "cottage", x: -0.66, w: 0.62, body: 0.36, roof: 0.30, apex: 0.14, chimney: true, lift: -0.03, far: false },
    { kind: "cottage", x: -0.12, w: 0.44, body: 0.44, roof: 0.26, apex: -0.10, chimney: false, lift: 0.01, far: true },
    { kind: "cottage", x: 0.48, w: 0.70, body: 0.32, roof: 0.34, apex: 0.12, chimney: true, lift: 0.03, far: false },
    { kind: "conifer", x: 1.05, w: 0.38, body: 0.84, roof: 0, apex: 0, chimney: false, lift: -0.01, far: true },
    { kind: "cottage", x: 1.52, w: 0.50, body: 0.40, roof: 0.28, apex: -0.14, chimney: false, lift: 0.02, far: false },
    { kind: "cottage", x: 2.14, w: 0.60, body: 0.30, roof: 0.30, apex: 0.16, chimney: true, lift: -0.02, far: true },
    { kind: "cottage", x: 2.72, w: 0.42, body: 0.46, roof: 0.24, apex: 0.05, chimney: false, lift: 0.01, far: false },
    { kind: "cottage", x: 3.35, w: 0.64, body: 0.34, roof: 0.32, apex: -0.18, chimney: true, lift: 0.03, far: false },
    { kind: "conifer", x: 3.92, w: 0.30, body: 0.64, roof: 0, apex: 0, chimney: false, lift: 0.0, far: true },
    { kind: "cottage", x: 4.32, w: 0.54, body: 0.38, roof: 0.28, apex: 0.10, chimney: false, lift: -0.02, far: true },
    { kind: "conifer", x: 4.95, w: 0.46, body: 1.05, roof: 0, apex: 0, chimney: false, lift: 0.02, far: true },
  ];

  const BASE_Y = -2.35;

  const houses = layout.map((item) => {
    const geo =
      item.kind === "chapel"
        ? chapelShape(THREE, item.w, item.body, 0.92)
        : item.kind === "conifer"
          ? coniferShape(THREE, item.w, item.body)
          : cottageShape(THREE, item.w, item.body, item.roof, item.apex, item.chimney);
    const mesh = new THREE.Mesh(geo, item.far ? farMat : nearMat);
    /*
     * KHÔNG có animation cho làng.
     *
     * Bản trước cho nhà trượt lên vào vị trí, và trước nữa là giãn `scale.y`.
     * Cả hai đều sai cùng một kiểu: một cái xóm không di chuyển. Nó đứng đó từ
     * trước khi đêm xuống, và thứ thay đổi trong 1,2 giây này là ÁNH SÁNG với
     * SƯƠNG, không phải nhà cửa. Đặt đúng chỗ một lần rồi để yên.
     */
    mesh.position.set(item.x, BASE_Y + item.lift, item.far ? -2.2 : -0.5);
    scene.add(mesh);
    disposables.push(geo);
    return mesh;
  });
  // `houses` chỉ giữ để dispose; không có gì phải cập nhật mỗi khung hình.
  void houses;

  return {
    update(t, camera) {
      const eased = easeOutCubic(t);

      // Mặt phẳng trời phải phủ đúng frustum ở khoảng cách của nó.
      const distance = camera.position.z - sky.position.z;
      const height = 2 * Math.tan(((camera.fov * Math.PI) / 180) / 2) * distance;
      sky.scale.set(height * camera.aspect * 1.02, height * 1.02, 1);

      skyMat.uniforms.uT.value = t;
      skyMat.uniforms.uAspect.value = camera.aspect;
      // Trăng mọc theo easing, không phải vận tốc hằng.
      skyMat.uniforms.uMoon.value.set(0.76, 0.62 + eased * 0.11);

      /*
       * Camera chỉ TỊNH TIẾN, không `lookAt`.
       *
       * Bản đầu gọi `lookAt(0,0,0)` trong khi dời `position.x`, nên cả cảnh xoay
       * nhẹ - mắt đọc ra là rung máy chứ không phải chiều sâu. Thị sai thật đến
       * từ tịnh tiến thuần: hai hàng nhà ở hai độ sâu trượt khác tốc độ.
       */
      camera.position.x = -0.22 * eased;
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
