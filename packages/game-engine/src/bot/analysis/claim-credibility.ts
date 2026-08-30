import type { DayVoteRecap, Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotEvidence, BotMemory } from "../types";

/**
 * Uy tín của một lời khai, dựng từ dữ liệu CÔNG KHAI và chỉ từ đó.
 *
 * Module này KHÔNG import và không nhận `knownRoles`, `knownInformation`, hay
 * bất cứ thứ gì engine đã lọc theo vai. Ranh giới đó là thứ phân biệt một cái
 * làng đoán giỏi với một cái làng ăn gian, và người chơi sẽ CẢM THẤY sự khác
 * biệt kể cả khi không chỉ ra được nó.
 *
 * Uy tín ở đây không phải một con số. `validateEvidence` từ chối mọi bằng
 * chứng không có nguồn thật, nên không có chỗ nào để giữ một điểm trôi nổi rồi
 * nhân ngược vào những bằng chứng cũ - và sửa điểm cũ vốn đã là viết lại lịch
 * sử. Thay vào đó, mỗi tín hiệu là một MẢNH bằng chứng neo vào một sự kiện có
 * thật, phát ra đúng lúc sự kiện đó xảy ra. Làng không chấm điểm lời khai; làng
 * quan sát nó qua thời gian.
 *
 * Quy ước dấu, giống hệt phần còn lại của lõi: `weight > 0` trên thang
 * suspicion là buộc tội, `weight < 0` là gỡ tội - và `applyTrustEvidence` đảo
 * dấu, nên một mảnh gỡ tội tự động làm tin tưởng tăng.
 */

/** Vai mà bầy Sói buộc phải cắn ngay khi nó lộ mặt. */
const POWER_ROLES = new Set<Role>(["SEER", "APPRENTICE_SEER", "DETECTIVE", "WITCH", "GUARD", "HUNTER"]);

/**
 * Cổng duy nhất cho "vai đủ nặng để nói lên điều gì đó về người khai".
 *
 * Dùng ở đúng hai chỗ: nửa tin cậy của S1 và toàn bộ S2. Cả hai đọc CÙNG một
 * câu hỏi - "lời khai này có cõng rủi ro thật không" - nên chúng dùng chung
 * một cổng thay vì mỗi chỗ tự lặp lại điều kiện.
 *
 * RULING (task 6): `decideRoleClaim` ("Ngày Sự Thật") làm gần cả bàn khai
 * VILLAGER - Sói lẫn vai quyền lực đều nấp sau nó, trừ đúng Tiên Tri đang cầm
 * kết quả soi trúng Sói. Một bàn 12 người vì vậy sinh ra ~12 `ROLE_CLAIM` cùng
 * khai VILLAGER. Không có cổng này, S2 sẽ đọc mười hai lời khai giống hệt nhau
 * là "va chạm" và nghi ngờ cả bàn vì một sự kiện hoàn toàn bình thường, còn S1
 * sẽ thưởng tin cậy cho một lời khai không hề đặt cược gì. Nửa BUỘC TỘI của S1
 * không đi qua cổng này: nó đo việc lời khai có chỉ mặt ai không, chứ không đo
 * vai được khai là gì.
 */
function isPowerRoleClaim(claim: BotMemory): boolean {
  return POWER_ROLES.has(claim.data.role as Role);
}

export interface ClaimSignalInput {
  claims: readonly BotMemory[];
  round: number;
  lastNightDeaths: readonly { playerId: string; name: string }[];
  publicVoteHistory: readonly DayVoteRecap[];
  seenEventIds: readonly string[];
}

function evidence(
  kind: "ROLE_CLAIM" | "COUNTER_CLAIM",
  sourceId: string,
  idSuffix: string,
  subjectId: string,
  aboutId: string,
  round: number,
  weight: number,
  confidence: number,
  summary: string,
): BotEvidence {
  return {
    id: `${sourceId}:${kind}:${idSuffix}`,
    kind,
    sourceId,
    // `actorId` là CHỦ THỂ của niềm tin - `updateBelief` khoá bảng theo trường
    // này. Đọc nó như "người đang bị/được nói tới", không phải "người đã làm".
    actorId: subjectId,
    targetId: aboutId,
    weight,
    confidence,
    round,
    summary,
  };
}

