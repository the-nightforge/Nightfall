"use client";

import { useEffect, useRef, useState } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import {
  LAST_LETTER_MAX_LENGTH,
  composerIntent,
  composerState,
  counterState,
  isConfirmed,
  type ComposerAction,
} from "@/lib/last-letter";

interface Props {
  snapshot: RoomSnapshot;
  /** `null` là lệnh XOÁ thư hiện tại, không phải một lần lưu rỗng. */
  onSave: (text: string | null) => void;
}

/**
 * Ô soạn Phong thư sau cùng.
 *
 * Điều kiện hiện ra KHÔNG được tính ở đây: `composerState` chỉ đọc lại cờ
 * `canEdit` mà server đã tính riêng cho người nhận snapshot này. Web tự kiểm
 * pha và trạng thái sống sẽ là bản sao thứ hai của cùng một luật - và bản ở đây
 * là bản không có quyền quyết định gì.
 *
 * KHÔNG giả lập lưu thành công. Sự kiện socket không có phản hồi trực tiếp, nên
 * bằng chứng duy nhất là snapshot kế tiếp mang đúng nội dung vừa gửi. Giữa hai
 * mốc đó nút nói "Đang lưu" và không bấm lại được - đúng cách `DayView` chờ xác
 * nhận cho một lá phiếu.
 *
 * KHÔNG autoFocus. Trên điện thoại nó bật bàn phím lên che mất nửa dưới màn
 * hình ngay khi ngày vừa bắt đầu, tức đúng lúc người chơi đang cần đọc chat.
 */
export function LastLetterComposer({ snapshot, onSave }: Props) {
  const state = composerState(snapshot);
  const saved = state.saved;

  const [draft, setDraft] = useState(saved ?? "");
  const [pending, setPending] = useState<ComposerAction>({ kind: "idle" });

  /*
   * Đồng bộ ô nhập theo SỰ THẬT của server, và chỉ khi sự thật đó đổi.
   *
   * Không phụ thuộc `draft`: gán lại theo từng lần render sẽ xoá chữ đang gõ dở.
   * `saved` chỉ đổi khi chính người này lưu hoặc xoá thành công - lúc đó `draft`
   * vốn đã khớp - hoặc khi snapshot đầu tiên sau một lần nối lại mang bản nháp
   * về, và đó chính là ca cần lấp lại ô nhập.
   */
  const syncedFrom = useRef<string | null>(saved);
  useEffect(() => {
    if (syncedFrom.current === saved) return;
    syncedFrom.current = saved;
    setDraft(saved ?? "");
  }, [saved]);

  // Snapshot đã mang đúng thứ vừa gửi -> hết chờ.
  useEffect(() => {
    if (pending.kind === "idle") return;
    if (isConfirmed(pending, saved)) {
      setPending({ kind: "idle" });
      return;
    }
    /*
     * Chốt chặn: server có thể từ chối (hết pha, vừa chết, quá nhanh) và khi đó
     * snapshot không bao giờ khớp. Không có hạn này thì nút kẹt ở "Đang lưu"
     * vĩnh viễn và người chơi mất luôn quyền sửa thư ở ngày sau.
     */
    const timer = setTimeout(() => setPending({ kind: "idle" }), 4_000);
    return () => clearTimeout(timer);
  }, [pending, saved]);

  if (!state.visible) return null;

  const counter = counterState(draft);
  const intent = composerIntent({ draft, saved, pending: pending.kind !== "idle" });
  const busy = pending.kind !== "idle";
  const sealed = saved !== null && draft.trim() === saved;

  const submit = (action: ComposerAction) => {
    if (action.kind === "idle") return;
    setPending(action);
    onSave(action.kind === "clear" ? null : action.text);
  };

  return (
    <div className="card border-amber-500/25 bg-amber-950/10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="font-bold text-amber-200">✉️ Phong thư sau cùng</h4>
        {/* Trạng thái là CHỮ, không phải một chấm màu: ảnh chụp đen trắng và
          * người mù màu vẫn phải đọc ra là thư đã được máy chủ giữ hay chưa. */}
        {sealed && !busy && (
          <span className="rounded-full border border-emerald-500/40 bg-emerald-900/25 px-2.5 py-0.5 text-xs font-bold text-emerald-200">
            Đã niêm phong
          </span>
        )}
      </div>

      <p className="mt-1 text-xs leading-relaxed text-mist/70">
        Chỉ được mở nếu bạn chết. Bạn có thể sửa lại vào ngày sau nếu còn sống.
      </p>

      <textarea
        className="input mt-2 min-h-[76px] resize-y"
        value={draft}
        // Trần cứng ở ô nhập để không ai gõ ra một lá thư chắc chắn bị từ chối.
        maxLength={LAST_LETTER_MAX_LENGTH}
        disabled={busy}
        placeholder="Điều bạn muốn để lại cho cả làng..."
        aria-label="Nội dung phong thư sau cùng"
        onChange={(event) => setDraft(event.target.value)}
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className={`text-[11px] ${counter.over ? "text-blood-400" : "text-mist/65"}`}>
          {counter.label}
        </span>
        <div className="flex gap-2">
          {saved !== null && (
            <button
              className="btn-tertiary-danger"
              disabled={busy}
              onClick={() => submit({ kind: "clear" })}
            >
              Xóa thư
            </button>
          )}
          <button
            className="btn-primary"
            disabled={busy || intent.kind === "idle"}
            onClick={() => submit(intent)}
          >
            {busy ? "Đang lưu..." : "Niêm phong"}
          </button>
        </div>
      </div>
    </div>
  );
}
