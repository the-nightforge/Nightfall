/**
 * Bộ điều phối việc mở/đóng mic thật.
 *
 * Tách hẳn khỏi React để kiểm chứng được bằng node:test. Chính cơ chế này từng
 * hỏng trên production ngày 2026-08-30: nó nằm trong một `useEffect` có
 * dependency là cả `state`, và dùng cờ `cancelled` trong cleanup - nên mọi
 * dispatch không liên quan (`speakers_changed`, `audio_playback_ok`) đều nuốt
 * mất kết quả của lời gọi đang chạy dở, và nút giữ-để-nói ở lại màu xám dù mic
 * đã mở thật.
 *
 * Hai bất biến mà file này tồn tại để bảo vệ:
 *
 *  1. Kết quả của `setMic` LUÔN được báo về. Không có đường nào huỷ nó.
 *  2. Cờ bận được nhả TRƯỚC khi báo kết quả, vì việc báo kết quả sẽ kéo theo
 *     một vòng đối chiếu mới - cờ còn bật lúc đó thì vòng ấy thoát sớm rồi
 *     không còn gì đánh thức nó nữa.
 */

export interface MicSyncDeps {
  setMic(on: boolean): Promise<void>;
  /** Mic đã thực sự chuyển sang trạng thái này. */
  onResult(open: boolean): void;
  /**
   * @param wanted hướng của lời gọi vừa hỏng - mở (`true`) hay đóng (`false`)
   *
   * Hướng đi kèm lỗi vì hai hướng có hai mức nghiêm trọng khác hẳn: mở hỏng thì
   * hậu quả là im lặng, đóng hỏng thì mic có thể vẫn đang phát. Tầng trên không
   * suy ra được điều này từ trạng thái, vì trạng thái đã đổi trong lúc chờ.
   */
  onError(error: unknown, wanted: boolean): void;
}

export interface MicSync {
  /** Đưa mic thật về đúng thứ máy trạng thái nói là NÊN mở. */
  reconcile(want: boolean, isOpen: boolean): void;
  readonly busy: boolean;
}

export function createMicSync(deps: MicSyncDeps): MicSync {
  let busy = false;

  return {
    reconcile(want, isOpen) {
      // Đã đúng rồi, hoặc đang có một lời gọi chạy dở: lời gọi đó khi xong sẽ
      // báo kết quả, và việc báo kết quả tự kéo theo một vòng đối chiếu mới.
      if (want === isOpen || busy) return;
      busy = true;
      void deps
        .setMic(want)
        .then(() => {
          busy = false;
          deps.onResult(want);
        })
        .catch((error: unknown) => {
          // Thiếu nhánh này thì mic hỏng là im lặng tuyệt đối: nút xám, không
          // lỗi, không cách nào biết chuyện gì đang xảy ra.
          busy = false;
          deps.onError(error, want);
        });
    },
    get busy() {
      return busy;
    },
  };
}
