"use client";

import { useEffect, useRef, useState } from "react";
import { getIdentity } from "@/lib/identity";
import {
  AVATAR_ACCEPT,
  deleteAvatar,
  uploadAvatar,
  validateAvatarFile,
} from "@/lib/avatar-upload";

interface Props {
  currentUrl?: string | null;
  /** Gọi khi thao tác xong, để chỗ đặt picker tự đóng lại. */
  onDone?: () => void;
}

/**
 * Chọn ảnh, xem trước, tải lên.
 *
 * Không crop và không encode gì ở đây nữa: server tự xoay theo EXIF, crop vuông,
 * thu về 256 và encode WebP. Trình duyệt chỉ còn hiển thị - preview dùng
 * createObjectURL chứ không phải data URL, nên không có chuỗi base64 nào được
 * dựng trong bộ nhớ tab.
 *
 * Ảnh hiện tại KHÔNG bị đụng cho tới khi server trả về thành công, nên một lần
 * tải hỏng giữa chừng không làm mất avatar đang có.
 */
export function AvatarPicker({ currentUrl, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Thu hồi object URL khi đổi ảnh hoặc rời component: mỗi createObjectURL giữ
  // nguyên tấm ảnh trong bộ nhớ tab cho tới khi được revoke.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const pick = (picked: File) => {
    const message = validateAvatarFile(picked);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setFile(picked);
    setPreviewUrl(URL.createObjectURL(picked));
  };

  const reset = () => {
    setFile(null);
    setPreviewUrl(null);
    setProgress(null);
  };

  const handleUpload = async () => {
    const identity = getIdentity();
    if (!file || !identity) return;

    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      await uploadAvatar(file, identity, setProgress);
      reset();
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tải ảnh thất bại");
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    const identity = getIdentity();
    if (!identity) return;

    setBusy(true);
    setError(null);
    try {
      await deleteAvatar(identity);
      reset();
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xoá ảnh thất bại");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) pick(picked);
          e.target.value = "";
        }}
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-50"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          📷 Chọn ảnh
        </button>
        {currentUrl && !file && (
          <button
            type="button"
            className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-mist/70 hover:bg-white/5 disabled:opacity-50"
            onClick={handleRemove}
            disabled={busy}
          >
            {busy ? "Đang xoá..." : "Xóa"}
          </button>
        )}
      </div>

      {previewUrl && (
        <div className="rounded-xl border border-white/10 bg-night-800 p-3">
          <p className="mb-1 text-xs text-mist/60">Xem trước — máy chủ sẽ cắt vuông 256×256:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Ảnh vừa chọn"
            className="mx-auto h-24 w-24 rounded-full object-cover ring-1 ring-white/10"
          />

          {progress !== null && (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-white/70 transition-[width] duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1 text-center text-[11px] text-mist/60">Đang tải lên {progress}%</p>
            </div>
          )}

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn-primary flex-1 text-xs"
              onClick={handleUpload}
              disabled={busy}
            >
              {busy ? "Đang tải..." : error ? "Thử lại" : "Tải lên"}
            </button>
            <button
              type="button"
              className="btn-secondary flex-1 text-xs"
              onClick={reset}
              disabled={busy}
            >
              Hủy
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-blood-400">{error}</p>}
      <p className="text-[11px] text-mist/60">JPG/PNG/WebP &lt;5MB, máy chủ tự cắt vuông 256px.</p>
    </div>
  );
}
