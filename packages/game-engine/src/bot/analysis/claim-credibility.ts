import { isPowerRole, isRole, ROLE_META, type DayVoteRecap, type Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { profileStrength, type BotEvidence, type BotMemory, type PlayerProfile } from "../types";

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

/**
 * Tên vai để ĐỌC, không phải mã vai.
 *
 * Câu tóm tắt của bằng chứng đi thẳng vào chỗ trống `{evidence}` của bảng mẫu
 * và vào prompt, tức nó RA TỚI KHUNG CHAT. Một chữ `GUARD` ở đó là một con BOT
 * nói giữa phòng "có người khác cũng nhận là GUARD".
 *
 * Lỗi này sống trong repo tới tận PR 9 và không test nào bắt được, vì mọi phép
 * đo đều chạy trên dữ liệu có cấu trúc chứ không ai ĐỌC câu chữ. Bộ biên bản
 * của §27 bắt nó ở lần chạy đầu tiên - xem `docs/bot-communication-human-eval.md`.
 *
 * `isRole` chặn ở biên: khoá của `byRole` là `string`, và một mã vai đã bị xoá
 * khỏi bộ bài vẫn có thể nằm trong ván cũ.
 */
function roleLabel(role: string): string {
  return isRole(role) ? ROLE_META[role].name : role;
}

/*
 * CỔNG "VAI QUYỀN LỰC" - `isPowerRole` của `@masoi/shared`.
 *
 * Tập đó được `claim-decision.ts` dùng CHUNG - xem chú thích ở đó. Trước đây
 * mỗi file giữ một tập riêng và chúng đã lệch: `PRIEST` nằm trong danh sách vai
 * Sói nấp sau nhưng không nằm trong tập của file này, nên đúng lời nói dối an
 * toàn nhất lại là lời mô hình uy tín mù hoàn toàn.
 *
 * Dùng ở ba chỗ: nửa tin cậy của S1, toàn bộ S2, và toàn bộ S3. Cả ba đọc CÙNG
 * một câu hỏi - "lời khai này có cõng rủi ro thật không".
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

/**
 * Một lời khai vai, đã gỡ khỏi hình dạng `BotMemory` mà nó tới.
 *
 * Tồn tại vì `ROLE_CLAIM` và `COUNTER_CLAIM` là HAI loại memory nhưng chỉ MỘT
 * sự kiện xã hội: cả hai đều là "tôi là X" nói giữa bàn dân thiên hạ, chỉ khác
 * là câu phản bác nói kèm "còn anh thì không". `chat-analysis` phát ra đúng một
 * loại cho mỗi câu (nó `continue` ngay sau khi nhận ra một phản bác), và
 * `claim-decision` xét COUNTER TRƯỚC PROACTIVE - nên người nói THỨ HAI trong
 * mọi cuộc cãi vai luôn rơi vào `COUNTER_CLAIM`. Lọc theo loại như trước đây
 * làm mô hình mù đúng nửa sau của mỗi cuộc cãi: Sói khai láo Tiên Tri trước thì
 * ăn trọn thưởng tin cậy của S1, còn Tiên Tri thật đứng lên phản bác thì không
 * sinh ra MỘT mảnh bằng chứng nào - không tin cậy, không va chạm, không kiểm
 * chứng bằng đêm. Kẻ nói dối được lời, người nói thật trắng tay, đúng ngược
 * chiều mục đích của cả cơ chế.
 */
interface NormalisedClaim {
  type: "ROLE_CLAIM" | "COUNTER_CLAIM";
  /** Người mở miệng nhận vai. */
  claimantId: string;
  role: Role;
  round: number;
  sourceId: string;
  underFire: boolean;
  /**
   * Người mà lời khai chỉ mặt là Sói, hoặc `null` khi không chỉ ai.
   *
   * LUÔN `null` cho `COUNTER_CLAIM`, và đó là một quyết định chứ không phải một
   * thiếu sót: `targetId` của một câu phản bác nghĩa là "người này đang nói dối
   * về vai của họ", KHÔNG phải "người này là Sói". Đổ nó vào kênh buộc tội sẽ
   * dựng lên một lời tố Sói mà không ai từng nói ra.
   */
  accusedId: string | null;
}

export interface ClaimSignalInput {
  claims: readonly BotMemory[];
  round: number;
  lastNightDeaths: readonly { playerId: string; name: string }[];
  publicVoteHistory: readonly DayVoteRecap[];
  seenEventIds: readonly string[];
  /**
   * Hồ sơ trong ván của bot về từng người (P1.1), hoặc bỏ trống.
   *
   * Module này không hỏi hồ sơ đến từ đâu - nó là những gì CHÍNH bot đã quan
   * sát và đã ghi, cùng loại đầu vào với `claims`. Chỉ `bluffRate` được đọc:
   * người từng khai sai thì được tin ít hơn khi khai lại.
   */
  profiles?: Readonly<Record<string, PlayerProfile>>;
}

/**
 * Gộp hai loại memory thành một danh sách, theo thứ tự TẤT ĐỊNH.
 *
 * Sắp ở đây một lần thay vì ở từng tín hiệu: thứ tự chèn của `state.claims` phụ
 * thuộc lịch quan sát của từng BOT, mà một chuỗi phụ thuộc lịch thì không replay
 * được. `claimantId` là khoá phá hoà cuối vì một tin nhắn có thể sinh ra nhiều
 * memory cùng `sourceId`.
 */
function normalise(claims: readonly BotMemory[]): NormalisedClaim[] {
  const found: NormalisedClaim[] = [];
  for (const memory of claims) {
    if (memory.type !== "ROLE_CLAIM" && memory.type !== "COUNTER_CLAIM") continue;
    const role = memory.data.role;
    // Ván cũ/memory chép tay có thể mang vai đã bị xóa cứng (PRIEST/MEDIUM):
    // `isPowerRole` tra thẳng ROLE_META nên phải guard, bỏ qua lặng lẽ.
    if (!isRole(role)) continue;
    found.push({
      type: memory.type,
      claimantId: memory.actorId,
      role,
      round: memory.round,
      sourceId: memory.sourceId,
      underFire: memory.data.underFire === true,
      accusedId: memory.type === "ROLE_CLAIM" ? (memory.targetId ?? null) : null,
    });
  }
  return found.sort(
    (a, b) =>
      a.round - b.round ||
      a.sourceId.localeCompare(b.sourceId) ||
      a.claimantId.localeCompare(b.claimantId),
  );
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

  const claims = normalise(input.claims);
  const confidence = weights.evidence.ROLE_CLAIM.confidence;

  // ---- S1: thời điểm ----
  for (const claim of claims) {
    const factor = claim.underFire ? tuning.underFireFactor : 1;

    // Nửa buộc tội: áp dụng cho MỌI lời khai chỉ mặt ai đó, không riêng vai
    // quyền lực. Đây là điều RULING giữ nguyên - nó đo việc bị nêu tên, không
    // đo vai được khai. `accusedId` của phản bác luôn `null` (xem
    // `NormalisedClaim`), nên nhánh này không bao giờ chạy cho phản bác.
    if (claim.accusedId) {
      push(
        evidence(
          "ROLE_CLAIM",
          claim.sourceId,
          "accused",
          claim.accusedId,
          claim.claimantId,
          claim.round,
          tuning.accusationWeight * factor,
          confidence,
          claim.underFire
            ? "Bị một người đang dẫn phiếu chỉ mặt khi họ khai vai."
            : "Bị một người tự nhận vai chức năng chỉ đích danh.",
        ),
      );
    }

    // Nửa tin cậy: chỉ vai quyền lực mới thật sự đặt cược mạng sống khi khai,
    // nên chỉ nó mới đáng được thưởng tin cậy. Phản bác cũng được tính - đứng
    // lên nói "tôi mới là Tiên Tri" phơi mình trước bầy Sói y hệt như khai
    // trước.
    if (!isPowerRole(claim.role)) continue;

    // P1.1: trừ SẴN vào phần thưởng của người đã từng khai sai, trước khi
    // S2-S4 xét gì thêm. Chỉ trừ tới 0, không lật dấu - xem `knownBluffPenalty`.
    const profile = input.profiles?.[claim.claimantId];
    const distrust = profile
      ? tuning.knownBluffPenalty *
        profile.bluffRate *
        profileStrength(profile, tuning.profilePriorStrength)
      : 0;
    const reward = Math.max(0, tuning.claimantTrustWeight * factor - distrust);
    if (reward <= 0) continue;

    push(
      evidence(
        "ROLE_CLAIM",
        claim.sourceId,
        "claimant",
        claim.claimantId,
        claim.claimantId,
        claim.round,
        -reward,
        confidence,
        distrust > 0
          ? // KHÔNG mở đầu bằng "nhận ": đó là một `FIRST_PERSON_MARKERS` của
            // `chat-analysis`, và chuỗi này được NÓI RA nên nó sẽ bị chính các
            // BOT khác đọc lại. Mở đầu như thế là mời parser đi tìm một lời
            // khai vai trong câu.
            "Người này có khai vai, mà trước từng khai sai."
          : "Người này dám đứng ra khai vai giữa bàn.",
      ),
    );
  }

  // ---- S2: va chạm ----
  //
  // Chỉ xét vai quyền lực. Mọi lời khai VILLAGER (gần cả bàn, mỗi Ngày Sự Thật)
  // bị loại trước khi vào đây, nên chúng không bao giờ được đọc thành va chạm.
  //
  // Xét CẢ HAI loại: một câu phản bác đè lên một lời khai cùng vai CHÍNH LÀ cú
  // va chạm mà tín hiệu này sinh ra để bắt - và trước đây nó là trường hợp duy
  // nhất tín hiệu bỏ sót.
  const byRole = new Map<string, NormalisedClaim[]>();
  for (const claim of claims) {
    if (!isPowerRole(claim.role)) continue;
    byRole.set(claim.role, [...(byRole.get(claim.role) ?? []), claim]);
  }
  // `claims` đã sắp, nên mỗi nhóm giữ nguyên thứ tự đó; duyệt khoá theo alphabet
  // để thứ tự chèn của Map không lọt vào kết quả.
  for (const role of [...byRole.keys()].sort()) {
    const group = byRole.get(role)!;
    if (group.length < 2) continue;
    const last = group.at(-1)!;
    group.forEach((claim, index) => {
      // Người đến sau chịu nặng hơn: phản ứng lại một lời khai rẻ hơn nhiều so
      // với việc đi trước, nên nó cũng đáng tin hơn ít.
      const scale = index === 0 ? 1 : tuning.collisionLatePenaltyScale;
      push(
        evidence(
          "COUNTER_CLAIM",
          // Neo vào lời khai ĐẾN SAU: va chạm chỉ tồn tại từ khoảnh khắc đó.
          last.sourceId,
          `collision:${role}:${claim.claimantId}`,
          claim.claimantId,
          claim.claimantId,
          last.round,
          tuning.collisionPenalty * scale,
          confidence,
          // Tên hiển thị, KHÔNG phải mã vai: câu này đi thẳng vào `{evidence}`
          // của bảng mẫu và ra tới khung chat, nên một chữ `GUARD` ở đây là
          // một con BOT nói "có người khác cũng nhận là GUARD" giữa phòng.
          // Bắt được nhờ biên bản của §27 - xem `docs/bot-communication-human-eval.md`.
          `Có người khác cũng nhận là ${roleLabel(role)}, nên ít nhất một trong hai đang nói dối.`,
        ),
      );
    });
  }

  // ---- S3: kiểm chứng bằng đêm ----
  //
  // Không ai chết thì KHÔNG có tín hiệu, và đó là một quyết định chứ không phải
  // một thiếu sót: Bảo Vệ và Phù Thuỷ cũng làm ra đúng cảnh đó.
  //
  // Xét cả hai loại: người phản bác nhận vai Tiên Tri phơi mình trước bầy Sói
  // đúng bằng người khai vai Tiên Tri, nên đêm sau kiểm chứng được cả hai.
  if (input.lastNightDeaths.length > 0) {
    const died = new Set(input.lastNightDeaths.map((death) => death.playerId));
    for (const claim of claims) {
      if (!isPowerRole(claim.role)) continue;
      // Chỉ xét lời khai của các vòng TRƯỚC: khai xong đêm chưa qua thì chưa có
      // gì để kiểm.
      if (claim.round >= input.round) continue;

      if (died.has(claim.claimantId)) {
        push(
          evidence(
            "ROLE_CLAIM",
            `night-death:${input.round}:${claim.claimantId}`,
            "night-confirm",
            claim.claimantId,
            claim.claimantId,
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
          `night-survived:${claim.claimantId}`,
          claim.claimantId,
          claim.claimantId,
          input.round,
          tuning.nightSurvivedPenalty,
          confidence,
          "Khai vai chức năng mà đêm qua vẫn sống, trong khi người khác chết thay.",
        ),
      );
    }
  }

  // ---- S4: nhất quán với lịch sử phiếu ----
  //
  // Chỉ `ROLE_CLAIM`: tín hiệu này hỏi "đã gọi tên một con Sói rồi có bỏ phiếu
  // treo đúng người đó không". Một câu phản bác không gọi tên Sói nào -
  // `accusedId` của nó luôn `null` - nên nó không có gì để mà bất nhất.
  for (const recap of input.publicVoteHistory) {
    if (recap.round <= 0) continue;
    for (const claim of claims) {
      if (claim.type !== "ROLE_CLAIM") continue;
      if (!claim.accusedId || claim.round > recap.round) continue;
      const votedRight = recap.mutations.some(
        (mutation) =>
          mutation.voterId === claim.claimantId &&
          mutation.choice.type === "PLAYER" &&
          mutation.choice.targetId === claim.accusedId,
      );
      if (votedRight) continue;
      push(
        evidence(
          "ROLE_CLAIM",
          `recap:${recap.round}`,
          `inconsistent:${claim.claimantId}`,
          claim.claimantId,
          claim.claimantId,
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
