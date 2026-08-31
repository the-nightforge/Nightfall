import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

interface Row {
  id: string;
  avatarUrl: string | null;
  avatarKey: string | null;
}

const db = vi.hoisted(() => ({
  players: new Map<string, { id: string; avatarUrl: string | null; avatarKey: string | null }>(),
  failUpdate: false,
  // Đếm số lần findUnique thật sự chạy trong một test - dùng để CHỨNG MINH
  // vòng lặp compare-and-swap có thực sự thử lại, chứ không chỉ suy luận từ
  // trạng thái cuối (trạng thái cuối đúng vẫn có thể ra từ một lần chạy không
  // hề va chạm).
  findUniqueCalls: 0,
  // Hook một lần dùng: updateMany gọi và await đúng một lần rồi tự xoá mình,
  // nên nó chặn được CHÍNH XÁC lệnh updateMany kế tiếp cho tới khi test chủ
  // động mở khoá - thay cho việc đoán độ trễ của sharp/Promise.all rồi hy vọng
  // hai luồng chồng nhau.
  beforeUpdate: null as null | (() => Promise<void>),
}));

vi.mock("../src/db", () => ({
  prisma: {
    player: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        db.findUniqueCalls++;
        return db.players.get(where.id) ?? null;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; avatarKey?: string | null };
        data: { avatarUrl: string | null; avatarKey: string | null };
      }) => {
        if (db.beforeUpdate) {
          const hook = db.beforeUpdate;
          db.beforeUpdate = null;
          await hook();
        }
        if (db.failUpdate) throw new Error("DB sập");
        const row = db.players.get(where.id);
        if (!row) return { count: 0 };
        if (where.avatarKey !== undefined && row.avatarKey !== where.avatarKey) {
          return { count: 0 };
        }
        row.avatarUrl = data.avatarUrl;
        row.avatarKey = data.avatarKey;
        return { count: 1 };
      },
    },
  },
}));

const applied = vi.hoisted(() => ({ fn: vi.fn(async () => undefined) }));
vi.mock("../src/rooms/apply-avatar", () => ({ applyAvatarToRoom: applied.fn }));

import { AvatarError } from "../src/avatar/errors";
import { MAX_AVATAR_UPLOAD_BYTES, avatarObjectKey, clearAvatar, setAvatar } from "../src/avatar/service";
import { createMemoryStorage, type MemoryObjectStorage } from "../src/storage/memory";
import { resetObjectStorage, setObjectStorage } from "../src/storage";

let storage: MemoryObjectStorage;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

async function jpeg(color = { r: 200, g: 60, b: 60 }): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

function row(id: string): Row {
  return db.players.get(id)!;
}

beforeEach(() => {
  db.players.clear();
  db.failUpdate = false;
  db.findUniqueCalls = 0;
  db.beforeUpdate = null;
  db.players.set("p1", { id: "p1", avatarUrl: null, avatarKey: null });
  db.players.set("p2", { id: "p2", avatarUrl: null, avatarKey: null });
  storage = createMemoryStorage("https://cdn.test/masoi");
  setObjectStorage(storage);
  applied.fn.mockClear();
  // service.ts CỐ Ý console.error trên mọi nhánh lỗi (đó là tầng duy nhất
  // được log, image.ts không tự log) - năm test dưới đây đi đúng những nhánh
  // đó, nên không câm log thì mỗi lần chạy suite lại phun cả chồng stderr vô
  // hại nhưng gây nhiễu. Câm ở ĐÂY (test), không đụng vào service.ts.
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  resetObjectStorage();
  consoleErrorSpy.mockRestore();
});

describe("avatarObjectKey", () => {
  it("không đoán được và không dùng tên file người dùng", () => {
    const a = avatarObjectKey("p1");
    const b = avatarObjectKey("p1");

    expect(a).toMatch(/^avatars\/p1\/[0-9a-f]{32}\.webp$/);
    expect(a).not.toBe(b);
  });
});

