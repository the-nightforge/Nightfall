import type { TrialStageBeat } from "./live-trial";
import type { TrialBeatOptions, TrialSceneState } from "./live-trial-scene";

/**
 * Ai được nói chuyện với cảnh 3D, và theo thứ tự nào.
 *
 * Tách khỏi `TrialStageCanvas` vì lỗi mà nó dựng ra để chặn chỉ hiện ra khi
 * `import()` động về CHẬM - một điều kiện không dựng lại được trong `node:test`
 * nếu logic còn nằm trong một effect của React:
 *
 *   1. Pha biện hộ mở ra, sinh nhịp `OPENING`. `three` chưa tải xong nên nhịp
 *      ấy nằm chờ.
 *   2. Ván sang vòng bỏ phiếu xác nhận. Lô nhịp diễn mới rỗng, nên không có gì
 *      ghi đè lô đang chờ.
 *   3. `three` tải xong. Bản cũ áp trạng thái FINAL_VOTE trước, rồi chạy nốt lô
 *      đang chờ - và `playOpening` kéo camera lẫn `currentAct` ngược về DEFENSE.
 *      Người chơi đang phải bấm Treo/Tha thì nhìn thấy cảnh biện hộ.
 *
 * Mốc thời gian cũ KHÔNG chữa được: một hiệu ứng đã hết hạn vẫn ghi đè trạng
 * thái của cảnh, vì `playOpening` đặt lại đích camera chứ không chỉ vẽ một
 * khung hình. Cái chữa được là hỏi "lô này còn nói về đúng chặng và đúng phiên
 * toà đang diễn không" - và câu trả lời phải là KHÔNG thì bỏ hẳn, không xếp
 * hàng chờ phát bù.
 *
 * Luật của cả file, một câu: TRẠNG THÁI MỚI NHẤT LUÔN THẮNG.
 */

/** Vừa đủ hình dạng của `TrialSceneHandle`, để test dựng bản giả bằng vài dòng. */
export interface StageHandleLike {
  setState(state: TrialSceneState, options: TrialBeatOptions): void;
  playOpening(options: TrialBeatOptions): void;
  playStamp(side: "guilty" | "innocent", options: TrialBeatOptions): void;
  playVerdict(verdict: "LYNCHED" | "SPARED", options: TrialBeatOptions): void;
}

interface PendingBatch {
  beats: TrialStageBeat[];
  /** Chặng mà lô này nói về. Không khớp chặng hiện tại thì lô đã lỗi thời. */
  act: TrialSceneState["act"];
  /** Phiên toà mà lô này thuộc về. Xem `TrialStageView.key`. */
  sessionKey: string;
  /** `performance.now()` lúc lô tới, giữ nguyên khi diễn muộn. */
  atMs: number;
}

export interface StageDirector {
  /** Trạng thái mới nhất từ React. Áp ngay nếu cảnh đã sẵn sàng. */
  update(state: TrialSceneState, sessionKey: string, options: TrialBeatOptions): void;
  /** Một lô nhịp diễn vừa tới. */
  play(beats: TrialStageBeat[], sessionKey: string, options: TrialBeatOptions): void;
  /** Cảnh vừa dựng xong. */
  ready(handle: StageHandleLike, atMs: number): void;
  /** Cảnh bị tháo - hết phiên, tắt tính năng, mất context, hay unmount. */
  release(): void;
  /** Chỉ dùng trong test: lô đang chờ, hoặc null. */
  peekPending(): PendingBatch | null;
}

export function createStageDirector(): StageDirector {
  let handle: StageHandleLike | null = null;
  let pending: PendingBatch | null = null;
  let latest: { state: TrialSceneState; sessionKey: string; reduced: boolean } | null = null;

  /** Lô còn nói đúng chuyện đang diễn không. */
  const stillRelevant = (batch: PendingBatch): boolean =>
    latest !== null && batch.act === latest.state.act && batch.sessionKey === latest.sessionKey;

  function run(batch: PendingBatch, target: StageHandleLike, reduced: boolean): void {
    for (const beat of batch.beats) {
      /*
       * `atMs` GỐC, không phải lúc diễn.
       *
       * Một lô tới trễ vài giây thì mọi hiệu ứng của nó tự ở trạng thái kết
       * thúc ngay khung hình đầu, thay vì nhảy ra giữa màn để kể một chuyện đã
       * xong. Đây là lớp thứ hai; lớp thứ nhất là `stillRelevant` ở trên.
       */
      const options: TrialBeatOptions = { reduced, atMs: batch.atMs };
      if (beat.kind === "OPENING") target.playOpening(options);
      else if (beat.kind === "STAMP") target.playStamp(beat.side, options);
      else target.playVerdict(beat.verdict, options);
    }
  }

  return {
    update(state, sessionKey, options) {
      latest = { state, sessionKey, reduced: options.reduced };
      // Đổi chặng hoặc đổi phiên là lô đang chờ hết giá trị NGAY, không đợi tới
      // lúc cảnh sẵn sàng mới xét: giữ nó lại chỉ tạo ra một hàng đợi phát bù.
      if (pending && !stillRelevant(pending)) pending = null;
      handle?.setState(state, options);
    },

    play(beats, sessionKey, options) {
      if (beats.length === 0) return;
      const batch: PendingBatch = {
        beats,
        act: latest?.state.act ?? "DEFENSE",
        sessionKey,
        atMs: options.atMs,
      };
      // Cảnh đã sẵn sàng thì diễn ngay - lô lúc này luôn là chuyện đang xảy ra.
      if (handle) {
        run(batch, handle, options.reduced);
        return;
      }
      // Chưa sẵn sàng thì giữ ĐÚNG MỘT lô, lô mới đè lô cũ. Xếp hàng nhiều lô
      // nghĩa là khi cảnh hiện ra, người chơi phải xem lại cả một xâu chuyện đã
      // qua trong lúc bảng số đã đứng yên từ lâu.
      pending = batch;
    },

    ready(next, atMs) {
      handle = next;
      // Trạng thái TRƯỚC, nhịp diễn sau: khung hình đầu tiên phải là chặng đang
      // diễn, kể cả khi lô đang chờ bị bỏ ngay sau đó.
      if (latest) next.setState(latest.state, { reduced: latest.reduced, atMs });
      const batch = pending;
      pending = null;
      if (batch && stillRelevant(batch)) run(batch, next, latest?.reduced ?? false);
    },

    release() {
      handle = null;
      pending = null;
    },

    peekPending() {
      return pending;
    },
  };
}
