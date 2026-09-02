import type { DiscussionSkipView } from "@masoi/shared";

/**
 * Câu chữ của khối "bỏ qua thảo luận".
 *
 * Tách khỏi component vì đây là phần DUY NHẤT của khối đó có luật: ba trạng
 * thái (chưa đồng ý / đã đồng ý / chỉ ngồi xem) và ba câu khác nhau, trong khi
 * phần dựng hình chỉ là một cái nút với một dòng chữ. Ở trong JSX thì ba câu đó
 * nằm trong hai tầng toán tử ba ngôi và không có cách nào kiểm được, mà web
 * không có test cho component.
 *
 * KHÔNG đụng tới luật đếm: `votes`/`required`/`canVote`/`hasVoted` đi thẳng từ
 * snapshot ra chữ, không có ngưỡng nào được tính lại ở đây.
 */
export interface DiscussionSkipCopy {
  /**
   * Nhãn nút. null khi người xem không được bỏ phiếu (đã chết, hoặc là bot) -
   * lúc đó chỉ còn `status`.
   */
  button: string | null;
  /** Trạng thái hiện tại, đứng cạnh hoặc thay cho nút. null khi chưa có gì để nói. */
  status: string | null;
  /** Điều kiện để cả làng bỏ qua được. Luôn có mặt khi khối này hiển thị. */
  hint: string;
}

/**
 * Điều kiện bỏ qua, viết một lần.
 *
 * "Người chơi thật" là cách phân biệt với bot: bot không bỏ phiếu bỏ qua, nên
 * mẫu số không bao giờ tính chúng.
 */
export const SKIP_CONDITION_HINT =
  "Cần tất cả người chơi thật còn sống và đang online đồng ý.";

export function discussionSkipCopy(view: DiscussionSkipView): DiscussionSkipCopy {
  const tally = `${view.votes}/${view.required}`;

  if (!view.canVote) {
    return {
      button: null,
      // "Bỏ qua" chứ không phải "skip": cả khối đã bỏ hẳn tiếng Anh, và một
      // dòng trạng thái dùng từ khác với cái nút ngay trên nó đọc ra như hai
      // cơ chế rời nhau.
      status: `Người chơi còn sống muốn bỏ qua thảo luận · ${tally}`,
      hint: SKIP_CONDITION_HINT,
    };
  }

  if (view.hasVoted) {
    /*
     * Đã đồng ý thì nút đổi việc: nó không còn là "bỏ qua" nữa mà là "rút lại".
     * Nhãn nút phải nói ĐỘNG TÁC sắp xảy ra khi bấm, còn tình trạng hiện tại thì
     * dòng status nói - gộp cả hai vào một cái nút là để người chơi tự đoán bấm
     * vào nó thì được thêm một phiếu hay mất phiếu vừa bỏ.
     */
    return {
      button: "Hủy đồng ý bỏ qua",
      status: `Bạn đã đồng ý bỏ qua · ${tally}`,
      hint: SKIP_CONDITION_HINT,
    };
  }

  return {
    button: `Bỏ qua thảo luận · ${tally}`,
    status: null,
    hint: SKIP_CONDITION_HINT,
  };
}