describe("setAvatar", () => {
  it("upload thành công thì DB lưu URL object và khoá object, không lưu base64", async () => {
    const { avatarUrl } = await setAvatar("p1", await jpeg());

    expect(avatarUrl).toMatch(/^https:\/\/cdn\.test\/masoi\/avatars\/p1\/[0-9a-f]{32}\.webp$/);
    expect(row("p1").avatarUrl).toBe(avatarUrl);
    expect(row("p1").avatarKey).toMatch(/^avatars\/p1\//);
    expect(row("p1").avatarUrl!.startsWith("data:")).toBe(false);
    expect(storage.objects.size).toBe(1);
  });

  it("object lưu ra là WebP 256x256", async () => {
    await setAvatar("p1", await jpeg());
    const stored = [...storage.objects.values()][0];
    const meta = await sharp(stored.body).metadata();

    expect(stored.contentType).toBe("image/webp");
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
  });

  it("phát lại snapshot cho cả phòng sau khi upload", async () => {
    const { avatarUrl } = await setAvatar("p1", await jpeg());
    expect(applied.fn).toHaveBeenCalledWith("p1", avatarUrl);
  });

  it("đổi ảnh thì dọn object cũ và chỉ còn đúng một object", async () => {
    await setAvatar("p1", await jpeg({ r: 200, g: 60, b: 60 }));
    const firstKey = row("p1").avatarKey;

    await setAvatar("p1", await jpeg({ r: 60, g: 60, b: 200 }));

    expect(storage.objects.has(firstKey!)).toBe(false);
    expect(storage.objects.size).toBe(1);
    expect(storage.objects.has(row("p1").avatarKey!)).toBe(true);
  });

  it("file giả mạo MIME bị từ chối với mã 400", async () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

    await expect(setAvatar("p1", zip)).rejects.toMatchObject({ status: 400 });
    expect(row("p1").avatarUrl).toBeNull();
    expect(storage.objects.size).toBe(0);
  });

  it("ảnh hỏng bị từ chối với mã 400, mang đúng câu của image.ts chứ không phải câu chung", async () => {
    const png = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const broken = Buffer.concat([png.subarray(0, 40), Buffer.from("rác")]);

    // Buffer này QUA được sniffImageType (8 byte đầu vẫn đúng chữ ký PNG) nên
    // thật sự chạm tới processAvatar, và processAvatar ném AvatarImageError
    // với câu "Không đọc được ảnh, file có thể đã hỏng" (khác câu chung "Không
    // đọc được ảnh NÀY, hãy thử ảnh khác" ở service.ts) - assert đúng câu đó
    // để nếu ai xoá nhánh `err instanceof AvatarImageError ? …` trong
    // service.ts thì test này đỏ ngay, vì hai câu khác nhau ở chữ.
    await expect(setAvatar("p1", broken)).rejects.toMatchObject({
      status: 400,
      message: "Không đọc được ảnh, file có thể đã hỏng",
    });
    expect(storage.objects.size).toBe(0);
  });

  it(
    "ảnh vượt trần điểm ảnh bị từ chối với đúng câu \"quá lớn\", không phải câu ảnh hỏng",
    async () => {
      // Đây chính là ví dụ mở đầu cho luật ở Task 5: người upload ảnh
      // 9000x9000 không được nghe rằng file của họ "có thể đã hỏng" - đó là
      // một lời khuyên sai, ảnh này không hỏng, nó chỉ quá to. 7100x7100 =
      // 50.410.000 điểm ảnh, vượt trần MAX_INPUT_PIXELS = 50.000.000 của
      // image.ts một chút - đủ để trượt trần mà không phải dựng ảnh khổng lồ
      // tốn thời gian test.
      const huge = await sharp({
        create: { width: 7100, height: 7100, channels: 3, background: { r: 5, g: 5, b: 5 } },
      })
        .jpeg()
        .toBuffer();

      await expect(setAvatar("p1", huge)).rejects.toMatchObject({
        status: 400,
        message: "Ảnh có kích thước quá lớn, hãy thử ảnh nhỏ hơn",
      });
      expect(storage.objects.size).toBe(0);
    },
    20_000,
  );

  it("file giả mạo định dạng qua sniff bị chặn trước khi kịp đụng tới processAvatar", async () => {
    // sniffImageType (không phải processAvatar) là nơi chặn GIF - test này
    // không chứng minh gì về nhánh gộp/không-gộp thông điệp lỗi của
    // processAvatar (hai test ở trên mới làm việc đó); nó chỉ xác nhận rằng
    // hàng rào sniff nằm ở TRƯỚC decode, nên không có định dạng lạ nào chạm
    // được tới sharp.
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);

    await expect(setAvatar("p1", gif)).rejects.toMatchObject({
      status: 400,
      message: "Chỉ chấp nhận ảnh JPG, PNG hoặc WebP",
    });
  });

  it("ảnh vượt 5MB bị từ chối với mã 413, không chạm tới sniff/process/storage", async () => {
    // Cố tình KHÔNG phải ảnh thật: nhánh trần dung lượng nằm TRƯỚC
    // sniffImageType trong storeAvatar, nên một buffer rác đúng kích thước là
    // đủ - nếu hằng số MAX_AVATAR_UPLOAD_BYTES bị gõ nhầm (vd đổi đơn vị),
    // test này đỏ mà không cần mã hoá một ảnh 5MB thật.
    const tooBig = Buffer.alloc(MAX_AVATAR_UPLOAD_BYTES + 1);

    await expect(setAvatar("p1", tooBig)).rejects.toMatchObject({
      status: 413,
      message: "Ảnh quá lớn, tối đa 5MB",
    });
    expect(row("p1").avatarUrl).toBeNull();
    expect(storage.objects.size).toBe(0);
  });

  it("storage lỗi thì DB không đổi - avatar cũ còn nguyên", async () => {
    await setAvatar("p1", await jpeg());
    const before = { ...row("p1") };

    storage.failNextPut();
    await expect(setAvatar("p1", await jpeg())).rejects.toMatchObject({ status: 503 });

    expect(row("p1")).toEqual(before);
    expect(storage.objects.has(before.avatarKey!)).toBe(true);
  });

  it("DB lỗi thì object vừa upload bị dọn và avatar cũ còn nguyên", async () => {
    await setAvatar("p1", await jpeg());
    const before = { ...row("p1") };

    db.failUpdate = true;
    await expect(setAvatar("p1", await jpeg())).rejects.toThrow();
    db.failUpdate = false;

    expect(row("p1")).toEqual(before);
    expect(storage.objects.size).toBe(1);
    expect(storage.objects.has(before.avatarKey!)).toBe(true);
  });

  it("hai upload đồng thời để lại đúng một object, không có object mồ côi", async () => {
    // Dựng SẴN cả hai buffer rồi mới gọi: nếu để `await jpeg(...)` trong mảng
    // của Promise.all thì lần gọi thứ hai chỉ bắt đầu sau khi buffer thứ hai
    // mã hoá xong, và hai luồng có thể không hề chồng nhau - test sẽ xanh mà
    // không hề chạm tới compare-and-swap.
    const [a, b] = [await jpeg({ r: 200, g: 60, b: 60 }), await jpeg({ r: 60, g: 200, b: 60 })];

    await Promise.all([setAvatar("p1", a), setAvatar("p1", b)]);

    expect(storage.objects.size).toBe(1);
    expect(storage.objects.has(row("p1").avatarKey!)).toBe(true);
    expect(row("p1").avatarUrl).toBe(storage.publicUrl(row("p1").avatarKey!));
  });

  it("va chạm CAS được ép xảy ra thật: lượt thua đọc lại khoá mới rồi thử lại", async () => {
    // Test "hai upload đồng thời" ở trên chỉ đúng NẾU lịch chạy khiến hai
    // luồng chồng nhau - đo thực tế cho thấy trong môi trường này chúng
    // thường chạy nối tiếp (findUnique=2, updateMany=2, không va chạm lần
    // nào). Test này ép va chạm xảy ra CHẮC CHẮN bằng một cái chốt một lần
    // dùng (db.beforeUpdate) thay vì trông chờ vào độ trễ của sharp.

    // Có sẵn avatar để tranh chấp một khoá THẬT, không phải null.
    await setAvatar("p1", await jpeg({ r: 10, g: 200, b: 10 }));
    const oldKey = row("p1").avatarKey!;
    db.findUniqueCalls = 0; // chỉ đếm từ đoạn tranh chấp trở đi

    let releaseGate!: () => void;
    let signalGateEntered!: () => void;
    const gateEntered = new Promise<void>((resolve) => {
      signalGateEntered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    // Chốt này gắn vào đúng lệnh updateMany kế tiếp: đó sẽ là lệnh của lượt A,
    // vì A được start trước và test chỉ await gateEntered (không await hết A)
    // trước khi start B.
    db.beforeUpdate = () => {
      signalGateEntered();
      return gate;
    };

    const bufferA = await jpeg({ r: 250, g: 10, b: 10 });
    const bufferB = await jpeg({ r: 10, g: 10, b: 250 });

    // Lượt A: chạy processing + upload xong, gọi tới updateMany đầu tiên thì
    // bị chốt giữ lại - avatarKey nó đọc được (oldKey) đang bị đóng băng ở
    // đây, KHÔNG await toàn bộ uploadA nên test tiếp tục chạy song song.
    const uploadA = setAvatar("p1", bufferA);
    // Gắn một handler câm ngay bây giờ, KHÔNG phải để nuốt lỗi thật: lỗi thật
    // (nếu có) vẫn được báo bởi `await uploadA` bên dưới, promise gốc không
    // đổi trạng thái vì gắn thêm handler. Đây chỉ là chặn "unhandled
    // rejection" của Node xen ngang report khi assertion thật sự thất bại,
    // vì uploadA cố tình bị bỏ chưa await một đoạn trong lúc B chạy.
    uploadA.catch(() => {});
    await gateEntered;

    // Lượt B chạy trọn vẹn trong lúc A còn bị chặn: B đọc thấy oldKey y hệt A
    // đã đọc, swap thành công, và dọn oldKey.
    const resultB = await setAvatar("p1", bufferB);
    const keyB = row("p1").avatarKey!;
    expect(keyB).not.toBe(oldKey);
    expect(storage.objects.has(oldKey)).toBe(false);

    // Mở chốt: updateMany bị treo của A giờ mới thật sự so khớp avatarKey -
    // nhưng cột đó giờ là khoá của B, không còn là oldKey nữa, nên count === 0
    // và swapAvatar PHẢI lặp lại: đọc lại (thấy khoá của B), swap đè lên, dọn
    // khoá của B.
    releaseGate();
    const resultA = await uploadA;

    // 1) Thao tác thành công, không ném lỗi 409 hết lượt thử.
    expect(resultA.avatarUrl).toMatch(/^https:\/\/cdn\.test\/masoi\/avatars\/p1\/[0-9a-f]{32}\.webp$/);
    expect(resultA.avatarUrl).not.toBe(resultB.avatarUrl);
    // 2) DB trỏ đúng vào object của A - lượt thắng cuối cùng.
    expect(row("p1").avatarUrl).toBe(resultA.avatarUrl);
    expect(row("p1").avatarKey).not.toBe(keyB);
    // 3) Bucket chỉ còn đúng một object, đúng cái DB đang trỏ tới - khoá cũ
    // và khoá của B (đối tượng thua) đều đã bị dọn, không mồ côi.
    expect(storage.objects.size).toBe(1);
    expect(storage.objects.has(row("p1").avatarKey!)).toBe(true);
    expect(storage.objects.has(keyB)).toBe(false);
    // 4) Một va chạm THẬT đã xảy ra: findUnique phải chạy ít nhất 3 lần trong
    // đoạn này (A đọc lần 1 trước khi bị chặn, B đọc 1 lần, A đọc lại lần 2
    // sau khi bị từ chối) - một lượt chạy không va chạm chỉ cần 2.
    expect(db.findUniqueCalls).toBeGreaterThanOrEqual(3);
  });

  it("storage chưa cấu hình thì báo 503 chứ không sập", async () => {
    resetObjectStorage();

    await expect(setAvatar("p1", await jpeg())).rejects.toMatchObject({ status: 503 });
    expect(row("p1").avatarUrl).toBeNull();
  });
});

describe("clearAvatar", () => {
  it("xoá object của chính mình và đặt DB về null", async () => {
    await setAvatar("p1", await jpeg());

    await clearAvatar("p1");

    expect(row("p1").avatarUrl).toBeNull();
    expect(row("p1").avatarKey).toBeNull();
    expect(storage.objects.size).toBe(0);
    expect(applied.fn).toHaveBeenCalledWith("p1", null);
  });

  it("KHÔNG bao giờ đụng tới object của người khác", async () => {
    await setAvatar("p1", await jpeg());
    await setAvatar("p2", await jpeg());
    const otherKey = row("p2").avatarKey!;

    await clearAvatar("p1");

    expect(storage.objects.has(otherKey)).toBe(true);
    expect(row("p2").avatarUrl).not.toBeNull();
  });

  it("storage chưa cấu hình vẫn xoá được - DB sạch là đủ để coi là thành công", async () => {
    db.players.set("p1", { id: "p1", avatarUrl: "data:image/webp;base64,AAA", avatarKey: null });
    resetObjectStorage();

    await expect(clearAvatar("p1")).resolves.toBeUndefined();
    expect(row("p1").avatarUrl).toBeNull();
  });

  it("storage chưa cấu hình vẫn xoá được cả khi có avatarKey thật - delete() no-op không được ném", async () => {
    // Test ở trên đặt avatarKey: null nên swapAvatar không bao giờ gọi
    // objectStorage().delete() - nhánh "không ném" của adapter tắt (xem
    // disabledStorage trong storage/index.ts) chưa hề chạy, dù đó mới là lý
    // do THẬT khiến ràng buộc "clearAvatar luôn thành công" đứng vững. Ở đây
    // có avatarKey thật, nên swapAvatar CHẮC CHẮN đi vào nhánh gọi delete();
    // storage đã bị reset về "chưa cấu hình" nên đó là delete() no-op của
    // disabledStorage - đúng cái bất đối xứng put-ném/delete-im-lặng mà
    // clearAvatar dựa vào.
    await setAvatar("p1", await jpeg());
    expect(row("p1").avatarKey).not.toBeNull();
    resetObjectStorage();

    await expect(clearAvatar("p1")).resolves.toBeUndefined();
    expect(row("p1").avatarUrl).toBeNull();
    expect(row("p1").avatarKey).toBeNull();
  });

  it("xoá data URL cũ (không có avatarKey) chạy được", async () => {
    db.players.set("p1", { id: "p1", avatarUrl: "data:image/webp;base64,AAA", avatarKey: null });

    await clearAvatar("p1");

    expect(row("p1").avatarUrl).toBeNull();
  });
});

describe("AvatarError", () => {
  it("mang mã HTTP để route khỏi phải đoán", () => {
    const err = new AvatarError("Ảnh quá lớn", 413);
    expect(err.status).toBe(413);
    expect(err.message).toBe("Ảnh quá lớn");
  });
});
