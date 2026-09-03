import { roleTeam, type DayVoteRecap, type Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotEvidence, BotRng, PublicEvidenceKind } from "../types";

/**
 * Chấm lại một phiên toà đã xử, SAU khi vai của người bị treo đã lộ.
 *
 * Đây là nửa còn thiếu của biến thể luật `revealRoleOnDeath`. Cờ đó đưa vai
 * người chết vào `knownRoles`, nhưng lõi quyết định chỉ tra bảng đó theo một
 * mục tiêu ĐANG SỐNG - `vote-decision`, `trial-decision`, `werewolf`,
 * `claim-decision` đều vậy - nên không chỗ nào suy ngược từ một cái xác. Hệ quả
 * đo được: `reveal-ab.ts` in ra Δ đúng bằng 0 ở mọi preset, tức bài đo không đo
 * được gì do cấu tạo chứ không do phát hiện.
 *
 * Suy luận ở đây là suy luận rẻ nhất mà cũng chắc nhất trong ván Ma Sói: phiếu
 * Treo/Tha là một lời cam kết NHỊ PHÂN, công khai, nhắm đúng một người. Khi vai
 * người đó lộ ra, mỗi lá phiếu tự chấm điểm cho chính người bỏ nó. Treo trúng
 * Sói là một phán đoán đúng; đẩy một người phe làng lên giá treo cổ là thứ mà
 * Sói làm cả ván, và bây giờ nó để lại dấu.
 *
 * Chỉ đọc `finalJudgment.ballots` chứ không đọc vòng đề cử: một lá phiếu đề cử
 * có thể là thăm dò, đổi ý, hay đơn giản là chưa đủ thông tin, còn phiếu Treo
 * là chốt hạ sau khi đã nghe biện hộ.
 *
 * KHÔNG dùng được khi `revealRoleOnDeath` tắt: lúc đó `knownRoles` không có vai
 * người chết, `analyzeRevealedVerdict` không bao giờ được gọi, và luật mặc định
 * chạy y hệt như trước. Ranh giới đó nằm ở chỗ gọi (`BotRuntime`), không phải ở
 * đây - hàm này thuần và chỉ biết cái vai được truyền vào.
 *
 * Quy ước dấu giống hệt phần còn lại của lõi: `weight > 0` trên thang suspicion
 * là buộc tội, `weight < 0` là gỡ tội, và `applyTrustEvidence` đảo dấu.
 */

/** Ai đã thật sự bị treo trong vòng này; `null` khi không có ai. */
export function lynchedIdOf(recap: DayVoteRecap): string | null {
  if (recap.nomination.kind !== "TRIAL") return null;
  if (recap.finalJudgment?.lynched !== true) return null;
  return recap.nomination.accusedId;
}

/**
 * Nguồn của mảnh bằng chứng là chính lá phiếu Treo/Tha đã được ghi thành memory
 * ở `writeRecapMemories`, không phải một id tổng hợp. `validateEvidence` từ
 * chối mọi nguồn chưa từng thấy, và hàng rào đó không được nới cho một tính
 * năng mới.
 */
export function finalBallotSourceId(round: number, voterId: string): string {
  return `${round}:final:${voterId}`;
}

export function analyzeRevealedVerdict(
  recap: DayVoteRecap,
  accusedRole: Role,
  analyticalSkill: number,
  rng: BotRng,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotEvidence[] {
  const accusedId = lynchedIdOf(recap);
  if (accusedId === null) return [];

  const accusedWasWolf = roleTeam(accusedRole) === "wolves";
  const found: BotEvidence[] = [];

  for (const ballot of recap.finalJudgment?.ballots ?? []) {
    // Bị cáo không bỏ phiếu về chính mình, nhưng đừng để luật đó là giả định
    // ngầm: nếu nó đổi thì mảnh bằng chứng ở đây sẽ vô nghĩa chứ không sai to.
    if (ballot.voterId === accusedId) continue;
    // Cùng cổng quan sát với `analyzeVoteRecap`: bot kém tinh ý bỏ SÓT tín
    // hiệu, chứ không bao giờ đọc ra một tín hiệu ngược.
    if (rng() >= analyticalSkill) continue;

    const right = ballot.guilty === accusedWasWolf;
    const kind: PublicEvidenceKind = right ? "VERDICT_HIT" : "VERDICT_MISS";
    const { weight, confidence } = weights.evidence[kind];
    const sourceId = finalBallotSourceId(recap.round, ballot.voterId);

    found.push({
      id: `${sourceId}:${kind}`,
      kind,
      sourceId,
      actorId: ballot.voterId,
      targetId: accusedId,
      weight: right ? -weight : weight,
      confidence,
      round: recap.round,
      summary: right
        ? `Bỏ phiếu ${ballot.guilty ? "Treo" : "Tha"} và hoá ra đã phán đoán đúng.`
        : `Bỏ phiếu ${ballot.guilty ? "Treo" : "Tha"} và hoá ra đã phán đoán sai.`,
    });
  }

  return found;
}
