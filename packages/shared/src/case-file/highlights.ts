import type { DayVoteRecap, HunterShotRecap, NightRecap } from "../snapshot";
import { joinNames, nameOf, roleLabelOf, teamLabel } from "./narrate";
import type { CaseFilePlayer, CaseHighlight, CaseHighlightType } from "./types";

export interface CaseData {
  players: Map<string, CaseFilePlayer>;
  cast: CaseFilePlayer[];
  nights: NightRecap[];
  days: DayVoteRecap[];
  shots: HunterShotRecap[];
  winner: "wolves" | "village";
  rounds: number;
}

/**
 * Ứng viên điểm ngoặt, kèm khoá sự kiện gốc.
 *
 * Hai ứng viên cùng `eventKey` là hai cách kể về CÙNG một sự việc - một lần treo
 * cổ không được vừa vào hồ sơ với tư cách "treo trúng Sói" vừa với tư cách
 * "tha nhầm". Chống trùng làm ở đây chứ không phải ở chỗ hiển thị.
 */
export interface CaseCandidate extends CaseHighlight {
  eventKey: string;
}

/**
 * Trọng số cố định theo loại, không phải điểm động.
 *
 * Cố định thì hai ván giống nhau xếp hạng giống nhau, và thứ tự ưu tiên là thứ
 * đọc được ở một chỗ duy nhất thay vì phải chạy thử mới biết.
 */
export const IMPORTANCE: Record<CaseHighlightType, number> = {
  INNOCENT_LYNCHED: 92,
  WOLF_LYNCHED: 88,
  HUNTER_MISFIRE: 86,
  HUNTER_REVENGE: 84,
  CURSED_TURNED: 82,
  WOLF_ACQUITTED: 80,
  WITCH_SAVE: 76,
  PRIEST_BACKFIRE: 74,
  BLOODBATH: 72,
  WITCH_POISON: 70,
  PRIEST_STRIKE: 68,
  // Thiên Thần Hộ Mệnh xếp trên Bảo Vệ đúng một bậc: cùng một cú đỡ, nhưng
  // Bảo Vệ đỡ được mỗi đêm còn Thiên Thần chỉ có hai lượt cả ván, nên tiêu
  // đúng một lượt vào đúng người là quyết định đắt hơn.
  ANGEL_SAVE: 67,
  GUARD_SAVE: 66,
  LATE_VOTE_SWING: 64,
  SEER_FOUND_WOLF: 58,
  LONE_SURVIVOR: 54,
  QUIET_MATCH: 0,
};

/** Phần cuối cửa sổ đề cử được tính là "phút chót". */
const LATE_WINDOW_FRACTION = 0.75;

const phaseRank = (phase: "night" | "day") => (phase === "night" ? 0 : 1);

/**
 * Vai của một người phe làng, kèm vế "phe Dân Làng" khi cần.
 *
 * Với chính vai Dân Làng thì tên vai ĐÃ là tên phe, nên thêm vế kia thành
 * "Dân Làng, phe Dân Làng" - nói hai lần cùng một điều.
 */
function villageRoleClause(player: CaseFilePlayer): string {
  const label = roleLabelOf(player);
  return label === "Dân Làng" ? label : `${label}, phe Dân Làng`;
}

/**
 * Vế kiểm phiếu của một phiên toà ĐÃ kết án.
 *
 * "8 phiếu Treo trên 0 phiếu Tha" là ngôn ngữ của bảng kiểm phiếu, không phải
 * của một câu kể: nó bắt người đọc tự dịch "0 phiếu Tha" thành "không ai bênh",
 * và viết hoa Treo/Tha giữa câu làm hai chữ đó đọc ra như tên riêng. Câu ở đây
 * đã có động từ "treo cổ" nên vế phiếu KHÔNG nói lại chữ "treo" lần nữa.
 */
function verdictTally(guilty: number, innocent: number): string {
  return `${guilty} phiếu, ${innocent === 0 ? "không có phiếu tha" : `${innocent} phiếu tha`}`;
}

/**
 * Vế kiểm phiếu của một phiên toà THA BỔNG.
 *
 * Ở đây câu không có động từ treo cổ nào để tựa vào, nên vế phiếu phải tự gọi
 * tên cả hai phía - khác `verdictTally` đúng ở một chữ, và đó là chữ quyết định
 * câu có đọc được hay không.
 */
