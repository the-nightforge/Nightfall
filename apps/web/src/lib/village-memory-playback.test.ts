import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTRO_DURATION_MS,
  INTRO_POSITION,
  STEP_DURATION_MS,
  atFirstPosition,
  atLastPosition,
  autoplayEnabled,
  cameraGlide,
  clampPosition,
  durationFor,
  frameLoopRuns,
  isIntro,
  playbackTick,
  positionAfter,
  progressAnnouncement,
  progressLabel,
  rendererState,
  stepAt,
} from "./village-memory-playback";

const STEPS = ["một", "hai", "ba"] as const;

describe("cảnh mở đầu", () => {
  it("vị trí đầu tiên là mở đầu, không phải bước ngoặt số 0", () => {
    assert.equal(INTRO_POSITION, -1);
    assert.equal(isIntro(INTRO_POSITION), true);
    assert.equal(isIntro(0), false);
  });

  it("ở mở đầu thì KHÔNG có bước nào để chiếu", () => {
    // Đây là hợp đồng với `VillageMemoryCanvas`: `step === null` là cảnh toàn
    // cảnh, và trước bản sửa này không có đường nào đi tới trạng thái đó.
    assert.equal(stepAt(STEPS, INTRO_POSITION), null);
    assert.equal(stepAt(STEPS, 0), "một");
    assert.equal(stepAt(STEPS, 2), "ba");
  });

  it("vượt quá cuối mảng vẫn trả null chứ không undefined", () => {
    assert.equal(stepAt(STEPS, 9), null);
    assert.equal(stepAt([], 0), null);
  });

  it("mở đầu giữ màn hình ngắn hơn một bước ngoặt", () => {
    assert.equal(durationFor(INTRO_POSITION), INTRO_DURATION_MS);
    assert.equal(durationFor(0), STEP_DURATION_MS);
    assert.ok(INTRO_DURATION_MS < STEP_DURATION_MS);
    assert.equal(INTRO_DURATION_MS, 3000);
  });
});

describe("clampPosition", () => {
  it("kẹp vào dải có cả ô mở đầu", () => {
    assert.equal(clampPosition(-9, 3), INTRO_POSITION);
    assert.equal(clampPosition(9, 3), 2);
    assert.equal(clampPosition(1, 3), 1);
  });

  it("không có bước nào thì chỉ còn mở đầu", () => {
    assert.equal(clampPosition(0, 0), INTRO_POSITION);
    assert.equal(clampPosition(4, 0), INTRO_POSITION);
  });

  it("giá trị vô lý không làm vỡ", () => {
    assert.equal(clampPosition(Number.NaN, 3), INTRO_POSITION);
  });
});

describe("positionAfter", () => {
  it("Tiếp đi từ mở đầu sang bước 1", () => {
    assert.equal(positionAfter(INTRO_POSITION, 3, 1), 0);
  });

  it("Trước từ bước 1 quay lại mở đầu", () => {
    assert.equal(positionAfter(0, 3, -1), INTRO_POSITION);
  });

  it("hai biên đều đứng yên, không quay vòng", () => {
    assert.equal(positionAfter(INTRO_POSITION, 3, -1), INTRO_POSITION);
    assert.equal(positionAfter(2, 3, 1), 2);
  });

  it("đi qua lại giữa mở đầu và bước 1 vẫn ổn định", () => {
    let position = INTRO_POSITION;
    position = positionAfter(position, 3, 1);
    position = positionAfter(position, 3, -1);
    position = positionAfter(position, 3, 1);
    assert.equal(position, 0);
  });
});

describe("atFirstPosition / atLastPosition", () => {
  it("nút Trước chỉ tắt ở đúng cảnh mở đầu", () => {
    assert.equal(atFirstPosition(INTRO_POSITION), true);
    assert.equal(atFirstPosition(0), false);
    assert.equal(atFirstPosition(2), false);
  });

  it("nút Tiếp chỉ tắt ở bước cuối", () => {
    assert.equal(atLastPosition(INTRO_POSITION, 3), false);
    assert.equal(atLastPosition(1, 3), false);
    assert.equal(atLastPosition(2, 3), true);
  });

  it("ván một bước: mở đầu vẫn đi tiếp được", () => {
    assert.equal(atLastPosition(INTRO_POSITION, 1), false);
    assert.equal(atLastPosition(0, 1), true);
  });
});

