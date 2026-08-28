"use client";

import { useState } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { hunterShotOutcomeText, legalHunterShotTargets } from "@/lib/hunter-shot";
import { PlayerGrid } from "./PlayerGrid";

interface Props {
  snapshot: RoomSnapshot;
  onShoot: (targetId: string | null) => void;
}

export function HunterShotPanel({ snapshot, onShoot }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const reaction = snapshot.hunterShot;

  if (!reaction) {
    return (
      <div className="card text-center text-mist/70">
        Đang đồng bộ lượt phản kích của Thợ Săn…
      </div>
    );
  }

  if (reaction.resolved) {
    const outcome = hunterShotOutcomeText(reaction);
    return (
      <div className="card text-center">
        <p className="text-3xl">🔫</p>
        <p className="mt-2 font-semibold text-amber-200">
          {outcome}
        </p>
        <p className="mt-1 text-sm text-mist/60">Đang xử lý kết quả…</p>
      </div>
    );
  }

  if (!reaction.canAct || snapshot.you?.role !== "HUNTER") {
    return (
      <div className="card text-center">
        <p className="text-3xl">🎯</p>
        <p className="mt-2 font-semibold text-amber-200">
          {reaction.hunterName} đang chọn người để bắn…
        </p>
        <p className="mt-1 text-sm text-mist/60">Vui lòng chờ lượt phản kích kết thúc.</p>
      </div>
    );
  }

  const targets = legalHunterShotTargets(snapshot);
  const legalIds = new Set(targets.map((player) => player.id));
  const disabledIds = snapshot.players
    .filter((player) => !legalIds.has(player.id))
    .map((player) => player.id);
  const canShootSelected = selectedId !== null && legalIds.has(selectedId);

  const submit = (targetId: string | null) => {
    if (submitted) return;
    setSubmitted(true);
    onShoot(targetId);
  };

  return (
    <div className="card">
      <div className="mb-3 text-center">
        <p className="text-3xl">🔫</p>
        <h2 className="mt-1 font-bold text-amber-200">Lượt phản kích của bạn</h2>
        <p className="text-sm text-mist/70">
          Chọn một người còn sống để bắn, hoặc chủ động không bắn ai.
        </p>
      </div>

      <PlayerGrid
        snapshot={snapshot}
        selectable={!submitted}
        selectedId={selectedId}
        onSelect={(playerId) => {
          if (!submitted && legalIds.has(playerId)) setSelectedId(playerId);
        }}
        disabledIds={disabledIds}
      />

      <button
        className="btn-primary mt-3 w-full"
        disabled={submitted || !canShootSelected}
        onClick={() => {
          if (canShootSelected) submit(selectedId);
        }}
      >
        {submitted ? "Đã gửi lựa chọn" : "Bắn người này"}
      </button>
      <button
        className="btn-secondary mt-2 w-full"
        disabled={submitted}
        onClick={() => submit(null)}
      >
        Không bắn ai
      </button>

      {submitted && (
        <p className="mt-2 text-center text-xs text-emerald-300">
          Đã gửi lựa chọn. Đang chờ máy chủ xử lý…
        </p>
      )}
    </div>
  );
}