function acquittalTally(guilty: number, innocent: number): string {
  const spared = innocent === 0 ? "không có phiếu tha" : `${innocent} phiếu tha`;
  return `${guilty} phiếu treo, ${spared}`;
}

function candidate(
  type: CaseHighlightType,
  round: number,
  phase: "night" | "day",
  eventKey: string,
  title: string,
  description: string,
  participants: string[],
  evidence: CaseHighlight["evidence"],
): CaseCandidate {
  return {
    type,
    round,
    phase,
    title,
    description,
    participants,
    importance: IMPORTANCE[type],
    evidence,
    eventKey,
  };
}

// ---- Điểm ngoặt ban ngày: phiên toà ----

function trialHighlights(data: CaseData): CaseCandidate[] {
  const out: CaseCandidate[] = [];
  for (const day of data.days) {
    const judgment = day.finalJudgment;
    // Chỉ một phiên toà ĐÃ CÓ PHÁN QUYẾT mới nói được điều gì. Hoà phiếu, làng
    // chọn không treo ai, hay không ai bỏ phiếu đều là `NONE` - không có ai bị
    // xử cả, nên tuyệt đối không phải án oan.
    if (day.nomination.kind !== "TRIAL" || !judgment) continue;

    const accusedId = day.nomination.accusedId;
    const accused = data.players.get(accusedId);
    // Không tra được vai thì không chứng minh được oan hay đúng. Im lặng.
    if (!accused) continue;
    const name = accused.name;
    const key = `trial:${day.round}`;
    const tally = { guilty: judgment.guilty, innocent: judgment.innocent, abstain: judgment.abstain };

    if (judgment.lynched) {
      out.push(
        accused.team === "village"
          ? candidate(
              "INNOCENT_LYNCHED",
              day.round,
              "day",
              key,
              "Án oan giữa ban ngày",
              `Làng treo cổ ${name} với ${verdictTally(judgment.guilty, judgment.innocent)}. ${name} là ${villageRoleClause(accused)}.`,
              [accusedId],
              { kind: "lynch", accusedId, ...tally },
            )
          : candidate(
              "WOLF_LYNCHED",
              day.round,
              "day",
              key,
              "Làng tóm đúng Sói",
              `${name} bị treo cổ với ${verdictTally(judgment.guilty, judgment.innocent)}. Đúng là ${roleLabelOf(accused)}.`,
              [accusedId],
              { kind: "lynch", accusedId, ...tally },
            ),
      );
      continue;
    }

    // Được tha. Chỉ đáng kể lại khi làng đã cầm được con Sói trong tay rồi thả ra.
    if (accused.team === "wolves") {
      out.push(
        candidate(
          "WOLF_ACQUITTED",
          day.round,
          "day",
          key,
          "Con sói được tha",
          `Làng đưa ${name} ra xét xử rồi tha: ${acquittalTally(judgment.guilty, judgment.innocent)}. ${name} là ${roleLabelOf(accused)}.`,
          [accusedId],
          { kind: "acquittal", accusedId, ...tally },
        ),
      );
    }
  }
  return out;
}

/**
 * Lá phiếu đổi ở phút chót.
 *
 * CỐ Ý chỉ mô tả thứ tự đã được ghi lại, không khẳng định lá phiếu này gây ra
 * kết quả: `voteTally` cộng thêm một phiếu ẩn cho phe Sói khi có sự kiện Tiếng
 * Hú Của Bầy, và phiếu ẩn đó KHÔNG nằm trong `finalBallots`. Mọi phép kiểm phiếu
 * lại từ đây đều có thể mâu thuẫn với `nomination` thật, nên hồ sơ kể ít hơn
 * đúng một bậc thay vì kể sai.
 */
