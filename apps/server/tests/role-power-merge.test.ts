import { describe, expect, it } from "vitest";
import { ROLE_POWER } from "@masoi/shared";
import { mergeShards, type ShardReport } from "../scripts/role-power-merge";

/**
 * Gộp kết quả của nhiều shard CI thành một bảng.
 *
 * Mỗi shard chỉ quét một phần preset (và có thể chỉ một phần vai), nên cột
 * "đo được" của riêng nó vô nghĩa - nó dựng trên vai làng mạnh nhất của CHÍNH
 * lượt đó. Chỉ `delta` thô là cộng được, và phải cộng GIA QUYỀN THEO MẪU: một
 * vai đo ở 4 preset không được đếm ngang một vai đo ở 1 preset.
 */
const shard = (over: Partial<ShardReport> = {}): ShardReport => ({
  games: 300,
  presets: [],
  deltas: [],
  ...over,
});

describe("mergeShards", () => {
  it("gộp delta của cùng một vai từ nhiều shard, gia quyền theo số mẫu", () => {
    const merged = mergeShards([
      shard({ deltas: [
        { role: "SEER", playerCount: 8, delta: 0.10 },
        { role: "SEER", playerCount: 9, delta: 0.20 },
        { role: "SEER", playerCount: 10, delta: 0.30 },
      ] }),
      shard({ deltas: [{ role: "SEER", playerCount: 20, delta: 0.02 }] }),
    ]);

    const seer = merged.roles.find((row) => row.role === "SEER")!;
    expect(seer.samples).toBe(4);
    // Trung bình của 4 mẫu, KHÔNG phải trung bình của hai trung bình shard
    // (cách sai đó cho ra (0.2 + 0.02)/2 = 0.11).
    expect(seer.meanDelta).toBeCloseTo(0.155, 6);
  });

  it("quy đổi sang thang ROLE_POWER: implied = 0.5 + meanΔ_điểm/6, làm tròn 0.5", () => {
    const merged = mergeShards([
      shard({ deltas: [{ role: "GUARD", playerCount: 8, delta: 0.12 }] }),
    ]);

    // 0.12 = 12 điểm; 0.5 + 12/6 = 2.5
    expect(merged.roles.find((row) => row.role === "GUARD")!.implied).toBe(2.5);
  });

  it("chỉ gắn cờ SUSPECT khi lệch quá 1.0 so với bảng đang dùng", () => {
    // Delta dựng TỪ bảng đang dùng, để test sống qua mỗi lần hiệu chỉnh
    // `ROLE_POWER`: nghịch đảo của implied = 0.5 + Δ_điểm/6.
    const deltaFor = (implied: number): number => ((implied - 0.5) * 6) / 100;
    const merged = mergeShards([
      shard({ deltas: [
        // Đo ra đúng giá đang dùng: lệch 0.
        { role: "GUARD", playerCount: 8, delta: deltaFor(ROLE_POWER.GUARD) },
        // Đo ra cao hơn 2.5 bậc: lệch quá ngưỡng.
        { role: "SEER", playerCount: 8, delta: deltaFor(ROLE_POWER.SEER + 2.5) },
      ] }),
    ]);

    expect(merged.roles.find((row) => row.role === "GUARD")!.suspect).toBe(false);
    expect(merged.roles.find((row) => row.role === "SEER")!.suspect).toBe(true);
  });

  it("gộp baseline của mọi shard và sắp theo cỡ phòng", () => {
    const merged = mergeShards([
      shard({ presets: [{ playerCount: 20, villageWinRate: 0.61 }] }),
      shard({ presets: [{ playerCount: 8, villageWinRate: 0.51 }] }),
    ]);

    expect(merged.presets.map((item) => item.playerCount)).toEqual([8, 20]);
  });

  it("baseline trùng giữa các shard chỉ được đếm một lần", () => {
    // Shard cắt theo `--role` của CÙNG một preset đều phải chạy lại baseline,
    // nên cùng một cỡ phòng xuất hiện ở nhiều shard. Bảng phải nói một dòng.
    const merged = mergeShards([
      shard({ presets: [{ playerCount: 20, villageWinRate: 0.61 }] }),
      shard({ presets: [{ playerCount: 20, villageWinRate: 0.61 }] }),
    ]);

    expect(merged.presets).toEqual([{ playerCount: 20, villageWinRate: 0.61 }]);
  });

  it("từ chối gộp khi cùng một preset ra hai baseline khác nhau", () => {
    // Cùng cỡ phòng, cùng seed, cùng số ván thì baseline PHẢI trùng khít. Lệch
    // nghĩa là phép đo không tái lập được, và một bảng dựng trên nó không nói
    // lên điều gì. Thà đỏ còn hơn im lặng lấy con số đầu tiên.
    expect(() =>
      mergeShards([
        shard({ presets: [{ playerCount: 20, villageWinRate: 0.61 }] }),
        shard({ presets: [{ playerCount: 20, villageWinRate: 0.58 }] }),
      ]),
    ).toThrow(/baseline/i);
  });

  it("từ chối gộp các shard chạy khác số ván", () => {
    // Δ của 300 ván và Δ của 50 ván không cùng một đại lượng; gộp im lặng thì
    // bảng cuối là một con số không ai truy được về đâu.
    expect(() =>
      mergeShards([shard({ games: 300 }), shard({ games: 50 })]),
    ).toThrow(/số ván/i);
  });
});
