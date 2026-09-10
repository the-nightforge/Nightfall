import { describe, expect, it } from "vitest";
import {
  createQuestionLedger,
  markBlocked,
  markObserved,
  markSpeechTurn,
  markSpoke,
  openQuestion,
  settleQuestions,
  type QuestionLedgerState,
} from "../src/bot/evaluation/question-ledger";

const ALWAYS = (): boolean => true;
const Q = { messageId: "m1", askerId: "a", targetId: "t", round: 2 };
const SEEN = [{ id: "m1" }];
const PARSED = [{ sourceId: "m1", targetId: "t" }];

function asked(extra: Partial<Parameters<typeof openQuestion>[1]> = {}): QuestionLedgerState {
  const ledger = createQuestionLedger();
  openQuestion(ledger, { ...Q, ...extra });
  return ledger;
}

const outcomeOf = (ledger: QuestionLedgerState) => settleQuestions(ledger)[0]!.outcome;

describe("question-ledger — bảy ngăn", () => {
  it("đáp đúng câu hỏi: ANSWERED", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    markSpeechTurn(l, "t", ALWAYS);
    markSpoke(l, "t", "m1", ALWAYS);
    expect(outcomeOf(l)).toBe("ANSWERED");
  });

  it("câu đáp bị phòng chặn: BLOCKED_ROOM", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    markBlocked(l, "m1", "t", "REPLIES_PER_MESSAGE");
    expect(outcomeOf(l)).toBe("BLOCKED_ROOM");
  });

  it("người bị hỏi chưa quan sát lần nào: UNDETERMINED", () => {
    expect(outcomeOf(asked())).toBe("UNDETERMINED");
  });

  it("thấy câu mà parser không đọc ra: NOT_PARSED", () => {
    const l = asked();
    markObserved(l, "t", SEEN, []);
    expect(outcomeOf(l)).toBe("NOT_PARSED");
  });

  it("đọc ra nhưng không được lượt: NO_TURN", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    expect(outcomeOf(l)).toBe("NO_TURN");
  });

  it("có lượt, nói chuyện khác: DECLINED_SPOKE_OTHER", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    markSpeechTurn(l, "t", ALWAYS);
    markSpoke(l, "t", "m9", ALWAYS);
    expect(outcomeOf(l)).toBe("DECLINED_SPOKE_OTHER");
  });

  it("có lượt, im: DECLINED_SILENT", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    markSpeechTurn(l, "t", ALWAYS);
    expect(outcomeOf(l)).toBe("DECLINED_SILENT");
  });
});

describe("question-ledger — luật chi tiết", () => {
  it("chỉ lần quan sát ĐẦU TIÊN có câu hỏi mới tính", () => {
    const l = asked();
    markObserved(l, "t", SEEN, []);
    markObserved(l, "t", SEEN, PARSED);
    expect(outcomeOf(l)).toBe("NOT_PARSED");
  });

  it("quan sát khi câu chưa hiện trong chat thì không tính", () => {
    const l = asked();
    markObserved(l, "t", [], PARSED);
    expect(outcomeOf(l)).toBe("UNDETERMINED");
  });

  it("chỉ người bị hỏi mới được tính lượt, và chỉ khi câu đã vào chat", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    markSpeechTurn(l, "someone-else", ALWAYS);
    markSpeechTurn(l, "t", () => false);
    expect(outcomeOf(l)).toBe("NO_TURN");
  });

  it("bị chặn khi đáp một câu KHÁC thì không tính là bị chặn", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    markBlocked(l, "m9", "t", "CHAIN_DEPTH");
    expect(outcomeOf(l)).toBe("NO_TURN");
  });

  it("sự kiện mang đúng các trường, đúng thứ tự khoá; câu hỏi của bot không có humanAsker", () => {
    const [event] = settleQuestions(asked());
    expect(JSON.stringify(event)).toBe(
      JSON.stringify({ kind: "QUESTION_OUTCOME", round: 2, messageId: "m1", askerId: "a", targetId: "t", outcome: "UNDETERMINED" }),
    );
  });

  it("cờ humanAsker đi tới sự kiện", () => {
    const [event] = settleQuestions(asked({ humanAsker: true }));
    expect(event!.humanAsker).toBe(true);
  });

  it("chốt theo đúng thứ tự mở, rồi làm rỗng sổ", () => {
    const l = createQuestionLedger();
    openQuestion(l, { ...Q, messageId: "m1" });
    openQuestion(l, { ...Q, messageId: "m2" });
    expect(settleQuestions(l).map((e) => e.messageId)).toEqual(["m1", "m2"]);
    expect(l.open).toEqual([]);
    expect(settleQuestions(l)).toEqual([]);
  });

  it("mở lại cùng messageId thì thay TẠI CHỖ, đúng như Map.set cũ", () => {
    const l = createQuestionLedger();
    openQuestion(l, { ...Q, messageId: "m1" });
    openQuestion(l, { ...Q, messageId: "m2" });
    openQuestion(l, { ...Q, messageId: "m1", askerId: "b" });
    expect(l.open.map((q) => [q.messageId, q.askerId])).toEqual([["m1", "b"], ["m2", "a"]]);
  });

  it("qua JSON giữa chừng rồi đi tiếp cho cùng kết quả — điều kiện để sống qua restart", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    const revived: QuestionLedgerState = JSON.parse(JSON.stringify(l));
    markSpeechTurn(revived, "t", ALWAYS);
    markSpoke(revived, "t", "m1", ALWAYS);
    expect(outcomeOf(revived)).toBe("ANSWERED");
  });
});
