"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { QR_QUIET_ZONE, encodeQrMatrix, qrSvgPath, qrSvgSize } from "@/lib/qr-code";
import {
  buildInvitePayload,
  classifyInviteError,
  describeInviteOutcome,
  inviteCapabilities,
  pickInviteStrategy,
  type InviteOutcome,
  type InvitePayload,
} from "@/lib/room-share";
import { useModalFocus } from "@/lib/useModalFocus";

/**
 * Cụm mời bạn vào phòng, đặt ngay cạnh mã phòng trong thanh đầu trang.
 *
 * Component này KHÔNG chứa một quyết định nào: dựng link, chọn cách chia sẻ,
 * phân loại lỗi và chọn câu thông báo đều nằm ở `lib/room-share.ts`, mã QR nằm
 * ở `lib/qr-code.ts`. Đó là chủ ý - bộ test của web chạy bằng
 * `tsx --test src/lib/*.test.ts`, không có DOM, nên thứ gì nằm trong file .tsx
 * là thứ không có test hồi quy. Ở đây chỉ còn nối dây: navigator, clipboard,
 * và state của giao diện.
 *
 * Không dùng lại `CaseShareCard`: hai tính năng trùng nhau ở HÌNH DẠNG (thử Web
 * Share, tụt xuống clipboard, tụt tiếp xuống chép tay) chứ không trùng nội dung.
 * Hồ sơ vụ án gửi kèm ảnh PNG dựng bằng canvas và chỉ tồn tại ở màn kết thúc;
 * lời mời là một dòng link phải sống suốt cả ván. Ghép chúng lại thì mỗi lần
 * sửa câu chữ của bên này lại phải kiểm bên kia.
 *
 * `size` chỉ đổi cỡ hiển thị, không đổi một hành vi nào: "sm" là cụm nhỏ trong
 * thanh đầu trang lúc đang chơi, "lg" dành cho đầu trang phòng chờ - ở đó mã
 * phòng là thứ người ta phải đọc to lên cho bạn bè chép, mà ở cỡ sm nó là một
 * nút cùng cỡ với mọi nút khác và mắt không tìm ra.
 */
