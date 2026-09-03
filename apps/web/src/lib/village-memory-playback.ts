/**
 * Phần LOGIC của trình phát "Hồi ức Ngôi Làng".
 *
 * Tách khỏi component vì đúng lý do mà `last-letter.ts` đã tách: bộ test của
 * web chạy bằng `node:test` trên `src/lib/*.test.ts`, không có DOM và không
 * render React. Cái gì phải khẳng định được thì phải sống ở đây - kể cả những
 * quyết định về VÒNG ĐỜI renderer, vốn là chỗ dễ sai nhất và khó thấy nhất.
 *
 * Mọi hàm trong file này đều thuần: cùng đầu vào cho cùng đầu ra, không đọc
 * `window`, không đọc đồng hồ.
 */

/**
 * Thời lượng một bước khi tự phát.
 *
 * 5 giây nằm giữa dải 4-6 của thiết kế: đủ để một hiệu ứng diễn trọn và mắt đọc
 * hết hai dòng chú thích, chưa đủ lâu để người xem thấy mình đang chờ. Người
 * dùng luôn cắt ngang được bằng Trước/Tiếp/Tạm dừng, nên con số này là nhịp
 * mặc định chứ không phải một cái khoá.
 */
export const STEP_DURATION_MS = 5000;

/**
 * Thời lượng cảnh mở đầu.
 *
 * Ngắn hơn hẳn một bước ngoặt vì nó không kể chuyện gì cả - nó chỉ đặt người
 * xem xuống trước ngôi làng và nói đây là ván nào. Ba giây là đủ để đọc một
 * dòng và nhận ra bố cục; lâu hơn thì thành một màn chờ trước nội dung thật.
 */
export const INTRO_DURATION_MS = 3000;

/**
 * Vị trí trong trải nghiệm: `-1` là CẢNH MỞ ĐẦU, `0..count-1` là các bước ngoặt.
 *
 * Một con số duy nhất chứ không phải `{ kind: "intro" } | { kind: "step" }`, và
 * đó là lựa chọn có lý do: mọi phép toán của trình phát - tiến, lùi, kẹp biên,
 * so với bước cuối - là số học trên một trục có thứ tự, và một union sẽ bắt mỗi
 * phép đó tự mở hộp rồi tự đóng lại. Đổi lại, con số `-1` KHÔNG được rải ra
 * component: mọi câu hỏi về nó đều có một hàm trong file này trả lời.
 */
export const INTRO_POSITION = -1;

export function isIntro(position: number): boolean {
  return position <= INTRO_POSITION;
}

/**
 * Kẹp vị trí vào dải hợp lệ, tính cả ô mở đầu.
 *
 * Không có bước nào thì chỉ còn mở đầu để mà đứng - và `VillageMemoryExperience`
 * vốn không vẽ gì cả trong trường hợp đó, nên đây chỉ là lưới an toàn.
 */
export function clampPosition(position: number, count: number): number {
  if (count <= 0) return INTRO_POSITION;
  if (!Number.isFinite(position)) return INTRO_POSITION;
  return Math.min(Math.max(Math.trunc(position), INTRO_POSITION), count - 1);
}

/**
 * Vị trí kế tiếp khi bấm Trước/Tiếp.
 *
 * KHÔNG quay vòng, và ranh giới mở đầu là một biên thật: từ bước 1 bấm Trước là
 * về lại toàn cảnh, còn ở toàn cảnh bấm Trước thì đứng yên. Ở hai đầu nút tự
 * tắt (`disabled`), nên hàm này là lưới thứ hai.
 */
export function positionAfter(position: number, count: number, delta: number): number {
  return clampPosition(position + delta, count);
}

/** Bước đang chiếu, hoặc `null` ở cảnh mở đầu. */
export function stepAt<T>(steps: readonly T[], position: number): T | null {
  if (isIntro(position)) return null;
  return steps[position] ?? null;
}

/** Vị trí này giữ màn hình bao lâu khi tự phát. */
export function durationFor(position: number): number {
  return isIntro(position) ? INTRO_DURATION_MS : STEP_DURATION_MS;
}

/** Đang ở đầu trải nghiệm: nút Trước phải tắt. */
export function atFirstPosition(position: number): boolean {
  return isIntro(position);
}

/** Đang ở bước cuối: nút Tiếp phải tắt, và tự phát dừng tại đây. */
export function atLastPosition(position: number, count: number): boolean {
  if (count <= 0) return true;
  return position >= count - 1;
}

export interface PlaybackState {
  position: number;
  playing: boolean;
}

