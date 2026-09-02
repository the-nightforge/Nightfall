import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscussionSkipView } from "@masoi/shared";
import { SKIP_CONDITION_HINT, discussionSkipCopy } from "./discussion-skip-copy";

const view = (patch: Partial<DiscussionSkipView> = {}): DiscussionSkipView => ({
  votes: 0,
  required: 1,
  hasVoted: false,
  canVote: true,
  ...patch,
});

describe("discussionSkipCopy", () => {
  it("chưa đồng ý: nút mời bỏ qua và mang luôn tỉ số", () => {
    const copy = discussionSkipCopy(view({ votes: 0, required: 1 }));

    assert.equal(copy.button, "Bỏ qua thảo luận · 0/1");
    // Chưa bấm gì thì không có trạng thái nào để nói - một dòng "0/1" đứng
    // riêng ở trên chỉ lặp lại con số đã nằm trên nút.
    assert.equal(copy.status, null);
    assert.equal(copy.hint, SKIP_CONDITION_HINT);
  });

  it("đã đồng ý: nút đổi thành hành động HỦY, tình trạng nói ở dòng riêng", () => {
    const copy = discussionSkipCopy(view({ votes: 1, required: 1, hasVoted: true }));

    assert.equal(copy.status, "Bạn đã đồng ý bỏ qua · 1/1");
    assert.equal(copy.button, "Hủy đồng ý bỏ qua");
  });

  it("không được bỏ phiếu thì chỉ còn dòng đếm, không có nút", () => {
    const copy = discussionSkipCopy(view({ votes: 2, required: 4, canVote: false }));

    assert.equal(copy.button, null);
    assert.equal(copy.status, "Người chơi còn sống muốn bỏ qua thảo luận · 2/4");
  });

  it("không còn chữ 'skip' trong bất kỳ trạng thái nào", () => {
    // Cả khối đã bỏ hẳn tiếng Anh; một chữ sót lại là một chỗ nữa để người chơi
    // tưởng nút này và dòng đếm là hai cơ chế khác nhau.
    for (const v of [
      view(),
      view({ hasVoted: true, votes: 1 }),
      view({ canVote: false, votes: 1, required: 3 }),
    ]) {
      const copy = discussionSkipCopy(v);
      const text = `${copy.button ?? ""} ${copy.status ?? ""} ${copy.hint}`;
      assert.doesNotMatch(text, /skip/i);
    }
  });

  it("điều kiện bỏ qua nói rõ ba vế: người thật, còn sống, đang online", () => {
    assert.match(SKIP_CONDITION_HINT, /người chơi thật/);
    assert.match(SKIP_CONDITION_HINT, /còn sống/);
    assert.match(SKIP_CONDITION_HINT, /online/);
  });

  it("tỉ số đi thẳng từ snapshot ra chữ, không tính lại ngưỡng nào", () => {
    assert.equal(discussionSkipCopy(view({ votes: 3, required: 5 })).button, "Bỏ qua thảo luận · 3/5");
  });
});
