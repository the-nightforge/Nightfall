import { describe, expect, it } from "vitest";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import { runBatch } from "../src/bot/evaluation/report";
import {
  parseTraceJsonl,
  parseTraceLine,
  serializeTrace,
  serializeTraces,
  termSumProblems,
  traceFileName,
} from "../src/bot/trace/trace-jsonl";
import { formatTraceTimeline } from "../src/bot/trace/trace-view";
import type { BotDecisionTrace } from "../src/bot/trace/trace";

/**
 * Trace đi qua đĩa.
 *
 * Mọi khẳng định ở đây đo đúng một thứ: chuyến đi JSON có làm hỏng lời giải
 * thích không. Bất biến "số hạng cộng lại bằng điểm" đúng theo cấu tạo TRONG
 * BỘ NHỚ (`score` được tính bằng `sumTerms`), nên chỗ duy nhất nó còn có thể
 * gãy là ở đây - và nếu nó gãy thì công cụ tuning sẽ chỉ sai trọng số một cách
 * im lặng, đúng thứ tệ hơn không có công cụ.
 */

function sampleTraces(): BotDecisionTrace[] {
  const game = runSelfPlay({ seed: "jsonl", playerCount: 8, trace: true });
  expect(game.traces.length).toBeGreaterThan(20);
  return game.traces;
}

/**
 * `-0` thành `0`: chỗ DUY NHẤT chuyến đi qua đĩa không khứ hồi nguyên vẹn.
 *
 * JSON không có cách nào viết `-0`, và bảng điểm sinh ra `-0` khá thường xuyên
 * (một số hạng âm nhân với 0). Chuẩn hoá ở đây chứ không ở tầng ghi, vì `-0`
 * không thay đổi bất cứ điều gì có nghĩa: `-0 === 0`, và `sumTerms` bắt đầu từ
 * `0` nên tổng cũng không đổi. Thứ đang được khẳng định vẫn là "parse lại ra
 * đúng object đã ghi"; đây chỉ là việc nói rõ chữ "đúng" nghĩa là gì.
 */
function zeroNormalized<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => (Object.is(item, -0) ? 0 : item)));
}

describe("JSONL: định dạng ổn định", () => {
  it("parse lại ra ĐÚNG object đã ghi", () => {
    const traces = sampleTraces();
    expect(parseTraceJsonl(serializeTraces(traces))).toEqual(zeroNormalized(traces));
  });

  it("ghi ra rồi đọc vào rồi ghi lại cho ĐÚNG chuỗi byte cũ", () => {
    // Mạnh hơn `toEqual`: nó khoá cả thứ tự khoá. Không có nó, một lần đổi thứ
    // tự trường trong `BotDecisionTrace` sẽ làm mọi file trace đã lưu diff toàn
    // bộ mà không có dòng nào thật sự đổi nghĩa.
    const once = serializeTraces(sampleTraces());
    expect(serializeTraces(parseTraceJsonl(once))).toBe(once);
  });

  it("một dòng đúng một trace, và file kết thúc bằng newline", () => {
    const traces = sampleTraces();
    const text = serializeTraces(traces);

    expect(text.endsWith("\n")).toBe(true);
    expect(text.trimEnd().split("\n")).toHaveLength(traces.length);
    // Mỗi dòng phải TỰ ĐỨNG được: `jq -c 'select(.botId=="p3")'` là công cụ đầu
    // tiên người ta với tới, và nó đọc từng dòng một.
    for (const [index, line] of text.trimEnd().split("\n").entries()) {
      expect(JSON.parse(line)).toEqual(zeroNormalized(traces[index]));
    }
  });

  it("file rỗng ra chuỗi rỗng, không phải một dòng trắng", () => {
    expect(serializeTraces([])).toBe("");
    expect(parseTraceJsonl("")).toEqual([]);
  });

  it("bỏ qua dòng trắng nhưng KHÔNG bỏ qua dòng hỏng", () => {
    const traces = sampleTraces().slice(0, 2);
    const text = `${serializeTrace(traces[0]!)}\n\n${serializeTrace(traces[1]!)}\n`;
    expect(parseTraceJsonl(text)).toEqual(zeroNormalized(traces));

    expect(() => parseTraceJsonl(`${serializeTrace(traces[0]!)}\n{ hỏng\n`)).toThrow(/dòng 2/);
  });

  it("báo lỗi kèm SỐ DÒNG, không chỉ kèm thông điệp của JSON.parse", () => {
    expect(() => parseTraceLine("{}", 7)).toThrow(/dòng 7/);
    expect(() => parseTraceLine("[1,2]", 3)).toThrow(/không phải một object/);
    expect(() => parseTraceLine('{"botId":"p1"}', 9)).toThrow(/thiếu round/);
  });

  it("tên file mang seed và không bao giờ chứa ký tự đường dẫn", () => {
    expect(traceFileName("batch:0")).toBe("batch-0.jsonl");
    expect(traceFileName("a/b c")).toBe("a-b-c.jsonl");
    // Hai seed khác nhau phải ra hai tên khác nhau, nếu không một ván ghi đè ván kia.
    expect(traceFileName("a:b")).not.toBe(traceFileName("a:c"));
  });
});

