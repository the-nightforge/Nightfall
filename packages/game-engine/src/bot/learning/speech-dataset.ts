import type { Role } from "@masoi/shared";
import { buildDiscussionGraph } from "../analysis/discussion-graph";
import { pressureOf } from "../analysis/discussion-graph";
import type { SelfPlayEvent, SelfPlayGame } from "../evaluation/selfplay";
import type { BotMemory } from "../types";

/**
 * PR 10 của `NIGHTFALL_BOT_COMMUNICATION_UPGRADE` (§26): thu dữ liệu cho một
 * SPEECH POLICY học được.
 *
 * # Vì sao đây là NỬA ĐẦU, và nửa sau cố ý chưa làm
 *
 * §26 viết theo đúng thứ tự này: *"Sau khi heuristic communication policy ổn
 * định, có thể thu ... Sau đó mới học."* Điều kiện đứng trước cả hai vế, và nó
 * CHƯA đạt: v23–v28 (PR 3–8) không bản nào vượt được tiêu chí §40 để lên mặc
 * định — mọi z đều `< 1`. Train một policy trên một heuristic chưa ổn định là
 * đóng băng nhiễu thành trọng số.
 *
 * Nên file này làm đúng vế thu, và không làm vế học. Xem
 * `docs/bot-communication-learning.md` cho điều kiện mở khoá.
 *
 * # Vì sao KHÔNG dùng lại `trajectory.ts`
 *
 * §26 nói thẳng: *"Không train gameplay action và dialogue trong một model ngay
 * từ đầu."* `BotTrajectory` đã sinh line cho quyết định `SPEECH`, nhưng không
 * gian hành động của nó là không gian GAMEPLAY (chọn một ghế), và chính chú
 * thích ở `legalActionsFor` đã ghi nhận rằng `SPEECH` không chọn mục tiêu trong
 * không gian đó. Một nhãn "nói gì" nhét vào một không gian "bỏ phiếu ai" là
 * đúng thứ §26 cấm.
 *
 * # Ranh giới tri thức
 *
 * Mọi trường ở đây dựng từ LOG CÔNG KHAI của ván - đúng những gì một người ngồi
 * ở bàn nghe thấy - cộng phần thưởng cuối ván. Không vai, không hành động đêm,
 * không belief riêng. `validateSpeechSample` khoá điều đó, cùng tinh thần
 * whitelist của `dataset.ts`.
 *
 * THUẦN: không I/O, không RNG, không đồng hồ.
 */

/** Trạng thái hội thoại tại lúc nói, dựng lại từ log công khai. */
export interface SpeechConversationState {
  round: number;
  /** Áp lực đang dồn vào người nói, `0..1`. Cùng công thức `pressureOf` của PR 1. */
  pressureOnMe: number;
  /** Áp lực vòng TRƯỚC, để policy đọc được xu hướng. */
  pressureBefore: number;
  /** Số người còn sống lúc đó. */
  aliveCount: number;
  /** Số câu người nói đã phát trong vòng này, TRƯỚC câu đang xét. */
  spokenThisRound: number;
}

/** Quyết định giao tiếp đã chốt. Đây là NHÃN của bài học. */
export interface SpeechDecision {
  kind: string;
  targetId: string | null;
  topic: string | null;
  tone: string;
  /** Số nguồn bằng chứng đi kèm. Không mang nội dung bằng chứng. */
  evidenceCount: number;
  /** Vai được KHAI (không phải vai thật), hoặc `null`. */
  claimedRole: Role | null;
}

/**
 * Bàn phản ứng thế nào với câu này.
 *
 * §26 gọi trường này là "human response". Self-play KHÔNG có người, nên đây là
 * một thay thế và phải được đọc đúng như vậy - tên trường nói rõ điều đó thay
 * vì mượn chữ "human" cho một thứ không có người nào tham gia.
 */
export interface SpeechTableResponse {
  /** Số câu đáp lại trực tiếp câu này. */
  replies: number;
  /** Có ai ĐỔI phiếu sang mục tiêu của câu này sau đó trong cùng vòng không. */
  swayedVote: boolean;
}

export interface SpeechSample {
  gameId: string;
  playerId: string;
  messageId: string;
  conversation: SpeechConversationState;
  decision: SpeechDecision;
  /** Câu chữ đã phát. Nhãn của tầng diễn đạt, không phải của tầng chính sách. */
  text: string;
  response: SpeechTableResponse;
  /** `+1` thắng / `-1` thua, theo đúng `BotTrajectory.reward`. */
  reward: number;
}