function voteSwingHighlights(data: CaseData): CaseCandidate[] {
  const out: CaseCandidate[] = [];
  for (const day of data.days) {
    if (day.nomination.kind !== "TRIAL") continue;
    const accusedId = day.nomination.accusedId;

    const last = day.mutations.reduce<(typeof day.mutations)[number] | null>(
      (best, mutation) => (best === null || mutation.sequence > best.sequence ? mutation : best),
      null,
    );
    if (!last) continue;
    // Bỏ phiếu lần đầu không phải là ĐỔI phiếu.
    if (!last.previousChoice) continue;
    if (last.choice.type !== "PLAYER" || last.choice.targetId !== accusedId) continue;

    const span = last.phaseEndsAt - last.phaseStartedAt;
    // Cửa sổ suy biến (server cũ, hoặc pha bị cắt) thì không có "phút chót" nào
    // để nói tới - đoán bừa ở đây là bịa.
    if (span <= 0) continue;
    if (last.castAt < last.phaseStartedAt + span * LATE_WINDOW_FRACTION) continue;

    const voter = nameOf(data.players, last.voterId);
    const accused = nameOf(data.players, accusedId);
    out.push(
      candidate(
        "LATE_VOTE_SWING",
        day.round,
        "day",
        `swing:${day.round}`,
        "Lá phiếu phút chót",
        `${voter} đổi phiếu sang ${accused} ở những giây cuối của lượt đề cử, và ${accused} là người bị đưa ra xét xử.`,
        [last.voterId, accusedId],
        {
          kind: "vote-swing",
          voterId: last.voterId,
          accusedId,
          castAt: last.castAt,
          windowEndsAt: last.phaseEndsAt,
        },
      ),
    );
  }
  return out;
}

// ---- Điểm ngoặt của Thợ Săn ----

function hunterHighlights(data: CaseData): CaseCandidate[] {
  const out: CaseCandidate[] = [];
  data.shots.forEach((shot, index) => {
    // Thợ Săn chọn không bắn ai là một quyết định, không phải một phát đạn lạc.
    if (!shot.target) return;
    const target = data.players.get(shot.target.id);
    if (!target) return;

    const key = `hunter:${shot.round}:${index}`;
    const phase = shot.source === "night" ? "night" : "day";
    const evidence = {
      kind: "hunter-shot" as const,
      hunterId: shot.hunter.id,
      targetId: shot.target.id,
      source: shot.source,
    };
    const participants = [shot.hunter.id, shot.target.id];

    out.push(
      target.team === "village"
        ? candidate(
            "HUNTER_MISFIRE",
            shot.round,
            phase,
            key,
            "Phát đạn lạc",
            `Thợ Săn ${shot.hunter.name} ngã xuống và bắn theo ${shot.target.name} - ${villageRoleClause(target)}.`,
            participants,
            evidence,
          )
        : candidate(
            "HUNTER_REVENGE",
            shot.round,
            phase,
            key,
            "Phát đạn cuối cùng",
            `Thợ Săn ${shot.hunter.name} ngã xuống và kéo theo ${shot.target.name} - ${roleLabelOf(target)}.`,
            participants,
            evidence,
          ),
    );
  });
  return out;
}

// ---- Điểm ngoặt ban đêm ----