export function RoomInvite({ code, size = "sm" }: { code: string; size?: "sm" | "lg" }) {
  const large = size === "lg";
  /*
   * Origin đọc trong effect chứ không trong lúc render.
   *
   * Server render không có `window`, nên đọc lúc render sẽ cho ra hai cây DOM
   * khác nhau giữa server và client. Khởi tạo rỗng đúng bằng thứ server dựng
   * ra, rồi rót vào sau khi hydrate - cùng cách mà trang chủ xử lý `?code=`.
   */
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const payload = useMemo(() => buildInvitePayload(origin, code), [origin, code]);

  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);
  /*
   * Ô chép tay giữ cả một số thứ tự bên cạnh nội dung.
   *
   * Chỉ giữ chuỗi thì lần rơi xuống chép tay THỨ HAI với cùng một đường link
   * không làm state đổi, effect đưa focus bên dưới không chạy lại, và ô hiện ra
   * mà con trỏ vẫn nằm ở nút vừa bấm. Gặp đúng lỗi này khi bấm "Chép link"
   * trong lớp phủ QR sau khi đã một lần chép tay ở thanh đầu trang.
   */
  const [manual, setManual] = useState<{ text: string; seq: number } | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const manualText = manual?.text ?? null;

  const qrButtonRef = useRef<HTMLButtonElement>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);

  const status = outcome ? describeInviteOutcome(outcome) : null;

  /*
   * Mở ô chép tay xong thì đưa con trỏ vào đó và bôi đen sẵn.
   *
   * Người dùng rơi xuống nhánh này là vì trình duyệt đã từ chối chép hộ họ.
   * Bắt họ tự tìm ô, tự bôi đen một đường link dài là bỏ rơi họ ở đúng bước
   * cuối. Chạy trong effect chứ không ngay trong handler vì lúc handler chạy
   * thì `<textarea>` còn chưa được React dựng ra.
   */
  useEffect(() => {
    if (!manual) return;
    const field = manualRef.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.select();
    // Bám vào số thứ tự chứ không vào nội dung: xem lý do ở chỗ khai `manual`.
  }, [manual]);

  /** Một kết quả -> một câu thông báo, và mở ô chép tay đúng khi cần. */
  function apply(next: InviteOutcome, textForManual: string) {
    setOutcome(next);
    setManual((previous) =>
      next.kind === "manual" ? { text: textForManual, seq: (previous?.seq ?? 0) + 1 } : null,
    );
  }

  async function handleInvite() {
    if (!payload) return;
    setOutcome(null);

    const strategy = pickInviteStrategy(
      inviteCapabilities(typeof navigator === "undefined" ? undefined : navigator),
    );

    try {
      if (strategy === "share") {
        /*
         * Gửi đúng ba trường title/text/url và không gì khác.
         *
         * `payload` là hàm thuần của origin và mã phòng, nên không có đường nào
         * để playerId, token phiên hay dữ liệu vai trò đi kèm ra bảng chia sẻ
         * của hệ điều hành.
         */
        await navigator.share({ title: payload.title, text: payload.text, url: payload.url });
        apply({ kind: "shared" }, payload.url);
      } else if (strategy === "clipboard") {
        await navigator.clipboard.writeText(payload.url);
        apply({ kind: "copied-link" }, payload.url);
      } else {
        apply({ kind: "manual" }, payload.url);
      }
    } catch (error) {
      const classified = classifyInviteError(error);
      /*
       * Clipboard ném thì tụt xuống chép tay chứ không dựng lỗi đỏ.
       *
       * Safari và Firefox từ chối `writeText` khi lời gọi không nằm đủ gần một
       * cú bấm chuột, và đó là một hoàn cảnh có lối thoát: đưa link ra cho
       * người dùng tự chép. Riêng nhánh `share` bị người dùng huỷ thì `outcome`
       * là `cancelled` và màn hình im lặng.
       */
      if (classified.kind === "error" && strategy === "clipboard") {
        apply({ kind: "manual" }, payload.url);
      } else {
        apply(classified, payload.url);
      }
    }
  }

  /** Nút chép riêng, dùng chung cho mã phòng và cho link. */
  async function copy(text: string, kind: "copied-code" | "copied-link") {
    setOutcome(null);
    try {
      if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
        apply({ kind: "manual" }, text);
        return;
      }
      await navigator.clipboard.writeText(text);
      apply({ kind: kind }, text);
    } catch {
      apply({ kind: "manual" }, text);
    }
  }

  return (
    /*
     * Ở cỡ lg trên màn hẹp, cụm này chiếm trọn bề ngang và xếp thành hai hàng
     * CÓ CHỦ Ý: mã phòng một hàng, hai nút chia đôi hàng dưới.
     *
     * Để nó tự wrap thì ở màn 320 mã phòng và "Mời bạn bè" vừa lọt hàng trên,
     * còn "Mã QR" rơi xuống một mình và dạt về mép phải - đọc ra như một nút bị
     * bỏ quên chứ không như một hàng. Mã phòng cũng là thứ người ta đọc to lên
     * cho bạn chép, nên nó xứng đáng cả một hàng.
     *
     * Từ sm trở lên mọi thứ về đúng bản cũ: một hàng, dạt phải, cạnh tiêu đề.
     */
    <div
      className={`flex flex-col gap-1.5 ${large ? "items-stretch sm:items-end" : "items-end"}`}
    >
      {/* flex-wrap: trên màn 390 thanh đầu trang còn có nút âm thanh và huy
        * hiệu mất kết nối. Không cho xuống dòng thì bốn thứ đó bóp mã phòng
        * lại tới mức không đọc được. */}
      <div
        className={`flex flex-wrap items-center gap-1.5 ${
          large ? "justify-start sm:justify-end" : "justify-end"
        }`}
      >
        {/* Nhãn biến mất dưới sm: trên màn 390 thanh này còn phải chứa nút rời
          * phòng, ba nút mời và nút âm thanh. Ô mã phòng đã tự nói nó là gì
          * bằng phông monospace và giãn chữ, còn trình đọc màn hình thì đọc
          * `aria-label` của nút chứ không đọc nhãn này. */}
        <span className="hidden text-xs text-mist/80 sm:inline">Mã phòng:</span>
        <button
          /* Dưới sm ở cỡ lg: chiếm trọn một hàng, chữ nhỏ hơn một nấc. Đây là
           * thứ người ta đọc to lên cho bạn chép, nên nó không phải chen chỗ với
           * hai cái nút. min-h-11 giữ nguyên ở mọi cỡ - vùng chạm 44px. */
          className={`rounded-lg border border-night-600 bg-night-800 font-mono font-bold tracking-widest text-white transition hover:border-mist/40 hover:bg-night-700 active:bg-night-800 ${
            large
              ? "min-h-11 w-full px-3 py-1.5 text-lg sm:w-auto sm:px-4 sm:text-xl"
              : "min-h-9 px-3 py-1 text-sm"
          }`}
          onClick={() => void copy(code, "copied-code")}
          title="Bấm để sao chép mã phòng"
          aria-label={`Sao chép mã phòng ${code}`}
        >
          {code}
        </button>

        <button
          className={`btn-secondary px-3 py-1 text-sm ${
            large ? "min-h-11 flex-1 sm:flex-none" : "min-h-9"
          }`}
          onClick={() => void handleInvite()}
          disabled={!payload}
        >
          Mời bạn bè
        </button>

        <button
          ref={qrButtonRef}
          className={`btn-secondary px-3 py-1 text-sm ${
            large ? "min-h-11 flex-1 sm:flex-none" : "min-h-9"
          }`}
          onClick={() => setQrOpen(true)}
          disabled={!payload}
          aria-haspopup="dialog"
          aria-expanded={qrOpen}
        >
          Mã QR
        </button>
      </div>

      {/*
        * Thông báo và ô chép tay đi THEO lớp phủ khi lớp phủ đang mở.
        *
        * Chúng không được ở lại đây: modal đặt `inert` lên phần còn lại của
        * trang, nên một ô chép tay hiện ra ngoài đó vừa không focus được vừa bị
        * chính lớp phủ che đi - người dùng bấm "Chép link" trong modal, clipboard
        * bị chặn, và lối thoát duy nhất nằm ở nơi họ không với tới được.
        */}
      {!qrOpen && (
        <InviteStatus status={status} manualText={manualText} manualRef={manualRef} align="right" />
      )}

      {qrOpen && payload && (
        <QrModal
          payload={payload}
          triggerRef={qrButtonRef}
          onClose={() => setQrOpen(false)}
          onCopyLink={() => void copy(payload.url, "copied-link")}
          status={status}
          manualText={manualText}
          manualRef={manualRef}
        />
      )}
    </div>
  );
}

