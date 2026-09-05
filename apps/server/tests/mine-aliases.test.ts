import { describe, expect, it, vi } from "vitest";

// Script này mở kết nối Prisma ở tầng module; bài test chỉ quan tâm nhân thuần.
vi.mock("../src/db", () => ({ prisma: { $disconnect: async () => undefined } }));

const { mineAliases, formatProposal } = await import("../scripts/mine-aliases");

function said(...texts: string[]) {
  return texts.map((text) => ({ text, channel: "day", round: 1 }));
}

function keys(messages: ReturnType<typeof said>): string[] {
  return mineAliases(messages).map((candidate) => candidate.key);
}

describe("đào alias", () => {
  it("bắt token lạ đứng sau neo tự nhận vai, cả có dấu lẫn không dấu", () => {
    // "tt" và "bv" từng đứng đây, và ngừng đo được đúng vào ngày chúng thành
    // alias thật trong ROLE_PHRASES (cùng câu chuyện với "bà đồng" ở dưới).
    // "pt"/"ts"/"sw" là viết tắt CHƯA có trong bảng.
    const found = keys(said("tôi là pt nhé", "toi la pt", "mình là ts", "nhận sw"));

    expect(found).toContain("pt");
    expect(found).toContain("ts");
    expect(found).toContain("sw");
  });

  it("gom dạng có dấu và không dấu về CÙNG một ứng viên", () => {
    // Không gom thì "sw" và "sw" viết khác dấu sẽ là hai dòng khác nhau trong
    // tờ đề xuất, và tần suất thật bị chia đôi.
    const [top] = mineAliases(said("tôi là bảo kê", "toi la bao ke", "mình là bảo kê"));

    expect(top!.key).toBe("bao ke");
    expect(top!.count).toBe(3);
    expect([...top!.forms.keys()]).toContain("bảo kê");
  });

  it("KHÔNG đề xuất thứ parser hiện tại đã hiểu", () => {
    // Đây là câu khẳng định quan trọng nhất: tờ đề xuất chỉ được nói về khoảng
    // trống thật, nếu không người duyệt sẽ phải lọc tay chính bảng đang chạy.
    const found = keys(
      said("tôi là tiên tri", "mình là thợ săn", "nhận phù thuỷ", "p3 là sói", "toi la ma soi"),
    );

    expect(found).toEqual([]);
  });

  it("bỏ qua mệnh đề phủ định, đúng như parser bỏ qua", () => {
    expect(keys(said("tôi không phải pt đâu", "mình chưa là ts", "t ko phải pt"))).toEqual([]);
  });

  it("chỉ nhận neo ở ĐẦU mệnh đề - không đọc trộm giữa câu", () => {
    // "ai bảo tôi là tt" là một câu hỏi, không phải lời khai. Nhận nó ở đây thì
    // tờ đề xuất sẽ đếm cả những chỗ parser vốn cố tình không đọc - neo "X là"
    // chặn nó bằng `MAX_SUBJECT_TOKENS`, neo đầu câu bằng chính vị trí.
    expect(keys(said("ai bảo tôi là pt vậy"))).toEqual([]);
    // Nhưng sau dấu phẩy thì đó là một mệnh đề mới, và nó được đọc.
    expect(keys(said("thôi được rồi, tôi là pt"))).toContain("pt");
  });

  it("vế trước ` là ` phải ngắn như một cái tên", () => {
    expect(keys(said("cái điều mà mọi người đang nghĩ là sai bét"))).toEqual([]);
    expect(keys(said("p4 là sw đó"))).toContain("sw");
  });

  it("đếm cả 1-gram lẫn 2-gram, vì bảng vai có cả hai cỡ", () => {
    /*
     * Cụm mẫu phải là cụm CHƯA có trong `ROLE_PHRASES` - đó là toàn bộ việc của
     * bộ đào alias. Chỗ này từng dùng "bà đồng", và nó ngừng đo được đúng vào
     * ngày Bà Đồng trở thành một vai thật: miner nhận ra cụm đã biết rồi bỏ qua,
     * nên test đỏ vì lý do hoàn toàn đúng.
     *
     * "ông mo" là một cách gọi dân gian không nằm trong bảng, nên nó giữ được
     * tiền đề: hai cỡ n-gram vẫn phải cùng được đếm.
     */
    const found = keys(said("tôi là ông mo"));

    expect(found).toContain("ong");
    expect(found).toContain("ong mo");
  });

  it("bỏ từ chức năng đứng ngay sau neo", () => {
    expect(keys(said("tôi là người tốt mà", "mình là ai cơ"))).toEqual([]);
  });

  it("xếp theo tần suất và giữ tối đa ba ví dụ", () => {
    const messages = said(
      "tôi là pt",
      "mình là pt",
      "nhận pt",
      "t là pt",
      "tôi là ts",
    );
    const [top] = mineAliases(messages);

    expect(top!.key).toBe("pt");
    expect(top!.count).toBe(4);
    expect(top!.examples).toHaveLength(3);
  });
});

describe("tờ đề xuất", () => {
  const report = formatProposal(
    mineAliases(said("tôi là pt", "mình là pt", "nhận bảo kê")),
    { limit: 500, top: 30 },
    3,
    24,
  );

  it("nói rõ nó KHÔNG tự sửa bảng vai", () => {
    expect(report).toContain("KHÔNG đụng vào `ROLE_PHRASES`");
  });

  it("chép sẵn quy tắc alias ≤2 ký tự vào ngay trong đầu ra", () => {
    expect(report).toContain("Alias ≤2 ký tự");
    expect(report).toContain("CẤM khớp tự do");
  });

  it("gắn cờ cảnh báo lên đúng những ứng viên ≤2 ký tự", () => {
    expect(report).toContain("`pt` — 2 lần ⚠️ ≤2 ký tự");
    // Cụm dài không bị gắn cờ: quy tắc đó nói về alias viết tắt, không phải về
    // mọi alias.
    expect(report).toContain("`bao ke` — 1 lần\n");
  });

  it("báo rõ khi số liệu đến từ dữ liệu mồi", () => {
    expect(report).toContain("Dữ liệu MỒI");
    expect(report).toContain("24 câu slang");
  });
});
