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
import {
  DEFAULT_LIVE_TRIAL_SETTINGS,
  applyLiveTrialSettings,
  loadLiveTrialSettings,
  type LiveTrialSettings,
} from "@/lib/live-trial-settings";

export function SoundControl() {
  // Khởi tạo bằng mặc định chứ không đọc localStorage ngay: server render
  // không có localStorage, đọc ở đây sẽ lệch giữa server và client.
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_SETTINGS);
  const [cinematic, setCinematic] = useState<CinematicSettings>(DEFAULT_CINEMATIC_SETTINGS);
  const [liveTrial, setLiveTrial] = useState<LiveTrialSettings>(DEFAULT_LIVE_TRIAL_SETTINGS);
  const [unlocked, setUnlocked] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    setCinematic(loadCinematicSettings());
    setLiveTrial(loadLiveTrialSettings());
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

  /*
   * Thiết lập CÁ NHÂN, không phải add-on của phòng.
   *
   * Không cần quyền host, không đụng tới luật, và hai người cùng phòng chọn
   * khác nhau là chuyện bình thường - người này xem sân khấu 3D, người kia xem
   * bảng phiếu như cũ, cả hai vẫn nhìn cùng một ván. Gạt giữa lúc đang xử cũng
   * không mất phiếu: `useLiveTrial` vẫn đọc snapshot suốt, chỉ là không vẽ.
   */
  function updateLiveTrial(enabled: boolean): void {
    const next = { ...liveTrial, enabled };
    setLiveTrial(next);
    applyLiveTrialSettings(next);
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
        className={`rounded-lg border border-night-600 bg-night-800 px-2 py-1 text-sm ${
          unlocked ? "text-mist" : "text-mist/60"
        }`}
        onClick={() => setOpen((value) => !value)}
        title={unlocked ? "Âm thanh và chuyển cảnh" : "Chạm vào màn hình để bật tiếng"}
        aria-label="Âm thanh và chuyển cảnh"
        aria-expanded={open}
      >
        {settings.muted ? "🔇" : "🔊"}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-64 rounded-xl border border-night-600 bg-night-900 p-3 shadow-lg">
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

          <label className="mt-3 flex cursor-pointer items-center justify-between gap-2 border-t border-white/[0.08] pt-2 text-xs text-mist/80">
            <span>
              Giảm chuyển cảnh
              <span className="block text-[11px] text-mist/60">
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

          <label className="mt-2 flex cursor-pointer items-center justify-between gap-2 border-t border-white/[0.08] pt-2 text-xs text-mist/80">
            <span>
              Phiên toà sống
              <span className="block text-[11px] text-mist/60">
                Sân khấu 3D cho pha biện hộ và bỏ phiếu xác nhận.
              </span>
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-blood-500"
              checked={liveTrial.enabled}
              onChange={(event) => updateLiveTrial(event.target.checked)}
            />
          </label>

          {!unlocked && (
            <p className="mt-2 text-[11px] text-mist/65">
              Trình duyệt chặn tiếng cho tới khi bạn chạm vào trang.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
