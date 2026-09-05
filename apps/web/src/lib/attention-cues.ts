import type { RoomSnapshot } from "@masoi/shared";

export type AttentionKind =
  | "NIGHT_TURN"
  | "VOTE_OPEN"
  | "ACCUSED"
  | "TRIAL_VOTE"
  | "HUNTER_TURN"
  | "DEATH"
  | "GAME_OVER";

/** Một việc đáng gọi người chơi quay lại tab. */
export interface Attention {
  kind: AttentionKind;
  /** Một dòng, đọc được ngay trên tiêu đề tab hay banner thông báo. */
  title: string;
  /** Dòng phụ trong thông báo hệ thống; có thể rỗng. */
  body: string;
}

/**
 * Những gì cần gọi người chơi chú ý khi snapshot đổi.
 *
 * Cùng nguyên tắc với `cuesFor` bên âm thanh: mọi mục đều là CẠNH giữa hai
 * snapshot, không phải trạng thái của snapshot mới. Server chỉ gửi snapshot,
 * nên xét theo trạng thái thì mỗi lần resync sau rớt mạng sẽ báo lại một
 * việc đã cũ - và một thông báo "tới lượt bạn" hiện lên khi người chơi vừa
 * bấm xong là thứ dạy họ bỏ qua mọi thông báo về sau.
 *
 * Khác với âm thanh, ở đây chỉ giữ những cạnh mà người đang Ở TAB KHÁC cần
 * biết: việc chờ chính họ làm, cái chết, và kết thúc ván. Tiếng hú vào đêm
 * hay tiếng lá phiếu của chính mình không có ở đây - người chơi đã ở trong
 * trang thì mới nghe được, còn người ở tab khác thì không cần biết đêm xuống
 * nếu đêm đó không có việc của họ.
 *
 * Thứ tự trả về cố định theo thứ tự khai báo để test khẳng định được; bên
 * giao chỉ dùng mục đầu làm tiêu đề.
 */
export function attentionFor(prev: RoomSnapshot | null, next: RoomSnapshot): Attention[] {
  if (!prev) return [];
  const me = next.you;
  if (!me) return [];

  const out: Attention[] = [];
  const changed = prev.round !== next.round || prev.phase !== next.phase;
  const started = (was: boolean | undefined, now: boolean | undefined) =>
    was !== true && now === true;

  if (started(prev.night?.canAct, next.night?.canAct)) {
    out.push({
      kind: "NIGHT_TURN",
      title: "Tới lượt bạn hành động đêm",
      body: "Chọn mục tiêu trước khi trời sáng.",
    });
  }

  if (changed && next.phase === "VOTING" && me.alive) {
    out.push({ kind: "VOTE_OPEN", title: "Làng đang bỏ phiếu", body: "Chọn người bạn nghi ngờ." });
  }

  if (changed && next.phase === "DEFENSE" && next.trial?.accusedId === me.id) {
    out.push({
      kind: "ACCUSED",
      title: "Bạn bị đưa ra xét xử",
      body: "Tới lượt bạn bào chữa trước làng.",
    });
  }

  // `canVote` đã gói "còn sống, không phải bị cáo, chưa bỏ phiếu" - đúng điều
  // kiện để có một nút mà bấm.
  if (changed && next.phase === "FINAL_VOTE" && next.trial?.canVote) {
    out.push({
      kind: "TRIAL_VOTE",
      title: "Treo hay tha?",
      body: `Làng đang phán quyết ${next.trial.accusedName}.`,
    });
  }

  if (started(prev.hunterShot?.canAct, next.hunterShot?.canAct)) {
    out.push({
      kind: "HUNTER_TURN",
      title: "Thợ Săn, chọn mục tiêu",
      body: "Bạn được bắn một phát trước khi rời làng.",
    });
  }

  if (changed) {
    const dead = deathsThisPhase(next);
    if (dead.length > 0) {
      const meDead = dead.some((p) => p.playerId === me.id);
      const names = dead.map((p) => p.name).join(", ");
      out.push(
        meDead
          ? { kind: "DEATH", title: "Bạn đã chết", body: "Bạn vẫn theo dõi và trò chuyện với người chết được." }
          : {
              kind: "DEATH",
              title: next.phase === "NIGHT_RESULT" ? "Trời sáng, có người chết" : "Làng vừa treo cổ",
              body: names,
            },
      );
    }
  }

  if (changed && next.phase === "GAME_OVER") {
    out.push({ kind: "GAME_OVER", title: "Ván đã kết thúc", body: "Xem ai thắng và lật bài cả làng." });
  }

  return out;
}

function deathsThisPhase(view: RoomSnapshot): Array<{ playerId: string; name: string }> {
  if (view.phase === "NIGHT_RESULT") return view.lastNightDeaths;
  if (view.phase === "ELIMINATION") return view.lastEliminated ? [view.lastEliminated] : [];
  return [];
}