export function claimEvidence(
  input: ClaimSignalInput,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotEvidence[] {
  const tuning = weights.claim;
  if (tuning.accusationWeight <= 0) return [];

  const seen = new Set(input.seenEventIds);
  const found: BotEvidence[] = [];
  const push = (item: BotEvidence) => {
    // Neo hỏng thì bỏ mảnh đó, đừng để `applyEvidence` ném ở tận chỗ gọi.
    // `seenEventIds` có trần, nên một message id đủ cũ SẼ biến mất.
    if (seen.has(item.sourceId)) found.push(item);
  };

  const roleClaims = input.claims.filter((memory) => memory.type === "ROLE_CLAIM");
  const confidence = weights.evidence.ROLE_CLAIM.confidence;

  // ---- S1: thời điểm ----
  for (const claim of roleClaims) {
    const underFire = claim.data.underFire === true;
    const factor = underFire ? tuning.underFireFactor : 1;

    // Nửa buộc tội: áp dụng cho MỌI lời khai chỉ mặt ai đó, không riêng vai
    // quyền lực. Đây là điều RULING giữ nguyên - nó đo việc bị nêu tên, không
    // đo vai được khai.
    if (claim.targetId) {
      push(
        evidence(
          "ROLE_CLAIM",
          claim.sourceId,
          "accused",
          claim.targetId,
          claim.actorId,
          claim.round,
          tuning.accusationWeight * factor,
          confidence,
          underFire
            ? "Bị một người đang bị dồn phiếu chỉ mặt khi họ khai vai."
            : "Bị một người tự nhận vai chức năng chỉ đích danh.",
        ),
      );
    }

    // Nửa tin cậy: chỉ vai quyền lực mới thật sự đặt cược mạng sống khi khai,
    // nên chỉ nó mới đáng được thưởng tin cậy. Xem `isPowerRoleClaim`.
    if (!isPowerRoleClaim(claim)) continue;

    push(
      evidence(
        "ROLE_CLAIM",
        claim.sourceId,
        "claimant",
        claim.actorId,
        claim.actorId,
        claim.round,
        -tuning.claimantTrustWeight * factor,
        confidence,
        "Công khai nhận một vai và chịu rủi ro đi kèm.",
      ),
    );
  }

  // ---- S2: va chạm ----
  //
  // Chỉ xét vai quyền lực - xem `isPowerRoleClaim`. Mọi lời khai VILLAGER
  // (gần cả bàn, mỗi Ngày Sự Thật) bị loại trước khi vào đây, nên chúng không
  // bao giờ được đọc thành một cú va chạm.
  //
  // Sắp theo (vòng, sourceId) chứ không theo thứ tự chèn: thứ tự chèn phụ thuộc
  // lịch quan sát, mà một chuỗi phụ thuộc lịch thì không replay được.
  const byRole = new Map<string, BotMemory[]>();
  for (const claim of roleClaims) {
    if (!isPowerRoleClaim(claim)) continue;
    const role = String(claim.data.role);
    byRole.set(role, [...(byRole.get(role) ?? []), claim]);
  }
  for (const [role, group] of byRole) {
    if (group.length < 2) continue;
    const ordered = [...group].sort(
      (a, b) => a.round - b.round || a.sourceId.localeCompare(b.sourceId),
    );
    ordered.forEach((claim, index) => {
      // Người đến sau chịu nặng hơn: phản ứng lại một lời khai rẻ hơn nhiều so
      // với việc đi trước, nên nó cũng đáng tin hơn ít.
      const scale = index === 0 ? 1 : tuning.collisionLatePenaltyScale;
      push(
        evidence(
          "COUNTER_CLAIM",
          // Neo vào lời khai ĐẾN SAU: va chạm chỉ tồn tại từ khoảnh khắc đó.
          ordered.at(-1)!.sourceId,
          `collision:${role}:${claim.actorId}`,
          claim.actorId,
          claim.actorId,
          ordered.at(-1)!.round,
          tuning.collisionPenalty * scale,
          confidence,
          `Có người khác cũng nhận là ${role}, nên ít nhất một trong hai đang nói dối.`,
        ),
      );
    });
  }

  // ---- S3: kiểm chứng bằng đêm ----
  //
  // Không ai chết thì KHÔNG có tín hiệu, và đó là một quyết định chứ không phải
  // một thiếu sót: Bảo Vệ và Phù Thuỷ cũng làm ra đúng cảnh đó.
  if (input.lastNightDeaths.length > 0) {
    const died = new Set(input.lastNightDeaths.map((death) => death.playerId));
    for (const claim of roleClaims) {
      if (!POWER_ROLES.has(claim.data.role as Role)) continue;
      // Chỉ xét lời khai của các vòng TRƯỚC: khai xong đêm chưa qua thì chưa có
      // gì để kiểm.
      if (claim.round >= input.round) continue;

      if (died.has(claim.actorId)) {
        push(
          evidence(
            "ROLE_CLAIM",
            `night-death:${input.round}:${claim.actorId}`,
            "night-confirm",
            claim.actorId,
            claim.actorId,
            input.round,
            -tuning.nightConfirmBonus,
            confidence,
            "Khai vai chức năng rồi bị cắn ngay đêm đó, đúng như bầy Sói phải làm.",
          ),
        );
        continue;
      }

      // Sống, mà có người khác chết. Neo vào cái chết của NGƯỜI KIA - nó là sự
      // kiện có thật vừa xảy ra, và nó chắc chắn còn trong `seenEventIds`.
      const other = input.lastNightDeaths[0]!;
      push(
        evidence(
          "ROLE_CLAIM",
          `night-death:${input.round}:${other.playerId}`,
          `night-survived:${claim.actorId}`,
          claim.actorId,
          claim.actorId,
          input.round,
          tuning.nightSurvivedPenalty,
          confidence,
          "Khai vai chức năng mà đêm qua vẫn sống, trong khi người khác chết thay.",
        ),
      );
    }
  }

  // ---- S4: nhất quán với lịch sử phiếu ----
  for (const recap of input.publicVoteHistory) {
    if (recap.round <= 0) continue;
    for (const claim of roleClaims) {
      if (!claim.targetId || claim.round > recap.round) continue;
      const votedRight = recap.mutations.some(
        (mutation) =>
          mutation.voterId === claim.actorId &&
          mutation.choice.type === "PLAYER" &&
          mutation.choice.targetId === claim.targetId,
      );
      if (votedRight) continue;
      push(
        evidence(
          "ROLE_CLAIM",
          `recap:${recap.round}`,
          `inconsistent:${claim.actorId}`,
          claim.actorId,
          claim.actorId,
          recap.round,
          tuning.voteInconsistencyPenalty,
          confidence,
          "Chỉ mặt một người là Sói rồi lại không bỏ phiếu treo chính người đó.",
        ),
      );
    }
  }

  return found;
}
