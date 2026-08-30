import type { GameEventId, GameEventView, Phase, RoomSnapshot } from "@masoi/shared";

/**
 * Chuyển cảnh giữa hai snapshot.
 *
 * Cùng nguyên tắc với `cuesFor` bên audio-cues: cinematic được chọn từ CẠNH
 * giữa hai snapshot chứ không từ trạng thái của snapshot mới. Server chỉ đẩy
 * snapshot chứ không có luồng sự kiện, nên xét theo trạng thái sẽ khiến mỗi lần
 * resync sau khi rớt mạng phát lại một đoạn chuyển cảnh của việc đã xảy ra từ
 * lâu - đúng lúc người chơi vừa nối lại và đang cần nhìn bàn.
 *
 * Module này KHÔNG đụng gì tới React hay DOM: nó chỉ trả lời "cạnh này đáng một
 * đoạn chuyển cảnh nào", còn phát hay bỏ qua là việc của CinematicOverlay.
 */

export const CINEMATIC_KINDS = [
  "NIGHTFALL",
  "DAWN",
  "TRIAL",
  "VERDICT",
  "VILLAGE_WIN",
  "WOLVES_WIN",
  "WOLF_THREAT",
  "VILLAGE_BOON",
  "RULE_CHANGE",
  "SPIRIT",
] as const;

export type CinematicKind = (typeof CINEMATIC_KINDS)[number];

export interface Cinematic {
  kind: CinematicKind;
  /**
   * Khoá định danh của ĐÚNG lần chuyển cảnh này.
   *
   * Overlay nhớ khoá vừa phát và bỏ qua khoá trùng. Nhờ vậy hai snapshot cùng
   * mô tả một cạnh (server đẩy lại, hoặc một trường phụ đổi giữa pha) không làm
   * màn hình chớp thêm một lần nữa.
   */
  key: string;
  /** Tên file trong /cinematics, không kèm phần mở rộng. */
  clip: string;
  durationMs: number;
  /** Câu mô tả; dùng cho aria-label và cho cả bản dựng bằng CSS. */
  label: string;
}

/**
 * Bốn "họ" hình ảnh cho 15 sự kiện.
 *
 * Mỗi sự kiện một đoạn phim riêng là 15 clip phải dựng, phải tải, và phải giữ
 * cho khớp mỗi lần thêm sự kiện mới. Tên, icon và nội dung sự kiện vẫn lấy
 * nguyên từ snapshot; họ hình ảnh chỉ nói giúp đúng một câu - chuyện vừa xảy ra
 * nghiêng về phía ai.
 *
 * Record<GameEventId, ...> chứ không phải object thường: thêm sự kiện mới vào
 * GameEventId mà quên khai báo ở đây là lỗi biên dịch, thay vì một sự kiện âm
 * thầm rơi về họ mặc định.
 */
const EVENT_FAMILY: Record<GameEventId, CinematicKind> = {
  MOONLESS_NIGHT: "WOLF_THREAT",
  BLOODY_HUNT: "WOLF_THREAT",
  HOWL_OF_THE_PACK: "WOLF_THREAT",
  BLOOD_MOON: "WOLF_THREAT",
  WOLF_SHADOW: "WOLF_THREAT",

  CLEARING_MIST: "VILLAGE_BOON",
  PEACEFUL_NIGHT: "VILLAGE_BOON",
  MORNING_REPORT: "VILLAGE_BOON",
  JUDGMENT_DAY: "VILLAGE_BOON",

  CURFEW: "RULE_CHANGE",
  SILENT_NIGHT: "RULE_CHANGE",
  AMNESTY_DAY: "RULE_CHANGE",
  LAST_STAND: "RULE_CHANGE",
  DAY_OF_TRUTH: "RULE_CHANGE",

  DEAD_CAN_SPEAK: "SPIRIT",
};

interface KindMeta {
  clip: string;
  durationMs: number;
  label: string;
}

/**
 * Thời lượng đo bằng thứ người chơi MẤT, không phải thứ họ được xem.
 *
 * Đồng hồ của pha chạy ở server và overlay không hoãn state một mili giây nào -
 * nhưng nó che mất bàn. Một giây đủ để mắt hiểu cảnh vừa đổi; hai giây trong
 * lúc đang phải chọn người là đã đắt. Chỉ màn kết thúc được dài hơn, vì lúc đó
 * không còn gì phải bấm nữa.
 */
const KIND_META: Record<CinematicKind, KindMeta> = {
  NIGHTFALL: { clip: "nightfall", durationMs: 1200, label: "Màn đêm buông xuống" },
  DAWN: { clip: "dawn", durationMs: 1200, label: "Trời sáng trên ngôi làng" },
  TRIAL: { clip: "trial", durationMs: 1000, label: "Phiên toà bắt đầu" },
  VERDICT: { clip: "verdict", durationMs: 1100, label: "Làng đã có phán quyết" },
  VILLAGE_WIN: { clip: "village-win", durationMs: 2000, label: "Dân Làng chiến thắng" },
  WOLVES_WIN: { clip: "wolves-win", durationMs: 2000, label: "Ma Sói chiến thắng" },
  WOLF_THREAT: { clip: "event-wolf-threat", durationMs: 900, label: "Bầy Sói trỗi dậy" },
  VILLAGE_BOON: { clip: "event-village-boon", durationMs: 900, label: "Vận may đến với làng" },
  RULE_CHANGE: { clip: "event-rule-change", durationMs: 900, label: "Luật làng thay đổi" },
  SPIRIT: { clip: "event-spirit", durationMs: 900, label: "Linh hồn lên tiếng" },
};