describe("JSONL: số hạng cộng đúng điểm sau khi qua đĩa", () => {
  it("một ván thật không có ứng viên nào lệch", () => {
    expect(termSumProblems(parseTraceJsonl(serializeTraces(sampleTraces())))).toEqual([]);
  });

  it("bắt được một ứng viên bị làm lệch", () => {
    // Không có khẳng định này thì test trên chỉ chứng minh nó chạy, chứ không
    // chứng minh nó BIẾT PHÁT HIỆN. Sửa `score` mà không sửa `terms` là đúng
    // hình dạng của lỗi cần bắt: một số hạng bị quên ở đường chấm điểm.
    const traces = sampleTraces();
    const broken = traces.find((trace) => trace.candidates.length > 0)!;
    const tampered: BotDecisionTrace = {
      ...broken,
      candidates: [{ ...broken.candidates[0]!, score: broken.candidates[0]!.score + 10 }],
    };

    const problems = termSumProblems(parseTraceJsonl(serializeTraces([tampered])));
    expect(problems).toHaveLength(1);
    expect(problems[0]!.sum).toBeCloseTo(problems[0]!.score - 10, 6);
  });

  it("dung sai không nuốt một số hạng thật bị bỏ quên", () => {
    // Dung sai tỉ lệ phải đủ chặt để một số hạng nhỏ nhất trong bảng - jitter,
    // cỡ đơn vị - vẫn làm nó kêu.
    const base = sampleTraces().find((trace) => trace.candidates.length > 0)!;
    const candidate = base.candidates[0]!;
    const tampered: BotDecisionTrace = {
      ...base,
      candidates: [{ ...candidate, score: candidate.score + 0.001 }],
    };
    expect(termSumProblems([tampered])).toHaveLength(1);
  });
});

describe("trace-view: đọc được bằng mắt", () => {
  it("in timeline của mọi bot, nhóm theo bot", () => {
    const traces = sampleTraces();
    const text = formatTraceTimeline(traces, { source: "test.jsonl" });

    expect(text).toContain("test.jsonl");
    expect(text).toContain(`${traces.length} quyết định`);
    for (const botId of new Set(traces.map((trace) => trace.botId))) {
      expect(text).toContain(`BOT ${botId} ·`);
    }
  });

  it("--bot lọc đúng một bot và nói rõ nó đang lọc", () => {
    const traces = sampleTraces();
    const botId = traces[0]!.botId;
    const others = [...new Set(traces.map((trace) => trace.botId))].filter((id) => id !== botId);

    const text = formatTraceTimeline(traces, { botId });
    expect(text).toContain(`lọc: --bot ${botId}`);
    expect(text).toContain(`BOT ${botId} ·`);
    for (const other of others) expect(text).not.toContain(`BOT ${other} ·`);
  });

  it("một id không có trong file thì NÓI RA, kèm danh sách bot có thật", () => {
    // Đường im lặng ở đây là cái bẫy đắt nhất của công cụ: gõ nhầm id rồi nhìn
    // một màn hình trống và kết luận bot không quyết định gì.
    const text = formatTraceTimeline(sampleTraces(), { botId: "không-có-ai" });
    expect(text).toContain('Không có quyết định nào của "không-có-ai"');
    expect(text).toContain("p1");
  });

  it("nêu người dẫn đầu, người đứng nhì, và HỌ HƠN NHAU Ở SỐ HẠNG NÀO", () => {
    const trace = sampleTraces().find(
      (item) => item.decision === "VOTE" && item.candidates.length >= 2,
    )!;
    const text = formatTraceTimeline([trace]);

    expect(text).toContain("#1 ");
    expect(text).toContain("#2 ");
    expect(text).toContain("hơn nhau ở:");
    expect(text).toContain("← chọn");
  });

  it("số hạng in ra theo độ lớn giảm dần, vì đó là thứ người đọc đang tìm", () => {
    const trace: BotDecisionTrace = {
      ...sampleTraces()[0]!,
      decision: "VOTE",
      chosen: { targetId: "pX", label: "bầu" },
      candidates: [
        {
          targetId: "pX",
          score: 53,
          terms: [
            { name: "nhỏ", value: 3 },
            { name: "to", value: -50 },
          ],
          evidenceIds: [],
        },
      ],
    };
    const line = formatTraceTimeline([trace])
      .split("\n")
      .find((item) => item.includes("to "))!;
    expect(line.indexOf("to −50.0")).toBeLessThan(line.indexOf("nhỏ +3.0"));
  });

  it("cảnh báo khi nước đã chọn KHÔNG phải người dẫn đầu bảng điểm", () => {
    // Nghĩa là một luật ngoài bảng đã can thiệp. Không nói ra thì người đọc sẽ
    // đi sửa trọng số của một bảng vốn không quyết định gì ở lượt này.
    const base = sampleTraces()[0]!;
    const trace: BotDecisionTrace = {
      ...base,
      decision: "VOTE",
      chosen: { targetId: "pC", label: "bầu" },
      candidates: [
        { targetId: "pA", score: 90, terms: [{ name: "belief", value: 90 }], evidenceIds: [] },
        { targetId: "pB", score: 80, terms: [{ name: "belief", value: 80 }], evidenceIds: [] },
        { targetId: "pC", score: 1, terms: [{ name: "belief", value: 1 }], evidenceIds: [] },
      ],
    };
    expect(formatTraceTimeline([trace])).toContain("⚠ chọn pC (1.0) dù không dẫn đầu bảng");
  });

  it("nêu vì sao bot mở miệng, và vì sao nó im", () => {
    const traces = sampleTraces();
    const spoke = traces.find((item) => item.decision === "SPEECH" && item.chosen.reason);
    const silent = traces.find(
      (item) => item.decision === "SPEECH" && item.chosen.label === "im lặng",
    );

    expect(spoke, "một ván 8 người luôn có ít nhất một câu nói có lý do").toBeDefined();
    expect(formatTraceTimeline([spoke!])).toContain(`↳ vì: ${spoke!.chosen.reason}`);

    expect(silent, "và luôn có ít nhất một lần im lặng").toBeDefined();
    expect(formatTraceTimeline([silent!])).toContain(`↳ bỏ cuộc: ${silent!.fallbackReason}`);
  });

  it("nêu belief đã đổi thế nào ở lần quan sát gần nhất", () => {
    const moved = sampleTraces().find(
      (trace) =>
        Object.keys(trace.beliefAfter).some(
          (id) =>
            Math.abs(
              (trace.beliefAfter[id]?.suspicion ?? 0) - (trace.beliefBefore[id]?.suspicion ?? 0),
            ) > 1,
        ),
    )!;
    expect(formatTraceTimeline([moved])).toMatch(/belief: \S+ [+−]\d/);
  });

  it("không in lại nguyên khối belief cho hai quyết định cùng một lần quan sát", () => {
    // `beliefBefore/After` chỉ đổi ở `observe`, nên VOTE và SPEECH liền nhau
    // dùng chung một cặp ảnh. In hai lần chỉ đẩy thứ đáng đọc ra khỏi màn hình.
    const traces = sampleTraces();
    const pair = traces.filter(
      (trace) =>
        trace.botId === traces[0]!.botId &&
        JSON.stringify(trace.beliefAfter) === JSON.stringify(traces[0]!.beliefAfter),
    );
    const printed = formatTraceTimeline(pair)
      .split("\n")
      .filter((line) => line.trim().startsWith("belief:"));
    expect(printed.length).toBeLessThanOrEqual(1);
  });

  it("file rỗng không làm vỡ viewer", () => {
    expect(formatTraceTimeline([])).toContain("File không có quyết định nào.");
  });
});