/**
 * Một nhịp tự phát.
 *
 * Mở đầu chạy tiếp sang bước 1 y như mọi vị trí khác - nó là một ô trên cùng
 * trục, không phải một pha đặc biệt cần nhánh riêng. Tới bước cuối thì DỪNG chứ
 * không phát lại từ đầu: hết hồi ức là hết, và một vòng lặp vô tận sẽ giữ vòng
 * vẽ WebGL sống mãi trên màn kết thúc ván.
 */
export function playbackTick(state: PlaybackState, count: number): PlaybackState {
  if (!state.playing) return state;
  if (count <= 0) return { position: INTRO_POSITION, playing: false };
  const next = state.position + 1;
  if (next >= count) return { position: clampPosition(state.position, count), playing: false };
  return { position: next, playing: true };
}

/**
 * Nhãn tiến độ.
 *
 * Mở đầu là "Mở đầu", KHÔNG phải "0/5": số 0 nói rằng người xem đang ở bước thứ
 * không trong năm bước, tức là một bước có thật mà chưa bắt đầu - trong khi
 * cảnh mở đầu không phải một bước ngoặt và không nằm trong tổng số đó.
 */
export function progressLabel(position: number, count: number): string {
  if (count <= 0) return "Mở đầu";
  if (isIntro(position)) return "Mở đầu";
  return `${clampPosition(position, count) + 1}/${count}`;
}

/**
 * Cùng nội dung, viết cho tai nghe.
 *
 * "2/5" đọc lên thành "hai gạch chéo năm". Nhãn nhìn thấy giữ nguyên vẻ gọn của
 * nó, còn `aria-label` nói thành câu.
 */
export function progressAnnouncement(position: number, count: number): string {
  if (count <= 0 || isIntro(position)) return "Cảnh mở đầu";
  return `Bước ${clampPosition(position, count) + 1} trên ${count}`;
}

/**
 * Có tự phát không.
 *
 * Giảm chuyển động thì KHÔNG. Một trải nghiệm tự chạy qua năm cảnh là đúng thứ
 * mà cờ đó dựng ra để chặn, và người xem vẫn đi hết được từng bước bằng
 * Trước/Tiếp - tức là không mất gì ngoài phần tự động.
 */
export function autoplayEnabled(reducedMotion: boolean): boolean {
  return !reducedMotion;
}

/**
 * Camera có LIA giữa hai bước không, hay nhảy thẳng tới nơi.
 *
 * Tách khỏi `autoplayEnabled` vì hai câu hỏi khác nhau: người bật giảm chuyển
 * động vẫn bấm Tiếp được, và lúc đó camera phải có mặt ở cảnh mới ngay lập tức
 * thay vì trôi qua nửa ngôi làng.
 */
export function cameraGlide(reducedMotion: boolean): boolean {
  return !reducedMotion;
}

/** "idle" là chưa có renderer nào tồn tại - không phải một renderer đang nghỉ. */
export type RendererState = "idle" | "webgl" | "fallback";

export interface RendererInputs {
  /** Dialog đang mở. Đóng lại là mọi thứ về `idle`, kể cả khi trước đó đã hỏng. */
  open: boolean;
  webgl2: boolean;
  /** Dựng renderer hoặc tải three.js đã thất bại một lần. */
  failed: boolean;
  contextLost: boolean;
}

/**
 * Có dựng WebGL không, hay vẽ bản 2D.
 *
 * Ba lý do rơi về bản 2D được gộp thành MỘT trạng thái vì người xem chỉ cần
 * biết một điều: nội dung vẫn đọc được. Không có màn đen, và không có nhánh nào
 * thử dựng lại - `failed` và `contextLost` là cờ MỘT CHIỀU trong một lần mở.
 * Máy vừa hết bộ nhớ đồ hoạ thì thử lại chỉ làm nó hết lần nữa.
 *
 * `open: false` trả `idle` và đây là điều kiện nặng nhất của cả tính năng: ở
 * màn GAME_OVER chưa ai bấm nút thì không có context WebGL nào tồn tại.
 */
export function rendererState(inputs: RendererInputs): RendererState {
  if (!inputs.open) return "idle";
  if (!inputs.webgl2 || inputs.failed || inputs.contextLost) return "fallback";
  return "webgl";
}

/**
 * Vòng `requestAnimationFrame` có được chạy không.
 *
 * Tab bị ẩn thì dừng: trình duyệt đã bóp `rAF` xuống rất thấp ở tab nền, nhưng
 * "rất thấp" không phải là không, và một vòng vẽ WebGL còn sống trong tab nền
 * vẫn giữ nguyên bộ nhớ GPU lẫn context. Bản 2D thì không có gì để vẽ.
 */
export function frameLoopRuns(inputs: { mode: RendererState; hidden: boolean }): boolean {
  return inputs.mode === "webgl" && !inputs.hidden;
}
