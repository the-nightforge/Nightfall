export type ShareStrategy = "files" | "text" | "clipboard" | "manual";

export interface ShareCapabilities {
  canShareFiles: boolean;
  canShare: boolean;
  canCopy: boolean;
}

export type ShareOutcome =
  | { kind: "shared" }
  | { kind: "copied" }
  | { kind: "manual" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/** Chỉ đúng phần `navigator` mà luồng chia sẻ chạm tới, để test tiêm được đồ giả. */
export interface ShareNavigatorLike {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText?: (text: string) => Promise<void> };
}

/**
 * Khả năng chia sẻ thật sự có, đọc từ trình duyệt.
 *
 * `file === null` (xuất ảnh hỏng) chỉ làm tắt nhánh gửi file, không làm mất
 * đường chia sẻ - đó là lý do điều kiện "có ảnh" nằm ngay trong `canShareFiles`
 * thay vì rải ra chỗ gọi.
 */
export function shareCapabilities(
  navigatorLike: ShareNavigatorLike | undefined,
  file: File | null,
): ShareCapabilities {
  if (!navigatorLike) return { canShareFiles: false, canShare: false, canCopy: false };

  const canShare = typeof navigatorLike.share === "function";
  let canShareFiles = false;
  if (canShare && file && typeof navigatorLike.canShare === "function") {
    try {
      canShareFiles = navigatorLike.canShare({ files: [file] });
    } catch {
      // Một số trình duyệt ném thay vì trả false khi không hiểu payload. Không
      // hỗ trợ file là một kết quả bình thường, không phải sự cố.
      canShareFiles = false;
    }
  }

  return {
    canShareFiles,
    canShare,
    canCopy: typeof navigatorLike.clipboard?.writeText === "function",
  };
}

export function pickShareStrategy(capabilities: ShareCapabilities): ShareStrategy {
  if (capabilities.canShareFiles) return "files";
  if (capabilities.canShare) return "text";
  if (capabilities.canCopy) return "clipboard";
  return "manual";
}

/**
 * Người dùng bấm huỷ bảng chia sẻ là một lựa chọn CỐ Ý, không phải sự cố.
 * Dựng toast đỏ cho nó là mắng người dùng vì đã đổi ý.
 */
export function classifyShareError(error: unknown): ShareOutcome {
  if (error instanceof Error && error.name === "AbortError") return { kind: "cancelled" };
  return { kind: "error", message: "Không chia sẻ được. Thử nút Sao chép tóm tắt." };
}

/** Lời nhắn cho người dùng; `null` nghĩa là im lặng. */
export function describeShareOutcome(outcome: ShareOutcome): string | null {
  switch (outcome.kind) {
    case "shared":
      return "Đã gửi hồ sơ đi.";
    case "copied":
      return "Đã sao chép tóm tắt vào bộ nhớ tạm.";
    case "manual":
      return "Trình duyệt không cho chép tự động. Hãy chọn đoạn dưới và sao chép thủ công.";
    case "cancelled":
      return null;
    case "error":
      return outcome.message;
  }
}
