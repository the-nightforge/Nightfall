"use client";

import { useState } from "react";
import {
  MAX_PLAYERS_PER_ROOM,
  MIN_PLAYERS_TO_START,
  validateRoomConfig,
  type RoomConfig,
  type RoomSnapshot,
} from "@masoi/shared";
import type { Identity } from "@/lib/identity";
import { RoleDeckPanel } from "./RoleDeckPanel";

interface Props {
  snapshot: RoomSnapshot;
  identity: Identity;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onAddBot: () => void;
  onLeave: () => void;
  onUpdateConfig: (config: RoomConfig) => void;
}

/**
 * Khu giữa của phòng chờ.
 *
 * Danh sách người chơi KHÔNG ở đây nữa - nó là cột riêng bên trái, cùng một
 * component với lúc đang chơi, nên không còn hai cách trình bày người chơi phải
 * giữ cho khớp nhau.
 */
export function Lobby({
  snapshot,
  identity,
  onReady,
  onStart,
  onAddBot,
  onLeave,
  onUpdateConfig,
}: Props) {
  const isHost = snapshot.hostId === identity.playerId;
  const me = snapshot.players.find((p) => p.id === identity.playerId);
  const count = snapshot.players.length;
  const configError = validateRoomConfig(snapshot.config, count);
  const myReady = me?.ready ?? false;
  const unreadyGuests = snapshot.players.filter(
    (player) => !player.isBot && player.id !== snapshot.hostId && !player.ready,
  );
  const missing = Math.max(0, MIN_PLAYERS_TO_START - count);

  return (
    <div className="space-y-3">
      <RoleDeckPanel snapshot={snapshot} isHost={isHost} onUpdateConfig={onUpdateConfig} />

      {isHost && snapshot.voice && (
        <VoiceConfig config={snapshot.config} onSave={onUpdateConfig} />
      )}
      {isHost && <TimingConfig config={snapshot.config} onSave={onUpdateConfig} />}

      <div className="card space-y-2">
        {isHost ? (
          <>
            <button
              className="btn-primary w-full py-3 text-base"
              onClick={onStart}
              disabled={!!configError || count < MIN_PLAYERS_TO_START || unreadyGuests.length > 0}
            >
              Bắt đầu trận đấu
            </button>
            <button
              className="btn-secondary w-full"
              onClick={onAddBot}
              disabled={count >= MAX_PLAYERS_PER_ROOM}
            >
              + Thêm bot (để test một mình)
            </button>
          </>
        ) : (
          <button className="btn-primary w-full py-3 text-base" onClick={() => onReady(!myReady)}>
            {myReady ? "Huỷ sẵn sàng" : "Tôi đã sẵn sàng!"}
          </button>
        )}

        {/* Chỉ hiện đúng lý do đang chặn, theo thứ tự người chơi gặp phải. */}
        {missing > 0 ? (
          <p className="text-center text-xs text-mist/50">
            Chờ thêm {missing} người nữa để bắt đầu. Gửi mã{" "}
            <b className="font-mono text-white">{snapshot.code}</b> cho bạn bè.
          </p>
        ) : configError ? (
          <p className="text-center text-xs text-blood-400">{configError}</p>
        ) : isHost && unreadyGuests.length > 0 ? (
          <p className="text-center text-xs text-amber-300">
            Chờ {unreadyGuests.map((player) => player.name).join(", ")} sẵn sàng.
          </p>
        ) : null}

        <button className="btn-secondary w-full" onClick={onLeave}>
          Rời phòng
        </button>
      </div>
    </div>
  );
}

/**
 * Mốc thời gian từng pha. Vẫn giấu trong details: nó là thứ chỉnh một lần rồi
 * quên, không phải thứ cả phòng cần nhìn như bộ bài.
 */
function VoiceConfig({
  config,
  onSave,
}: {
  config: RoomConfig;
  onSave: (c: RoomConfig) => void;
}) {
  const on = config.voice === true;
  return (
    <div className="card flex flex-col gap-2">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="font-semibold text-white">🎙️ Trò chuyện bằng giọng nói</span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-blood-500"
          checked={on}
          onChange={(e) => onSave({ ...config, voice: e.target.checked })}
        />
      </label>
      <p className="text-xs text-mist/50">
        Chỉ dùng được ban ngày. Ban đêm và phe Sói vẫn nhắn bằng chữ.
      </p>
      {on && (
        <p className="text-xs text-amber-300/70">
          Lưu ý: giọng nói làm lộ bạn là ai, kể cả khi vai của bạn còn bí mật.
        </p>
      )}
    </div>
  );
}

/**
 * Công tắc voice chỉ hiện khi máy chủ có cấu hình LiveKit - `snapshot.voice`
 * vắng mặt nghĩa là server chưa bật, và khi đó bật công tắc chẳng có tác dụng
 * gì ngoài gây khó hiểu.
 */
function TimingConfig({
  config,
  onSave,
}: {
  config: RoomConfig;
  onSave: (c: RoomConfig) => void;
}) {
  const [draft, setDraft] = useState<RoomConfig>(config);
  const [dirty, setDirty] = useState(false);

  const set = (patch: Partial<RoomConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold text-white">
        Thời gian từng pha
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(
          [
            // Khoảng hợp lệ phải khớp roomConfigSchema; đặc biệt finalVoteSeconds
            // có cận dưới 15 vì chuỗi não bot mất tới 13 giây.
            ["nightSeconds", "Đêm", 15, 120],
            ["discussionSeconds", "Thảo luận", 30, 300],
            ["voteSeconds", "Bỏ phiếu sơ bộ", 15, 120],
            ["defenseSeconds", "Biện hộ", 10, 60],
            ["finalVoteSeconds", "Bỏ phiếu xác nhận", 15, 60],
          ] as const
        ).map(([key, label, min, max]) => (
          <label key={key} className="block text-sm">
            <span className="text-mist/80">
              {label} <span className="text-mist/40">({min}-{max}s)</span>
            </span>
            <input
              type="number"
              className="input mt-1"
              min={min}
              max={max}
              value={draft[key]}
              onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<RoomConfig>)}
            />
          </label>
        ))}
      </div>
      <button
        className="btn-primary mt-3 w-full"
        disabled={!dirty}
        onClick={() => {
          onSave(draft);
          setDirty(false);
        }}
      >
        Lưu thời gian
      </button>
    </details>
  );
}