function nightHighlights(data: CaseData): CaseCandidate[] {
  const out: CaseCandidate[] = [];

  for (const night of data.nights) {
    const round = night.round;
    const deaths = night.deaths ?? [];
    const diedThisNight = new Set(deaths.map((death) => death.player.id));

    // Kẻ Nguyền Rủa đổi phe.
    const turned = night.cursedTurned ?? null;
    if (turned) {
      out.push(
        candidate(
          "CURSED_TURNED",
          round,
          "night",
          `cursed:${round}`,
          "Đêm đổi phe",
          `${turned.name} bị Ma Sói cắn nhưng không chết: Kẻ Nguyền Rủa đã hoá Ma Sói và chơi tiếp cho bầy.`,
          [turned.id],
          { kind: "cursed-turned", playerId: turned.id },
        ),
      );
    }

    // Phù Thuỷ cứu đúng nạn nhân: đã đốt bình VÀ người đó không nằm trong danh
    // sách chết đêm đó.
    const healed = night.witch.usedHeal ? night.witch.healedTarget : null;
    if (healed && !diedThisNight.has(healed.id)) {
      out.push(
        candidate(
          "WITCH_SAVE",
          round,
          "night",
          `witch-save:${round}`,
          "Bình cứu đúng lúc",
          `Phù Thuỷ đổ bình cứu lên ${healed.name}, kéo ${healed.name} ra khỏi nanh Sói.`,
          [healed.id],
          { kind: "witch-save", savedId: healed.id },
        ),
      );
    }

    // Bình độc: chỉ tính khi CÓ một cái chết vì độc đúng vào người bị nhắm.
    const poisoned = night.witch.poisonTarget;
    if (poisoned && deaths.some((d) => d.cause === "poison" && d.player.id === poisoned.id)) {
      out.push(
        candidate(
          "WITCH_POISON",
          round,
          "night",
          `witch-poison:${round}`,
          "Bình độc lên tiếng",
          `Phù Thuỷ rót bình độc vào ${poisoned.name}.`,
          [poisoned.id],
          { kind: "witch-poison", poisonedId: poisoned.id },
        ),
      );
    }

    // Tấm khiên đỡ đúng mục tiêu bầy Sói nhắm tới, và người đó sống qua đêm.
    //
    // Bảo Vệ và Thiên Thần Hộ Mệnh đổ vào CÙNG một cơ chế khiên trong engine,
    // nên hai vai dùng chung một `eventKey` theo người được cứu: một đêm cả hai
    // cùng chắn một người là MỘT lần cứu, không phải hai điểm ngoặt chiếm hai
    // suất trong hồ sơ.
    const shields = [
      {
        type: "GUARD_SAVE",
        target: night.guardTarget,
        title: "Tấm khiên giữ được người",
        clause: (name: string) => `Bảo Vệ đỡ đúng ${name}`,
        evidence: "guard-save",
      },
      {
        type: "ANGEL_SAVE",
        target: night.guardianAngelTarget ?? null,
        title: "Khiên hộ mệnh chắn đúng lúc",
        clause: (name: string) => `Thiên Thần Hộ Mệnh phủ khiên lên ${name}`,
        evidence: "angel-save",
      },
    ] as const;

    for (const shield of shields) {
      const saved = shield.target;
      if (!saved || !night.wolfTarget) continue;
      if (saved.id !== night.wolfTarget.id || diedThisNight.has(saved.id)) continue;
      out.push(
        candidate(
          shield.type,
          round,
          "night",
          `shield-save:${round}:${saved.id}`,
          shield.title,
          `${shield.clause(saved.name)} - người mà bầy Sói nhắm tới đêm đó.`,
          [saved.id],
          { kind: shield.evidence, savedId: saved.id },
        ),
      );
    }

    // Nước thánh của Linh Mục.
    const priest = night.priest ?? null;
    if (priest) {
      if (priest.isWolf && deaths.some((d) => d.cause === "priest")) {
        out.push(
          candidate(
            "PRIEST_STRIKE",
            round,
            "night",
            `priest:${round}`,
            "Nước thánh trúng đích",
            `Linh Mục ${priest.priest.name} ném Nước thánh vào ${priest.target.name} - đúng là Ma Sói.`,
            [priest.priest.id, priest.target.id],
            { kind: "priest", priestId: priest.priest.id, targetId: priest.target.id, isWolf: true },
          ),
        );
      } else if (!priest.isWolf && deaths.some((d) => d.cause === "priest_backfire")) {
        out.push(
          candidate(
            "PRIEST_BACKFIRE",
            round,
            "night",
            `priest:${round}`,
            "Nước thánh phản phệ",
            `Linh Mục ${priest.priest.name} ném Nước thánh vào ${priest.target.name} - không phải Ma Sói, và chính Linh Mục ngã xuống.`,
            [priest.priest.id, priest.target.id],
            { kind: "priest", priestId: priest.priest.id, targetId: priest.target.id, isWolf: false },
          ),
        );
      }
    }

    // Đêm nhiều người chết.
    if (deaths.length >= 2) {
      out.push(
        candidate(
          "BLOODBATH",
          round,
          "night",
          `bloodbath:${round}`,
          "Đêm đẫm máu",
          `Một đêm cướp đi ${deaths.length} người: ${joinNames(deaths.map((d) => d.player.name))}.`,
          deaths.map((d) => d.player.id),
          { kind: "bloodbath", victimIds: deaths.map((d) => d.player.id) },
        ),
      );
    }

    // Tiên Tri soi trúng Sói.
    (night.seerChecks ?? []).forEach((check, index) => {
      if (!check.isWolf) return;
      out.push(
        candidate(
          "SEER_FOUND_WOLF",
          round,
          "night",
          `seer:${round}:${index}`,
          "Tiên Tri soi trúng",
          `${check.seer.name} soi ${check.target.name} và thấy một con Sói.`,
          [check.seer.id, check.target.id],
          { kind: "seer-check", seerId: check.seer.id, targetId: check.target.id },
        ),
      );
    });
  }

  return out;
}