/**
 * Memory giả lập từ log, đủ để `buildDiscussionGraph` chạy.
 *
 * Dựng lại chứ không chép công thức: những memory `ACCUSE`/`DEFEND` thật vốn
 * SINH RA từ đúng các câu chat này (`chat-analysis` parse chúng), nên đọc ngược
 * từ log là đọc lại cùng một sự việc. Nhờ vậy áp lực trong dataset và áp lực mà
 * planner thấy là CÙNG MỘT con số, không phải hai xấp xỉ của nhau.
 */
function memoriesFromLog(events: readonly SelfPlayEvent[]): BotMemory[] {
  const memories: BotMemory[] = [];
  for (const event of events) {
    if (event.kind !== "SPEECH") continue;
    const type = event.speech === "ACCUSE" ? "ACCUSE" : event.speech === "DEFEND" ? "DEFEND" : null;
    if (type === null || event.targetId === null) continue;
    memories.push({
      id: `${type}:${event.messageId}`,
      sourceId: event.messageId,
      round: event.round,
      phase: "DAY_DISCUSSION",
      type,
      actorId: event.actorId,
      targetId: event.targetId,
      importance: 1,
      pinned: false,
      data: {},
    });
  }
  return memories;
}

/**
 * Một ván -> danh sách mẫu, MỘT mẫu cho MỘT câu đã phát.
 *
 * Ván không bật `speech` không sinh mẫu nào; danh sách rỗng là đúng, không bịa
 * dữ liệu thay thế.
 */
export function gameToSpeechSamples(game: SelfPlayGame): SpeechSample[] {
  const speeches = game.events.filter(
    (event): event is Extract<SelfPlayEvent, { kind: "SPEECH" }> => event.kind === "SPEECH",
  );
  if (speeches.length === 0) return [];

  const memories = memoriesFromLog(game.events);
  const players = Object.keys(game.roles).sort();

  // Ai còn sống ở đầu mỗi vòng: cái chết ghi kèm vòng nên đếm ngược được.
  const diedAt = new Map<string, number>();
  for (const event of game.events) {
    if (event.kind === "DEATH" && !diedAt.has(event.playerId)) {
      diedAt.set(event.playerId, event.round);
    }
  }
  const aliveAt = (round: number): number =>
    players.filter((id) => (diedAt.get(id) ?? Number.POSITIVE_INFINITY) >= round).length;

  // Đồ thị áp lực dựng MỘT lần cho cả ván; tra theo (vòng, người).
  const episodes = new Map<string, ReturnType<typeof buildDiscussionGraph>["episodes"][number]>();
  for (const round of new Set(speeches.map((event) => event.round))) {
    const graph = buildDiscussionGraph({
      knowledge: {
        players: players.map((id) => ({
          id,
          name: id,
          alive: (diedAt.get(id) ?? Number.POSITIVE_INFINITY) >= round,
        })),
      } as never,
      state: { memories },
    });
    for (const episode of graph.episodes) {
      episodes.set(`${episode.round}:${episode.targetId}`, episode);
    }
  }

  const replyCount = new Map<string, number>();
  for (const event of speeches) {
    if (event.replyToMessageId === null) continue;
    replyCount.set(event.replyToMessageId, (replyCount.get(event.replyToMessageId) ?? 0) + 1);
  }

  const spokenSoFar = new Map<string, number>();
  const samples: SpeechSample[] = [];

  speeches.forEach((event, index) => {
    const key = `${event.round}:${event.actorId}`;
    const spokenThisRound = spokenSoFar.get(key) ?? 0;
    spokenSoFar.set(key, spokenThisRound + 1);

    const alive = Math.max(1, aliveAt(event.round));
    samples.push({
      gameId: game.record.seed,
      playerId: event.actorId,
      messageId: event.messageId,
      conversation: {
        round: event.round,
        pressureOnMe: pressureOf(episodes.get(`${event.round}:${event.actorId}`), alive),
        pressureBefore: pressureOf(
          episodes.get(`${event.round - 1}:${event.actorId}`),
          Math.max(1, aliveAt(event.round - 1)),
        ),
        aliveCount: alive,
        spokenThisRound,
      },
      decision: {
        kind: event.speech,
        targetId: event.targetId,
        topic: event.topic ?? null,
        tone: event.tone,
        evidenceCount: event.evidenceSourceIds.length,
        claimedRole: event.claimedRole,
      },
      text: event.text,
      response: {
        replies: replyCount.get(event.messageId) ?? 0,
        swayedVote: swayedAfter(game.events, index, event.round, event.targetId),
      },
      reward: rewardOf(game, event.actorId),
    });
  });

  return samples;
}