describe("playbackTick", () => {
  it("tự phát đi mở đầu → bước 1 → các bước sau", () => {
    let state = { position: INTRO_POSITION, playing: true };
    state = playbackTick(state, 3);
    assert.deepEqual(state, { position: 0, playing: true });
    state = playbackTick(state, 3);
    assert.deepEqual(state, { position: 1, playing: true });
    state = playbackTick(state, 3);
    assert.deepEqual(state, { position: 2, playing: true });
  });

  it("tới bước cuối thì dừng chứ không quay về mở đầu", () => {
    assert.deepEqual(playbackTick({ position: 2, playing: true }, 3), {
      position: 2,
      playing: false,
    });
  });

  it("đang tạm dừng thì nhịp không đẩy vị trí, kể cả ở mở đầu", () => {
    assert.deepEqual(playbackTick({ position: INTRO_POSITION, playing: false }, 3), {
      position: INTRO_POSITION,
      playing: false,
    });
    assert.deepEqual(playbackTick({ position: 1, playing: false }, 3), {
      position: 1,
      playing: false,
    });
  });

  it("chạy trọn một ván ba bước thì dừng đúng một lần", () => {
    let state = { position: INTRO_POSITION, playing: true };
    const seen: number[] = [];
    for (let guard = 0; guard < 20 && state.playing; guard += 1) {
      state = playbackTick(state, 3);
      seen.push(state.position);
    }
    assert.deepEqual(seen, [0, 1, 2, 2]);
    assert.equal(state.playing, false);
  });

  it("mỗi bước kéo dài trong khoảng 4-6 giây", () => {
    assert.ok(STEP_DURATION_MS >= 4000 && STEP_DURATION_MS <= 6000, String(STEP_DURATION_MS));
  });
});

describe("progressLabel", () => {
  it('mở đầu là "Mở đầu", không phải "0/N"', () => {
    assert.equal(progressLabel(INTRO_POSITION, 5), "Mở đầu");
  });

  it("bước thật đếm từ 1 cho người đọc", () => {
    assert.equal(progressLabel(0, 5), "1/5");
    assert.equal(progressLabel(4, 5), "5/5");
  });

  it("không có bước nào thì không hứa hão một tổng số", () => {
    assert.equal(progressLabel(INTRO_POSITION, 0), "Mở đầu");
  });
});

describe("progressAnnouncement", () => {
  it('nói thành câu, vì "2/5" đọc lên là "hai gạch chéo năm"', () => {
    assert.equal(progressAnnouncement(INTRO_POSITION, 5), "Cảnh mở đầu");
    assert.equal(progressAnnouncement(1, 5), "Bước 2 trên 5");
  });
});

describe("giảm chuyển động", () => {
  it("tắt tự phát và tắt luôn cú lia camera", () => {
    assert.equal(autoplayEnabled(true), false);
    assert.equal(cameraGlide(true), false);
  });

  it("bình thường thì cả hai bật", () => {
    assert.equal(autoplayEnabled(false), true);
    assert.equal(cameraGlide(false), true);
  });

  it("giảm chuyển động thì cảnh mở đầu ĐỨNG YÊN cho tới khi người xem bấm Tiếp", () => {
    // Không tự phát nghĩa là không có nhịp nào chạy; vị trí chỉ đổi khi có một
    // cú bấm, và lúc đó nó vẫn đi đúng đường mở đầu → bước 1.
    const start = { position: INTRO_POSITION, playing: autoplayEnabled(true) };
    assert.deepEqual(playbackTick(start, 3), start);
    assert.equal(positionAfter(start.position, 3, 1), 0);
  });
});

describe("rendererState", () => {
  const open = { open: true, webgl2: true, failed: false, contextLost: false };

  it("chưa mở thì KHÔNG dựng renderer nào", () => {
    assert.equal(rendererState({ ...open, open: false }), "idle");
  });

  it("mở và máy đủ điều kiện thì dựng 3D", () => {
    assert.equal(rendererState(open), "webgl");
  });

  it("không có WebGL2 thì rơi thẳng về bản 2D, không thử dựng", () => {
    assert.equal(rendererState({ ...open, webgl2: false }), "fallback");
  });

  it("dựng hỏng thì về bản 2D và không thử lại", () => {
    assert.equal(rendererState({ ...open, failed: true }), "fallback");
  });

  it("mất context thì về bản 2D chứ không phải màn đen", () => {
    assert.equal(rendererState({ ...open, contextLost: true }), "fallback");
  });

  it("đóng lại thì về idle dù trước đó đã hỏng", () => {
    assert.equal(
      rendererState({ open: false, webgl2: true, failed: true, contextLost: true }),
      "idle",
    );
  });
});

describe("frameLoopRuns", () => {
  const live = { mode: "webgl" as const, hidden: false };

  it("chỉ chạy khi dialog mở và đang ở chế độ 3D", () => {
    assert.equal(frameLoopRuns(live), true);
    assert.equal(frameLoopRuns({ ...live, mode: "idle" }), false);
    assert.equal(frameLoopRuns({ ...live, mode: "fallback" }), false);
  });

  it("tab bị ẩn thì dừng vòng vẽ", () => {
    assert.equal(frameLoopRuns({ ...live, hidden: true }), false);
  });
});
