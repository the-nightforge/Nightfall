"use client";

import { useEffect, useState } from "react";
import { audioEngine } from "@/lib/audio-engine";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type AudioSettings,
} from "@/lib/audio-settings";
import {
  DEFAULT_CINEMATIC_SETTINGS,
  loadCinematicSettings,
  saveCinematicSettings,
  type CinematicSettings,
} from "@/lib/cinematic-settings";

/**
 * Loa bật / loa tắt tiếng.
 *
 * Trước đây chỗ này là emoji 🔊 và 🔇, và đó là đúng cái lỗi mà `WolfMark.tsx`
 * và `EventGlyph.tsx` đã viết ra: mỗi hệ điều hành vẽ emoji một kiểu, không
 * nhận `currentColor` nên nó không mờ đi cùng cái nút khi âm thanh chưa mở
 * khoá, và trên Linux thiếu font emoji thì ra ô vuông trống ở NÚT ÂM THANH -
 * người chơi không còn cách nào đoán ra nó làm gì.
 *
 * Vẽ tay theo lưới 24 / stroke 2 như `MessageCircleIcon` trong `ChatBox`, để cả
 * web dùng chung MỘT bộ nét chứ không thêm dependency cho hai hình.
 */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-[1.15rem] w-[1.15rem]"
    >
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      {muted ? (
        <path d="m16 9 5 6m0-6-5 6" />
      ) : (
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
      )}
    </svg>
  );
}

export function SoundControl() {
  // Khởi tạo bằng mặc định chứ không đọc localStorage ngay: server render
  // không có localStorage, đọc ở đây sẽ lệch giữa server và client.
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_SETTINGS);
  const [cinematic, setCinematic] = useState<CinematicSettings>(DEFAULT_CINEMATIC_SETTINGS);
  const [unlocked, setUnlocked] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    setCinematic(loadCinematicSettings());
    setUnlocked(audioEngine.isUnlocked());
    return audioEngine.onUnlock(() => setUnlocked(true));
  }, []);

  function updateCinematic(patch: Partial<CinematicSettings>): void {
    const next = { ...cinematic, ...patch };
    setCinematic(next);
    saveCinematicSettings(next);
    // CinematicOverlay là component khác, không có state chung với chỗ này.
    // `storage` của trình duyệt chỉ bắn sang TAB KHÁC chứ không bắn cho chính
    // tab vừa ghi, nên phải tự gọi một tiếng.
    window.dispatchEvent(new Event("masoi:cinematic-settings"));
  }

  function update(patch: Partial<AudioSettings>): void {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
    audioEngine.applySettings(next);
  }

  return (
    <div className="relative">
      <button
        /* Bề ngang cố định 36px để nó đứng thành ô vuông cạnh `RulesDrawer`;
         * chiều cao 44px thì đến từ `.room-topbar button` nên cả hàng - mã
         * phòng, Mời, QR, hai nút vuông - bằng nhau đúng một con số. Một nút
         * thấp hơn vài pixel ở cuối hàng là thứ mắt bắt được ngay dù không gọi
         * tên ra được. `.room-topbar-icon` nới vùng chạm lên 44px bề ngang mà
         * không làm hàng dài thêm.
         *
         * Màu chữ đi hai nấc SÁNG, không phải một sáng một mờ.
         *
         * Trạng thái "chưa mở khoá tiếng" trước đây vẽ bằng `mist` ở 60% -
         * 4:1 trên nền night-800, dưới ngưỡng chữ thường và đúng cái ngưỡng mà
         * cả lượt sửa này đang dọn. Nó vẫn phải phân biệt được với trạng thái
         * thường, nên khoảng cách chuyển sang nằm giữa /85 (6.7:1) và
         * mist-bright (gần 11:1): mắt vẫn thấy một nấc, mà nấc thấp hơn thì đọc
         * được. Câu giải thích thật nằm ở `title`, không ở độ mờ. */
        className={`room-topbar-icon inline-flex w-9 items-center justify-center rounded-lg border border-night-600 bg-night-800 text-sm ${
          unlocked ? "text-mist-bright" : "text-mist/85"
        }`}
        onClick={() => setOpen((value) => !value)}
        title={unlocked ? "Âm thanh và chuyển cảnh" : "Chạm vào màn hình để bật tiếng"}
        aria-label="Âm thanh và chuyển cảnh"
        aria-expanded={open}
      >
        <SpeakerIcon muted={settings.muted} />
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-64 rounded-xl border border-night-600 bg-night-900 p-3 shadow-lg">
          <button
            className="mb-2 w-full rounded-lg bg-night-800 px-2 py-1 text-xs text-mist"
            onClick={() => update({ muted: !settings.muted })}
          >
            {settings.muted ? "Bật tiếng" : "Tắt tiếng"}
          </button>

          <label className="block text-xs text-mist/85">
            Nhạc nền
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.musicVolume}
              onChange={(event) => update({ musicVolume: Number(event.target.value) })}
              className="mt-1 w-full"
            />
          </label>

          <label className="mt-2 block text-xs text-mist/85">
            Hiệu ứng
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.sfxVolume}
              onChange={(event) => update({ sfxVolume: Number(event.target.value) })}
              className="mt-1 w-full"
            />
          </label>

          <label className="mt-3 flex cursor-pointer items-center justify-between gap-2 border-t border-white/[0.08] pt-2 text-xs text-mist/85">
            <span>
              Giảm chuyển cảnh
              <span className="block text-[11px] text-mist/85">
                Bỏ qua các đoạn chuyển pha, vào bàn ngay.
              </span>
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-blood-500"
              checked={cinematic.reduced}
              onChange={(event) => updateCinematic({ reduced: event.target.checked })}
            />
          </label>

          {!unlocked && (
            <p className="mt-2 text-[11px] text-mist/85">
              Trình duyệt chặn tiếng cho tới khi bạn chạm vào trang.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