export function cinematicMeta(kind: CinematicKind): KindMeta {
  return KIND_META[kind];
}

/** Mọi tên file cần có trong /public/cinematics; README ở đó liệt kê đúng danh sách này. */
export const CINEMATIC_CLIPS: string[] = CINEMATIC_KINDS.map((kind) => KIND_META[kind].clip);

/**
 * Định danh của MỘT lần một sự kiện kích hoạt.
 *
 * Sự kiện nằm trong `activeEvent` suốt cả pha nó tác dụng, nên chỉ so id là
 * không đủ: cùng một sự kiện ở hai vòng khác nhau là hai lần kích hoạt khác
 * nhau, còn cùng id + cùng vòng + cùng pha đích thì luôn là một lần duy nhất.
 */
function eventKey(event: GameEventView | null | undefined): string | null {
  return event ? `${event.id}:${event.round}:${event.targetPhase}` : null;
}

function build(kind: CinematicKind, key: string): Cinematic {
  const meta = KIND_META[kind];
  return { kind, key, clip: meta.clip, durationMs: meta.durationMs, label: meta.label };
}

/**
 * Đoạn chuyển cảnh cho cạnh prev -> next, hoặc null nếu cạnh này không đáng một
 * đoạn nào.
 *
 * Thứ tự ưu tiên khi một cạnh chạm nhiều luật cùng lúc:
 *
 *  1. Kết thúc ván - không còn gì phía sau để mà nhường.
 *  2. Sự kiện vừa kích hoạt - hiếm, bất ngờ, và là thứ người chơi phải biết
 *     ngay. Sự kiện gần như luôn rơi đúng vào lúc sang pha, nên nếu nhường cho
 *     cạnh pha thì nó sẽ không bao giờ được thông báo lớn lần nào.
 *  3. Cạnh pha thường lệ.
 */
export function cinematicFor(prev: RoomSnapshot | null, next: RoomSnapshot): Cinematic | null {
  // Snapshot đầu tiên không có cạnh nào để so. Đây cũng chính là thứ giữ cho
  // người vào phòng giữa pha (F5, mở tab mới) không bị dội một đoạn chuyển cảnh
  // của chuyện đã xong từ trước khi họ tới.
  if (!prev) return null;

  if (next.phase === "GAME_OVER" && prev.phase !== "GAME_OVER" && next.winner) {
    const kind: CinematicKind = next.winner === "wolves" ? "WOLVES_WIN" : "VILLAGE_WIN";
    return build(kind, `over:${next.winner}:${next.round}`);
  }

  const activeKey = eventKey(next.activeEvent);
  if (next.activeEvent && activeKey && activeKey !== eventKey(prev.activeEvent)) {
    return build(EVENT_FAMILY[next.activeEvent.id], `event:${activeKey}`);
  }

  const kind = phaseKind(prev.phase, next.phase);
  if (!kind) return null;
  return build(kind, `phase:${kind}:${next.round}:${next.phase}`);
}

function phaseKind(from: Phase, to: Phase): CinematicKind | null {
  if (from === to) return null;
  if (to === "NIGHT") return "NIGHTFALL";
  // NIGHT_RESULT chỉ vào được từ NIGHT, nhưng viết theo "vừa bước vào" thay vì
  // "đi từ NIGHT sang" để chèn thêm một pha đệm sau này không âm thầm mất cảnh.
  if (to === "NIGHT_RESULT") return "DAWN";
  // Riêng phiên toà phải xét cả pha nguồn: DEFENSE -> FINAL_VOTE là đi TIẾP
  // trong cùng một phiên toà, không phải mở một phiên toà mới.
  if (from === "VOTING" && (to === "DEFENSE" || to === "FINAL_VOTE")) return "TRIAL";
  if (from === "FINAL_VOTE" && to === "ELIMINATION") return "VERDICT";
  return null;
}

/**
 * Clip nên nạp sẵn khi đang ở pha này.
 *
 * Không nạp cả mười: người chơi đang trong đêm sẽ không gặp màn phiên toà trong
 * ít nhất vài phút nữa, và tải trước 10MB trên 4G để dùng 1MB là trả tiền hộ
 * nhà mạng. Chỉ lấy đúng những cảnh có thể tới ngay sau pha hiện tại.
 */
export function nextClips(phase: Phase): string[] {
  const kinds = ((): CinematicKind[] => {
    switch (phase) {
      case "LOBBY":
      case "ROLE_REVEAL":
        return ["NIGHTFALL"];
      case "NIGHT":
        return ["DAWN"];
      case "NIGHT_RESULT":
      case "DAY_DISCUSSION":
      case "VOTING":
        return ["TRIAL"];
      case "DEFENSE":
      case "FINAL_VOTE":
        return ["VERDICT"];
      // Sau khi có người ngã xuống, ván hoặc kết thúc ngay hoặc sang đêm mới.
      case "ELIMINATION":
      case "CHECK_WIN":
      case "HUNTER_SHOT":
        return ["NIGHTFALL", "WOLVES_WIN", "VILLAGE_WIN"];
      case "GAME_OVER":
        return [];
    }
  })();
  return kinds.map((kind) => KIND_META[kind].clip);
}
