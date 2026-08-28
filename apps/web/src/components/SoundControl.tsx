"use client";

import { useEffect, useState } from "react";
import { audioEngine } from "@/lib/audio-engine";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type AudioSettings,
} from "@/lib/audio-settings";

export function SoundControl() {
  // Khởi tạo bằng mặc định chứ không đọc localStorage ngay: server render
  // không có localStorage, đọc ở đây sẽ lệch giữa server và client.
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_SETTINGS);
  const [unlocked, setUnlocked] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    setUnlocked(audioEngine.isUnlocked());
    return audioEngine.onUnlock(() => setUnlocked(true));
  }, []);

  function update(patch: Partial<AudioSettings>): void {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
    audioEngine.applySettings(next);
  }

  return (
    <div className="relative">
      <button
        className={`rounded-lg border border-night-600 bg-night-800 px-2 py-1 text-sm ${
          unlocked ? "text-mist" : "text-mist/40"
        }`}
        onClick={() => setOpen((value) => !value)}
        title={unlocked ? "Âm thanh" : "Chạm vào màn hình để bật tiếng"}
      >
        {settings.muted ? "🔇" : "🔊"}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-56 rounded-xl border border-night-600 bg-night-900 p-3 shadow-lg">
          <button
            className="mb-2 w-full rounded-lg bg-night-800 px-2 py-1 text-xs text-mist"
            onClick={() => update({ muted: !settings.muted })}
          >
            {settings.muted ? "Bật tiếng" : "Tắt tiếng"}
          </button>

          <label className="block text-xs text-mist/70">
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

          <label className="mt-2 block text-xs text-mist/70">
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

          {!unlocked && (
            <p className="mt-2 text-[10px] text-mist/50">
              Trình duyệt chặn tiếng cho tới khi bạn chạm vào trang.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
