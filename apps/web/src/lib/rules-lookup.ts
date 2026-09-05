import {
  ROLE_META,
  roleTeam,
  type GameEventView,
  type Phase,
  type Role,
  type RoomSnapshot,
  type Team,
} from "@masoi/shared";
import { myCursedNote } from "./cursed";
import { CONFIG_KEY, NEUTRAL_ROLES, VILLAGE_ROLES, WOLF_SPECIAL_ROLES, deckCounts } from "./lobby-summary";
import { PHASE_META } from "./phase-meta";
import { roleGoal } from "./role-goal";

/**
 * Nội dung của bảng "Luật và vai trò" mở giữa ván.
 *
 * Thuần: chỉ đọc snapshot và các bảng tra có sẵn, không đoán luật. Người
 * chơi ẩn thẻ hướng dẫn rồi, hoặc chưa từng bật, vẫn cần một chỗ để hỏi
 * "vai này làm gì" ngay lúc đang bị dí phiếu - và câu trả lời phải là cùng
 * một câu với phòng chờ và thẻ vai, nên ở đây không viết mô tả nào mới.
 */
export interface RulesLookup {
  phase: { label: string; hint: string };
  myRole: {
    role: Role;
    name: string;
    team: Team;
    description: string;
    goal: string;
    actsAtNight: boolean;
    /** Ghi chú riêng cho người đã hoá vai, nếu có. */
    note: string | null;
  } | null;
  /** Sự kiện đang chạy; luôn null ở phòng xếp hạng vì ở đó không có sự kiện. */
  event: GameEventView | null;
  /** Bộ bài của ván, theo thứ tự đọc: Sói, làng, trung lập, Dân Làng cuối. */
  deck: Array<{ role: Role; name: string; team: Team; count: number; description: string }>;
}

export function rulesLookup(snapshot: RoomSnapshot): RulesLookup {
  return {
    phase: { label: PHASE_META[snapshot.phase].label, hint: phaseHint(snapshot.phase) },
    myRole: myRoleOf(snapshot),
    event: snapshot.config.mode === "chaos" ? (snapshot.activeEvent ?? null) : null,
    deck: deckOf(snapshot),
  };
}

function myRoleOf(snapshot: RoomSnapshot): RulesLookup["myRole"] {
  const role = snapshot.you?.role;
  if (!role) return null;
  const meta = ROLE_META[role];
  return {
    role,
    name: meta.name,
    team: roleTeam(role),
    description: meta.description,
    goal: roleGoal(role),
    // Tiên Tri Tập Sự chỉ thức khi Tiên Tri chết; ở đây không biết điều đó nên
    // đọc theo bảng vai: có thứ tự đêm là "có hành động đêm", đúng với mô tả
    // vai mà người chơi đang đọc ngay bên trên.
    actsAtNight: meta.nightOrder !== undefined,
    note: myCursedNote(snapshot) ?? executionerNote(snapshot),
  };
}

function executionerNote(snapshot: RoomSnapshot): string | null {
  return snapshot.you?.executionerTurned
    ? "Mục tiêu của bạn đã chết vì lý do khác: bạn đã hoá Thằng Hề, từ giờ chỉ thắng khi chính bạn bị treo."
    : null;
}

function deckOf(snapshot: RoomSnapshot): RulesLookup["deck"] {
  const config = snapshot.config;
  const entry = (role: Role, count: number) => ({
    role,
    name: ROLE_META[role].name,
    team: roleTeam(role),
    count,
    description: ROLE_META[role].description,
  });
  const enabled = (roles: Role[]) => roles.filter((r) => config[CONFIG_KEY[r]]).map((r) => entry(r, 1));
  const { villagers } = deckCounts(config, snapshot.players.length);
  return [
    entry("WEREWOLF", config.werewolves),
    ...enabled(WOLF_SPECIAL_ROLES),
    ...enabled(VILLAGE_ROLES),
    ...enabled(NEUTRAL_ROLES),
    ...(villagers > 0 ? [entry("VILLAGER", villagers)] : []),
  ];
}

/** Một câu chỉ việc cho từng pha, viết cho người đang không biết bấm gì. */
export function phaseHint(phase: Phase): string {
  return PHASE_HINTS[phase];
}

const PHASE_HINTS: Record<Phase, string> = {
  LOBBY: "Chờ đủ người rồi bấm Sẵn sàng; chủ phòng bấm Bắt đầu.",
  ROLE_REVEAL: "Lật thẻ để xem vai của bạn. Đừng nói cho ai.",
  NIGHT: "Vai có hành động đêm chọn mục tiêu; người khác chờ trời sáng.",
  NIGHT_RESULT: "Đọc xem đêm qua ai chết, rồi chuẩn bị lập luận cho ban ngày.",
  DAY_DISCUSSION: "Trao đổi trong chat hoặc mic để tìm Sói. Bấm Bỏ qua nếu cả làng muốn bỏ phiếu sớm.",
  VOTING: "Bỏ phiếu đề cử một người ra xét xử, hoặc chọn không treo ai. Đổi phiếu được tới hết giờ.",
  DEFENSE: "Bị cáo bào chữa; mọi người còn sống có thể chất vấn.",
  FINAL_VOTE: "Chọn Treo hoặc Tha cho bị cáo. Hoà phiếu thì không ai chết.",
  ELIMINATION: "Xem kết quả phán quyết. Vai của người chết chỉ lộ khi hết ván.",
  HUNTER_SHOT: "Thợ Săn vừa chết được bắn một người, hoặc không ai.",
  CHECK_WIN: "Đang kiểm tra điều kiện thắng.",
  GAME_OVER: "Ván đã xong: xem ai thắng, lật bài cả làng và đọc lại diễn biến.",
};