/** Có ai ĐỔI phiếu sang `targetId` sau câu này, trong cùng vòng, không. */
function swayedAfter(
  events: readonly SelfPlayEvent[],
  fromIndex: number,
  round: number,
  targetId: string | null,
): boolean {
  if (targetId === null) return false;
  for (let index = fromIndex + 1; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.kind === "PHASE" && event.round > round) return false;
    // Chỉ phiếu ĐỔI: một lá giữ nguyên đã có từ trước câu này, nên nó không
    // phải là bàn bị thuyết phục. Cùng luật với `claimWasFollowed` ở metrics.
    if (event.kind === "VOTE" && event.changed && event.targetId === targetId) return true;
  }
  return false;
}

function rewardOf(game: SelfPlayGame, playerId: string): number {
  if ((game.personalWins ?? []).some((win) => win.playerId === playerId)) return 1;
  if (game.winner === null) return -1;
  const role = game.roles[playerId];
  if (role === undefined) return -1;
  const wolf = role === "WEREWOLF" || role === "WOLF_CUB" || role === "ALPHA_WOLF";
  return (game.winner === "wolves") === wolf ? 1 : -1;
}

export function serializeSpeechSample(sample: SpeechSample): string {
  return JSON.stringify(sample);
}

/**
 * Khoá được phép có trong `conversation` và `decision`.
 *
 * Whitelist chứ không blacklist, cùng lý do với `dataset.ts`: trường hợp nguy
 * hiểm nhất là ai đó THÊM một feature "cho model mạnh hơn" và vô tình chở theo
 * sự thật ẩn. Blacklist chỉ chặn được những cái tên đã nghĩ ra trước.
 */
const CONVERSATION_KEYS = new Set([
  "round",
  "pressureOnMe",
  "pressureBefore",
  "aliveCount",
  "spokenThisRound",
]);
const DECISION_KEYS = new Set([
  "kind",
  "targetId",
  "topic",
  "tone",
  "evidenceCount",
  "claimedRole",
]);

export interface SpeechSampleViolation {
  field: string;
  reason: string;
}

/**
 * Mẫu này có chở theo thứ gì người nói không được biết không.
 *
 * CHỈ báo cáo, không sửa: một dataset có rò rỉ phải bị TỪ CHỐI chứ không được
 * âm thầm xoá trường rồi train tiếp - làm vậy là giấu đi chính con bug đã tạo
 * ra nó. Cùng nguyên tắc với `validateTrajectoryLine`.
 */
export function validateSpeechSample(value: unknown): SpeechSampleViolation[] {
  const violations: SpeechSampleViolation[] = [];
  if (typeof value !== "object" || value === null) {
    return [{ field: "<root>", reason: "mẫu phải là một object" }];
  }
  const sample = value as Record<string, unknown>;

  const conversation = sample.conversation;
  if (typeof conversation !== "object" || conversation === null) {
    violations.push({ field: "conversation", reason: "thiếu trạng thái hội thoại" });
  } else {
    for (const key of Object.keys(conversation)) {
      if (!CONVERSATION_KEYS.has(key)) {
        violations.push({ field: `conversation.${key}`, reason: "khoá ngoài danh sách cho phép" });
      }
    }
  }

  const decision = sample.decision;
  if (typeof decision !== "object" || decision === null) {
    violations.push({ field: "decision", reason: "thiếu quyết định" });
  } else {
    for (const key of Object.keys(decision)) {
      if (!DECISION_KEYS.has(key)) {
        violations.push({ field: `decision.${key}`, reason: "khoá ngoài danh sách cho phép" });
      }
    }
  }

  // Vai THẬT là nhãn cấp ván, không bao giờ được nằm trong mẫu - kể cả dưới
  // một cái tên khác. `claimedRole` được phép vì nó là thứ đã nói TO giữa
  // phòng; `finalRole`/`roles` thì không.
  for (const forbidden of ["finalRole", "roles", "selfRole", "seerResult", "knownRoles"]) {
    if (forbidden in sample) {
      violations.push({ field: forbidden, reason: "mẫu không được mang tri thức riêng" });
    }
  }

  return violations;
}
