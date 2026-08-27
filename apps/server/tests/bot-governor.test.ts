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

  it("ngắt mạch chặn mọi lời gọi sau đó của phòng đó", () => {
    const g = new BotGovernor(10);
    g.trip("R");
    expect(g.canCall("R")).toBe(false);
  });

  it("không ảnh hưởng phòng khác", () => {
    const g = new BotGovernor(1);
    g.trip("R");
    expect(g.canCall("KHAC")).toBe(true);
  });

  it("reset trả phòng về trạng thái sạch", () => {
    const g = new BotGovernor(1);
    g.recordCall("R");
    g.trip("R");
    g.reset("R");
    expect(g.canCall("R")).toBe(true);
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
});
