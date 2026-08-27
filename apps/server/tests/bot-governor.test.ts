import { describe, expect, it } from "vitest";
import { BotGovernor, withTimeout } from "../src/bots/governor";

describe("BotGovernor", () => {
  it("cho gọi tới khi chạm trần", () => {
    const g = new BotGovernor(2);
    expect(g.canCall("R")).toBe(true);
    g.recordCall("R");
    g.recordCall("R");
    expect(g.canCall("R")).toBe(false);
  });

  it("429 chặn lời gọi trong lúc nghỉ", () => {
    let t = 0;
    const g = new BotGovernor(10, () => t);
    g.backOff(5_000);
    expect(g.canCall("R")).toBe(false);
  });

  // Đây là lý do tồn tại của backOff: bản cũ tắt hẳn tới hết ván nên một lần
  // chạm rate limit thoáng qua khiến mọi bot câm vĩnh viễn, không có đường về.
  it("hết giờ nghỉ thì cho gọi lại", () => {
    let t = 0;
    const g = new BotGovernor(10, () => t);
    g.backOff(5_000);
    t = 4_999;
    expect(g.canCall("R")).toBe(false);
    t = 5_000;
    expect(g.canCall("R")).toBe(true);
  });

  // Quota là của API key chứ không của phòng, nên nghỉ phải là toàn cục - nếu
  // không, các phòng còn lại vẫn đâm vào đúng bức tường vừa dựng lên.
  it("nghỉ áp dụng cho mọi phòng, không riêng phòng gặp 429", () => {
    let t = 0;
    const g = new BotGovernor(10, () => t);
    g.backOff(5_000);
    expect(g.canCall("KHAC")).toBe(false);
  });

  it("chỉ nới dài hạn nghỉ, không rút ngắn", () => {
    let t = 0;
    const g = new BotGovernor(10, () => t);
    g.backOff(60_000);
    g.backOff(1_000);
    expect(g.cooldownRemainingMs()).toBe(60_000);
  });

  it("thiếu retryDelay thì dùng mặc định, và chặn trên retryDelay quá dài", () => {
    let t = 0;
    const g = new BotGovernor(10, () => t);
    g.backOff();
    expect(g.cooldownRemainingMs()).toBe(30_000);

    const g2 = new BotGovernor(10, () => t);
    g2.backOff(10 * 60_000);
    expect(g2.cooldownRemainingMs()).toBe(120_000);
  });

  it("reset trả phòng về trạng thái sạch nhưng giữ nguyên hạn nghỉ", () => {
    let t = 0;
    const g = new BotGovernor(1, () => t);
    g.recordCall("R");
    g.reset("R");
    expect(g.canCall("R")).toBe(true);

    g.backOff(5_000);
    g.reset("R");
    // Ván mới không làm quota của API key hồi lại
    expect(g.canCall("R")).toBe(false);
  });
});

describe("withTimeout", () => {
  it("trả kết quả khi kịp giờ", async () => {
    expect(await withTimeout(async () => "xong", 1_000)).toBe("xong");
  });

  it("trả null và bắn abort khi quá hạn", async () => {
    let aborted = false;
    const out = await withTimeout(
      (signal) =>
        new Promise<string>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve("muộn");
          });
        }),
      20,
    );
    expect(out).toBeNull();
    expect(aborted).toBe(true);
  });

  it("trả null khi công việc ném lỗi", async () => {
    expect(await withTimeout(async () => {
      throw new Error("mạng hỏng");
    }, 1_000)).toBeNull();
  });

  it("hạn chót cứng: trả null trong ms ngay cả khi công việc bỏ qua signal", async () => {
    const start = Date.now();
    const result = await withTimeout(
      () => new Promise<string>(() => {}), // Never settles, ignores signal
      25,
    );
    const elapsed = Date.now() - start;

    // Must return null and respect the timeout
    expect(result).toBeNull();
    // Should complete within 100ms (generous margin for test flakiness)
    expect(elapsed).toBeLessThan(100);
  });
});