// ---- Người sống sót cuối cùng ----

function loneSurvivorHighlights(data: CaseData): CaseCandidate[] {
  const survivors = data.cast.filter((player) => player.alive && player.team === data.winner);
  if (survivors.length !== 1) return [];
  const survivor = survivors[0];
  return [
    candidate(
      "LONE_SURVIVOR",
      data.rounds,
      "day",
      "lone-survivor",
      "Người sống sót cuối cùng",
      `${survivor.name} là người duy nhất của phe ${teamLabel(data.winner)} còn đứng khi màn khép lại.`,
      [survivor.id],
      { kind: "lone-survivor", playerId: survivor.id, team: survivor.team },
    ),
  ];
}

/**
 * Đường lui khi ván không để lại điểm ngoặt nào.
 *
 * Câu chữ chỉ được dùng phe thắng và số ngày. Không nói "chưa có phiên toà nào"
 * - một ván CÓ phiên toà nhưng tha đúng người vẫn rơi vào đây, và câu đó sẽ sai.
 */
export function quietMatchHighlight(data: CaseData): CaseHighlight {
  return {
    type: "QUIET_MATCH",
    round: data.rounds,
    phase: "day",
    title: "Một vụ án khép nhanh",
    description: `Phe ${teamLabel(data.winner)} thắng sau ${data.rounds} ngày. Ván này không để lại điểm ngoặt nào đủ rõ để dựng thành hồ sơ.`,
    participants: [],
    importance: IMPORTANCE.QUIET_MATCH,
    evidence: { kind: "quiet-match", rounds: data.rounds },
  };
}

export function collectCandidates(data: CaseData): CaseCandidate[] {
  return [
    ...trialHighlights(data),
    ...voteSwingHighlights(data),
    ...hunterHighlights(data),
    ...nightHighlights(data),
    ...loneSurvivorHighlights(data),
  ];
}

/**
 * Chọn ra tối đa `limit` điểm ngoặt.
 *
 * Mọi phép so sánh đều kết bằng `type` - một khoá chuỗi duy nhất trong toàn tập
 * - nên thứ tự là TOÀN PHẦN. Không dựa vào tính ổn định của `Array.sort`, và
 * đảo thứ tự chạy detector cũng không đổi được kết quả.
 */
export function selectHighlights(
  candidates: CaseCandidate[],
  limit = 5,
  perType = 2,
): CaseHighlight[] {
  const byEvent = new Map<string, CaseCandidate>();
  for (const item of candidates) {
    const current = byEvent.get(item.eventKey);
    if (
      !current ||
      item.importance > current.importance ||
      (item.importance === current.importance && item.type < current.type)
    ) {
      byEvent.set(item.eventKey, item);
    }
  }

  const ranked = [...byEvent.values()].sort(
    (a, b) =>
      b.importance - a.importance ||
      a.round - b.round ||
      phaseRank(a.phase) - phaseRank(b.phase) ||
      (a.type < b.type ? -1 : a.type > b.type ? 1 : 0),
  );

  const chosen: CaseCandidate[] = [];
  const perTypeCount = new Map<CaseHighlightType, number>();
  for (const item of ranked) {
    if (chosen.length >= limit) break;
    const used = perTypeCount.get(item.type) ?? 0;
    if (used >= perType) continue;
    perTypeCount.set(item.type, used + 1);
    chosen.push(item);
  }

  // Đọc một câu chuyện thì phải đọc theo thứ tự nó xảy ra, không theo thứ tự
  // quan trọng. Bỏ `eventKey` ở đây: nó là chi tiết của việc chọn lọc.
  return chosen
    .sort(
      (a, b) =>
        a.round - b.round ||
        phaseRank(a.phase) - phaseRank(b.phase) ||
        b.importance - a.importance ||
        (a.type < b.type ? -1 : a.type > b.type ? 1 : 0),
    )
    .map(({ eventKey: _eventKey, ...highlight }) => highlight);
}
