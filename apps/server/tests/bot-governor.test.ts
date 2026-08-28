import { describe, expect, it } from "vitest";
import { BotGovernor, Cooldown, withTimeout } from "../src/bots/governor";

describe("BotGovernor", () => {
  it("cho gọi tới khi chạm trần", () => {
    const g = new BotGovernor(2);
    expect(g.canCall("R")).toBe(true);
    g.recordCall("R");
    g.recordCall("R");
    expect(g.canCall("R")).toBe(false);
  });

  it("reset trả phòng về trạng thái sạch", () => {
    const g = new BotGovernor(1);
    g.recordCall("R");
    g.reset("R");
    expect(g.canCall("R")).toBe(true);
  });
});

describe("Cooldown", () => {
  it("chặn trong lúc nghỉ", () => {
    let t = 0;
    const c = new Cooldown(() => t);
    c.backOff(5_000);
    expect(c.active()).toBe(true);
  });

  // Đây là lý do tồn tại của Cooldown: bản đầu tắt hẳn tới hết ván nên một lần
  // chạm rate limit thoáng qua khiến mọi bot câm vĩnh viễn, không có đường về.
  it("hết giờ nghỉ thì thôi chặn", () => {
    let t = 0;
    const c = new Cooldown(() => t);
    c.backOff(5_000);
    t = 4_999;
    expect(c.active()).toBe(true);
    t = 5_000;
    expect(c.active()).toBe(false);
  });

  it("chỉ nới dài hạn nghỉ, không rút ngắn", () => {
    const c = new Cooldown(() => 0);
    c.backOff(60_000);
    c.backOff(1_000);
    expect(c.remainingMs()).toBe(60_000);
  });

  it("thiếu thông tin chờ thì dùng mặc định, và chặn trên giá trị quá dài", () => {
    const a = new Cooldown(() => 0);
    a.backOff();
    expect(a.remainingMs()).toBe(30_000);
    const b = new Cooldown(() => 0);
    b.backOff(10 * 60_000);
    expect(b.remainingMs()).toBe(120_000);
  });

  // Quota thuộc về một API key, nên hết quota ở nhà cung cấp này không được
  // khoá nhà cung cấp khác - nếu không cả chuỗi dự phòng sập vì một cú 429.
  it("độc lập giữa các nhà cung cấp", () => {
    const a = new Cooldown(() => 0);
    const b = new Cooldown(() => 0);
    a.backOff(5_000);
    expect(a.active()).toBe(true);
    expect(b.active()).toBe(false);
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
    // Should complete within reasonable margin for CI / high load
    expect(elapsed).toBeLessThan(1000);
  });
});