/**
 * Dòng thông báo cộng ô chép tay - một cặp, hai chỗ hiện.
 *
 * Tách ra thành component riêng vì nó phải xuất hiện được ở hai nơi (thanh đầu
 * trang, và bên trong lớp phủ QR) mà vẫn là MỘT bản: hai bản chép tay thì một
 * ngày nào đó chỉ một bản được sửa.
 *
 * Thẻ `<p>` luôn có mặt kể cả khi rỗng. `aria-live` chỉ đọc những thay đổi xảy
 * ra BÊN TRONG một vùng đã tồn tại từ trước; dựng cả thẻ lên cùng lúc với chữ
 * thì nhiều trình đọc màn hình bỏ qua lần đầu tiên - đúng lần người dùng cần
 * nghe nhất.
 */
function InviteStatus({
  status,
  manualText,
  manualRef,
  align,
}: {
  status: string | null;
  manualText: string | null;
  manualRef: React.RefObject<HTMLTextAreaElement | null>;
  align: "right" | "center";
}) {
  return (
    <>
      <p
        className={`text-xs text-mist/75 ${align === "right" ? "text-right" : "text-center"}`}
        role="status"
        aria-live="polite"
      >
        {status}
      </p>

      {manualText !== null && (
        <div className={align === "right" ? "w-full max-w-xs" : "mt-2 w-full"}>
          <label htmlFor="invite-manual" className="mb-1 block text-left text-xs text-mist/70">
            Chép thủ công:
          </label>
          <textarea
            id="invite-manual"
            ref={manualRef}
            className="input h-16 font-mono text-xs"
            readOnly
            value={manualText}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
    </>
  );
}

/**
 * Lớp phủ mã QR.
 *
 * Mã vẽ bằng SVG dựng ngay tại chỗ, không phải `<img>` trỏ ra một dịch vụ sinh
 * QR: không có request mạng nào rời máy người dùng, không có ảnh nào tự tải,
 * không xin quyền camera hay bất cứ quyền gì - và mã phòng không bị gửi tới
 * một bên thứ ba chỉ để lấy về một tấm ảnh.
 *
 * `useModalFocus` lo Escape, bẫy Tab, `inert` phần trang phía sau và trả focus
 * về nút mở. Đó là cùng cơ chế mà tấm trượt chat trên điện thoại đang dùng.
 */
function QrModal({
  payload,
  triggerRef,
  onClose,
  onCopyLink,
  status,
  manualText,
  manualRef,
}: {
  payload: InvitePayload;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onCopyLink: () => void;
  status: string | null;
  manualText: string | null;
  manualRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useModalFocus({
    active: true,
    roots: [panelRef],
    initialFocus: closeRef,
    // Nút mở vẫn còn trong tài liệu lúc lớp phủ mở, nhưng nói rõ vẫn hơn: nó
    // nằm trong vùng bị `inert`, và trình duyệt có thể đã đẩy focus về body.
    restoreTo: triggerRef,
    onEscape: onClose,
  });

  const { path, size } = useMemo(() => {
    const matrix = encodeQrMatrix(payload.url);
    return { path: qrSvgPath(matrix), size: qrSvgSize(matrix) };
  }, [payload.url]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/80 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* max-w-sm + w-full: trên màn 390 lớp phủ còn đúng 16px lề mỗi bên, và
        * mã QR co theo bề rộng chứ không tràn ra ngoài. */}
      <div
        ref={panelRef}
        className="card w-full max-w-sm bg-night-900/95 text-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-title"
      >
        <h2 id="qr-title" className="font-display text-lg font-bold text-white">
          Quét để vào phòng
        </h2>

        {/*
          * Nền TRẮNG là bắt buộc, không phải lựa chọn thẩm mỹ.
          *
          * Cả giao diện là tông đêm, nhưng bộ dò QR trên điện thoại trông chờ ô
          * tối trên nền sáng. Đảo màu thì phần lớn camera không bắt được. Đây là
          * đúng một ô trắng giữa màn hình tối, và nó phải như vậy.
          */}
        <div className="mx-auto mt-3 w-full max-w-[240px] rounded-xl bg-white p-3">
          <svg
            viewBox={`0 0 ${size} ${size}`}
            className="h-auto w-full"
            role="img"
            aria-label={`Mã QR chứa link mời vào phòng ${payload.code}`}
            shapeRendering="crispEdges"
          >
            {/* Vùng yên tĩnh vẽ thành nền trắng của chính SVG: nếu chỉ dựa vào
              * padding của thẻ cha thì một lần đổi class là mã hết quét được. */}
            <rect width={size} height={size} fill="#ffffff" />
            <path d={path} fill="#000000" />
          </svg>
        </div>

        <p className="mt-3 text-xs text-mist/70">Hoặc nhập mã phòng</p>
        <p className="font-mono text-2xl font-bold tracking-[0.3em] text-white">{payload.code}</p>

        {/* break-all: link production dài hơn bề ngang màn 390, và một dòng
          * không xuống được sẽ đẩy cả lớp phủ trượt ngang. */}
        <p className="mt-2 break-all text-[11px] text-mist/55">{payload.url}</p>

        <div className="mt-4 flex gap-2">
          <button className="btn-secondary min-h-11 flex-1" onClick={onCopyLink}>
            Chép link
          </button>
          <button ref={closeRef} className="btn-primary min-h-11 flex-1" onClick={onClose}>
            Đóng
          </button>
        </div>

        <div className="mt-2">
          <InviteStatus
            status={status}
            manualText={manualText}
            manualRef={manualRef}
            align="center"
          />
        </div>
      </div>
    </div>
  );
}
