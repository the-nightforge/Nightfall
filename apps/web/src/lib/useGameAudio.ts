"use client";

import { useEffect, useRef } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { cuesFor } from "./audio-cues";
import { audioEngine, installUnlockListener } from "./audio-engine";
import { loadSettings } from "./audio-settings";
import { trackFor } from "./audio-track";

/**
 * Nối snapshot của phòng vào engine âm thanh.
 *
 * Giữ snapshot trước trong ref chứ không phải state: nó chỉ là đầu vào để so
 * cạnh, đổi nó không cần render lại. Ref cũng sống xuyên qua lần rớt mạng, nhờ
 * vậy resync giữa pha không sinh cạnh nào và không phát lại tiếng cũ.
 */
export function useGameAudio(snapshot: RoomSnapshot | null): void {
  const previous = useRef<RoomSnapshot | null>(null);

  useEffect(() => {
    audioEngine.applySettings(loadSettings());
    const removeUnlock = installUnlockListener();
    return () => {
      removeUnlock();
      audioEngine.stop();
      previous.current = null;
    };
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    audioEngine.setTrack(trackFor(snapshot.phase));
    for (const cue of cuesFor(previous.current, snapshot)) {
      audioEngine.playCue(cue);
    }
    previous.current = snapshot;
  }, [snapshot]);
}
