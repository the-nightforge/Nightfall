"use client";

import { useRef, useState } from "react";

interface Props {
  currentUrl?: string | null;
  onSave: (avatarUrl: string | null) => void;
}

export function AvatarPicker({ currentUrl, onSave }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    if (file.size > 5 * 1024 * 1024) {
      setError("Ảnh phải < 5MB");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Chỉ chấp nhận file ảnh");
      return;
    }
    const dataUrl = await fileToCroppedDataUrl(file, 256);
    if (!dataUrl) {
      setError("Không đọc được ảnh");
      return;
    }
    if (BufferByteLength(dataUrl) > 5 * 1024 * 1024) {
      setError("Ảnh sau crop vẫn quá lớn");
      return;
    }
    setPreview(dataUrl);
  };

  const handleSave = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      await onSave(preview);
      setPreview(null);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    try {
      await onSave(null);
      setPreview(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/15"
          onClick={() => inputRef.current?.click()}
        >
          📷 Chọn ảnh
        </button>
        {currentUrl && (
          <button
            type="button"
            className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-mist/70 hover:bg-white/5"
            onClick={handleRemove}
            disabled={saving}
          >
            Xóa
          </button>
        )}
      </div>
      {preview && (
        <div className="rounded-xl border border-white/10 bg-night-800 p-3">
          <p className="mb-1 text-xs text-mist/60">Xem trước (256×256, tự crop vuông):</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="preview" className="mx-auto h-24 w-24 rounded-full object-cover ring-1 ring-white/10" />
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primary flex-1 text-xs" onClick={handleSave} disabled={saving}>
              {saving ? "Đang lưu..." : "Lưu"}
            </button>
            <button type="button" className="btn-secondary flex-1 text-xs" onClick={() => setPreview(null)}>
              Hủy
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-blood-400">{error}</p>}
      <p className="text-[11px] text-mist/40">JPG/PNG/WebP &lt;5MB, tự crop vuông 256px.</p>
    </div>
  );
}

async function fileToCroppedDataUrl(file: File, size: number): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      resolve(canvas.toDataURL("image/webp", 0.85));
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

function BufferByteLength(str: string): number {
  return new Blob([str]).size;
}