describe("selfplay: trần trace", () => {
  it("mặc định KHÔNG cấp phát trace nào", () => {
    // Đây là ràng buộc 1 của `trace.ts` đo ở tầng batch: không cờ nào bật thì
    // không object trace nào tồn tại, nên không có gì để chậm đi.
    const games = runBatch({ seedBase: "off", games: 3, playerCount: 8 });
    expect(games.map((game) => game.traces.length)).toEqual([0, 0, 0]);
  });

  it("--trace-games n chỉ thu n ván ĐẦU, phần đuôi batch vẫn bằng không", () => {
    const games = runBatch({ seedBase: "cap", games: 4, playerCount: 8, traceGames: 2 });
    expect(games.slice(0, 2).every((game) => game.traces.length > 0)).toBe(true);
    expect(games.slice(2).map((game) => game.traces.length)).toEqual([0, 0]);
  });

  it("bật trace KHÔNG làm ván chạy khác đi một chút nào", () => {
    // Khẳng định thật sự bảo vệ ràng buộc 1: `wrapRngForTrace` bọc dòng số mà
    // không tiêu thêm số nào, nên chuỗi sự kiện phải trùng khít. Sai ở đây
    // nghĩa là mọi báo cáo chạy kèm `--traces` đang đo một ván khác.
    const off = runBatch({ seedBase: "same", games: 2, playerCount: 8 });
    const on = runBatch({ seedBase: "same", games: 2, playerCount: 8, traceGames: 2 });

    expect(on.map((game) => game.events)).toEqual(off.map((game) => game.events));
    expect(on.map((game) => game.winner)).toEqual(off.map((game) => game.winner));
    expect(on.map((game) => game.violations)).toEqual(off.map((game) => game.violations));
  });

  it("trace của một batch phủ đủ các loại quyết định để đọc được ván", () => {
    const [game] = runBatch({ seedBase: "kinds", games: 1, playerCount: 8, traceGames: 1 });
    const kinds = new Set(game!.traces.map((trace) => trace.decision));
    expect([...kinds].sort()).toEqual(expect.arrayContaining(["NIGHT", "SPEECH", "VOTE"]));
  });
});
