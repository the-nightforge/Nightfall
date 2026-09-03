import {
  MAX_PLAYERS_PER_ROOM,
  ROLE_META,
  momentLabel,
  outcomeHeadline,
  roleLabelOf,
  roundsLabel,
  teamLabel,
  type CaseFile,
  type CaseFilePlayer,
  type CaseHighlight,
  type CaseLastLetter,
  type MatchOutcome,
  type RoomSnapshot,
  type Role,
  type Team,
} from "@masoi/shared";

/**
 * "Hồi ức Ngôi Làng" - mô hình THUẦN của màn xem lại 3D ở GAME_OVER.
 *
 * File này không biết Three.js tồn tại và không chạm vào DOM. Nó nhận đúng hai
 * thứ - snapshot của ván đã kết thúc và hồ sơ vụ án `buildCaseFile` dựng ra -
 * rồi trả về một mô tả đầy đủ những gì phải hiện lên: nhà ở đâu, bước nào nối
 * tiếp bước nào, nhà nào còn sáng ở từng bước, camera nhìn về đâu.
 *
 * BA điều kiện làm nên tính tất định, và cả ba đều là thứ có thể khẳng định
 * bằng test:
 *
 *   1. Không `Math.random`, không `Date.now`, không đọc gì của máy.
 *   2. Bố cục nhà xếp theo `playerId` đã SẮP XẾP, nên thứ tự mảng `players` -
 *      thứ có thể đảo giữa hai lần reconnect, và thứ tự React render - không
 *      xê dịch được một căn nhà nào.
 *   3. Mọi hiệu ứng suy từ `evidence` CÓ CẤU TRÚC của điểm ngoặt, không phải từ
 *      câu chữ tiếng Việt trong `title`/`description`. Sửa lời kể không được
 *      làm đổi một cảnh nào.
 *
 * Server là nguồn sự thật duy nhất: ở đây không có nhánh nào sinh thêm một sự
 * kiện trận đấu. Cái gì hồ sơ không nói thì màn hồi ức cũng không nói.
 */

export const VILLAGE_MEMORY_TITLE = "Hồi ức Ngôi Làng";

/** Trần số nhà. Bằng đúng trần người mỗi phòng, nên trong ván thật không bao giờ chạm. */
export const MAX_VILLAGE_HOUSES = MAX_PLAYERS_PER_ROOM;

/**
 * Loại hiệu ứng của một bước.
 *
 * Hẹp hơn `CaseHighlightType` một cách CỐ Ý: nhiều loại điểm ngoặt là cùng một
 * cảnh dựng. Treo trúng Sói và treo oan dân khác nhau ở câu kể chứ không khác ở
 * hình - vẫn là các con dấu bỏ phiếu hội tụ rồi một mái nhà tắt đèn. Ánh xạ
 * nhiều-về-một nằm ở `effectOf`, và `GENERIC` là đường lui BẮT BUỘC có: một
 * loại điểm ngoặt mới thêm vào hồ sơ phải vẫn thành một bước xem được, chứ
 * không được biến mất khỏi màn hồi ức.
 */
export type VillageEffect =
  | "WOLF_ATTACK"
  | "SHIELD_SAVE"
  | "WITCH_HEAL"
  | "WITCH_POISON"
  | "SEER_BEAM"
  | "HUNTER_SHOT"
  | "LYNCH"
  | "TRIAL_SCALES"
  | "CURSED_MOON"
  | "LONE_LIGHT"
  | "GENERIC";

/** Sắc ánh đèn của một nếp nhà. Chỉ là TRANG TRÍ - nghĩa nằm ở `roleLabel`. */
export type VillageAccent =
  | "wolf"
  | "guard"
  | "seer"
  | "witch"
  | "hunter"
  | "villager"
  // Vai TRUNG LẬP có sắc riêng, không mượn sắc Dân Làng: màn hồi ức là bản
  // dựng lại một ván đã lật bài, nên xếp Thằng Hề vào cùng màu với phe làng là
  // kể sai chính ván vừa xong.
  | "jester"
  /*
   * Sát Nhân có sắc RIÊNG, không dùng chung với Thằng Hề.
   *
   * Hai vai cùng nhãn `neutral` nhưng một vai giết người mỗi đêm còn vai kia
   * không chạm vào ai. Cho chúng chung một màu là kể sai đúng cái ván mà màn
   * này dựng lại - người xem sẽ thấy nếp nhà của hung thủ mang màu của lá bài
   * vô hại nhất bàn.
   */
  | "killer";

export interface VillageHouse {
  playerId: string;
  name: string;
  /** "Tiên Tri", "Kẻ Nguyền Rủa (đã hoá Ma Sói)"… - đọc được, không phải một màu. */
  roleLabel: string;
  /** "Ma Sói" / "Dân Làng". Phe cũng phải đọc được bằng chữ, xem chú thích dưới. */
  teamLabel: string;
  team: Team;
  /** Trạng thái CUỐI ván. Trạng thái theo từng bước nằm ở `VillageStep.litIds`. */
  aliveAtEnd: boolean;
  accent: VillageAccent;
  /** 0-2. Ba dáng nhà để mười lăm khối không giống hệt nhau. Suy từ id, không random. */
  variant: number;
  x: number;
  z: number;
}

/** Bảng kiểm phiếu của một phiên toà. Chỉ có khi hồ sơ THẬT SỰ mang con số. */
export interface VillageTally {
  hang: number;
  spare: number;
  abstain: number;
}

export interface VillageStep {
  /** Ổn định theo nội dung, không theo chỉ số mảng: dùng làm `key` của React. */
  id: string;
  index: number;
  round: number;
  phase: "night" | "day";
  /** "Đêm 2" / "Ngày 3" - cùng từ vựng với hồ sơ và thanh pha. */
  momentLabel: string;
  effect: VillageEffect;
  title: string;
  description: string;
  participantIds: string[];
  /** Nhà còn sáng lúc bước này BẮT ĐẦU. */
  litIds: string[];
  /** Nhà tắt đèn TRONG bước này - phần "và rồi người đó ngã xuống". */
  extinguishIds: string[];
  /**
   * Nhà mà hiệu ứng xuất phát, hoặc `null` khi nó đến từ rìa rừng.
   *
   * `null` KHÔNG có nghĩa là thiếu dữ liệu: bầy Sói không có nhà riêng trong
   * mô hình này, và một cú tấn công đêm bắt đầu từ ngoài làng.
   */
  originId: string | null;
  /** Nhà mà hiệu ứng tác động tới, theo đúng thứ tự trong evidence. */
  targetIds: string[];
  tally: VillageTally | null;
  cameraTarget: { x: number; z: number };
  /** Phong thư mở đúng ở bước này. Rỗng là chuyện thường. */
  letters: CaseLastLetter[];
}

export interface VillageMemoryModel {
  caseId: string;
  title: string;
  /** Kết cục của ván, cả bốn giá trị. Xem `CaseFile.winner`. */
  winner: MatchOutcome;
  winnerLabel: string;
  subtitle: string;
  houses: VillageHouse[];
  steps: VillageStep[];
  /**
   * Thư không ghép chắc chắn được vào bước nào, hiện ở phần kết.
   *
   * Thà để một lá thư ở cuối còn hơn gán nó vào một bước chỉ vì trùng vòng: một
   * phong bì bay lên trên mái nhà của người chưa chết là nói sai chuyện đã xảy
   * ra, và đây là màn XEM LẠI chứ không phải một màn dựng lại tự do.
   */
  epilogueLetters: CaseLastLetter[];
  groundRadius: number;
}

// ---- Bố cục làng ----

/** Đêm trước, ngày sau - cùng thứ tự mà hồ sơ dùng để xếp dòng thời gian. */
const PHASE_RANK = { night: 0, day: 1 } as const;

const momentKey = (round: number, phase: "night" | "day") => round * 2 + PHASE_RANK[phase];

/**
 * Làm tròn về 4 chữ số thập phân.
 *
 * Không phải để cho đẹp: `deepEqual` giữa hai lần dựng phải khớp tuyệt đối, và
 * một toạ độ đi qua `cos`/`sin` rồi lại qua phép lấy trung bình có thể lệch ở
 * bit cuối. 4 chữ số là dư sức cho một mô hình rộng chục đơn vị.
 */
const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

/** Băm ổn định một chuỗi. FNV-1a, cùng loại hàm mà `caseIdFor` đang dùng. */
function hashId(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Bán kính vòng nhà.
 *
 * Chu vi phải nở theo số người thì khoảng cách giữa hai nếp nhà mới giữ nguyên;
 * bán kính cố định sẽ làm bàn 15 người chồng nhà lên nhau còn bàn 5 người thì
 * thành năm chấm rời rạc trên một vành đai trống. Sàn 4.0 để bàn ít người vẫn
 * chừa đủ chỗ cho quảng trường ở giữa.
 */
const HOUSE_SPACING = 2.6;
const MIN_RING_RADIUS = 4;

export function ringRadius(count: number): number {
  return round4(Math.max(MIN_RING_RADIUS, (count * HOUSE_SPACING) / (2 * Math.PI)));
}

function accentFor(role: Role): VillageAccent {
  if (ROLE_META[role].team === "wolves") return "wolf";
  if (role === "SERIAL_KILLER") return "killer";
  if (ROLE_META[role].team === "neutral") return "jester";
  switch (role) {
    case "GUARD":
    case "GUARDIAN_ANGEL":
      return "guard";
    case "SEER":
    case "APPRENTICE_SEER":
    case "DETECTIVE":
      return "seer";
    case "WITCH":
      return "witch";
    case "HUNTER":
      return "hunter";
    default:
      return "villager";
  }
}

/**
 * Vòng nhà quanh quảng trường.
 *
 * Xếp theo `playerId` đã SẮP XẾP chứ không theo thứ tự mảng `players`: thứ tự
 * đó là thứ tự ghế của server, và nó có thể khác nhau giữa hai lần nhận snapshot
 * cho cùng một ván. Một người chơi mở lại màn hồi ức phải thấy đúng ngôi làng
 * cũ, không phải một làng đã bị xáo chỗ.
 *
 * Cắt còn `MAX_VILLAGE_HOUSES` là một cái van, không phải một luật chơi: trần
 * người mỗi phòng đã là 15, nên nhánh này chỉ chạy nếu một ngày nào đó trần kia
 * được nới mà chỗ này thì chưa - và lúc đó thà mất vài căn nhà còn hơn tụt
 * khung hình trên điện thoại.
 */
function buildHouses(cast: CaseFilePlayer[]): VillageHouse[] {
  const ordered = [...cast]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_VILLAGE_HOUSES);

  const radius = ringRadius(ordered.length);
  return ordered.map((player, index) => {
    // Bắt đầu từ phía xa camera rồi đi thuận chiều kim đồng hồ.
    const angle = (index / ordered.length) * Math.PI * 2 - Math.PI / 2;
    return {
      playerId: player.id,
      name: player.name,
      roleLabel: roleLabelOf(player),
      teamLabel: teamLabel(player.team),
      team: player.team,
      aliveAtEnd: player.alive,
      accent: accentFor(player.role),
      variant: hashId(player.id) % 3,
      x: round4(Math.cos(angle) * radius),
      z: round4(Math.sin(angle) * radius),
    };
  });
}

// ---- Ánh xạ điểm ngoặt thành hiệu ứng ----

interface EffectPlan {
  effect: VillageEffect;
  originId: string | null;
  targetIds: string[];
  tally: VillageTally | null;
}

/**
 * Hiệu ứng của một điểm ngoặt, suy TỪ EVIDENCE.
 *
 * Bắt trên `evidence.kind` chứ không trên `highlight.type` ở những chỗ cần lấy
 * id: chỉ `evidence` mới nói được ai bắn ai, ai soi ai. `type` chỉ dùng để phân
 * biệt hai loại điểm ngoặt chia chung một evidence (`lynch` với `acquittal`
 * đã tách sẵn, còn `HUNTER_MISFIRE` và `HUNTER_REVENGE` thì cùng một cảnh).
 *
 * `default` KHÔNG được ném lỗi và cũng không được trả rỗng: một loại mới thêm
 * vào hồ sơ phải rơi vào `GENERIC` và vẫn có camera nhắm vào người trong cuộc.
 */
function planFor(highlight: CaseHighlight, hasHouse: (id: string) => boolean): EffectPlan {
  const evidence = highlight.evidence;
  const keep = (ids: string[]) => ids.filter(hasHouse);
  const origin = (id: string) => (hasHouse(id) ? id : null);
  const plain = (effect: VillageEffect, targets: string[]): EffectPlan => ({
    effect,
    originId: null,
    targetIds: keep(targets),
    tally: null,
  });

  switch (evidence.kind) {
    case "bloodbath":
      // Bóng Sói chạy từ rìa rừng: bầy Sói không có một mái nhà làm điểm xuất phát.
      return plain("WOLF_ATTACK", evidence.victimIds);
    case "guard-save":
    case "angel-save":
      return plain("SHIELD_SAVE", [evidence.savedId]);
    case "witch-save":
      return plain("WITCH_HEAL", [evidence.savedId]);
    case "witch-poison":
      return plain("WITCH_POISON", [evidence.poisonedId]);
    case "seer-check":
      return {
        effect: "SEER_BEAM",
        originId: origin(evidence.seerId),
        targetIds: keep([evidence.targetId]),
        tally: null,
      };
    case "hunter-shot":
      return {
        effect: "HUNTER_SHOT",
        originId: origin(evidence.hunterId),
        targetIds: keep([evidence.targetId]),
        tally: null,
      };
    case "lynch":
      return {
        effect: "LYNCH",
        originId: null,
        targetIds: keep([evidence.accusedId]),
        tally: { hang: evidence.guilty, spare: evidence.innocent, abstain: evidence.abstain },
      };
    case "acquittal":
      return {
        effect: "TRIAL_SCALES",
        originId: null,
        targetIds: keep([evidence.accusedId]),
        tally: { hang: evidence.guilty, spare: evidence.innocent, abstain: evidence.abstain },
      };
    case "vote-swing":
      // Cùng cảnh hai đĩa cân với phiên toà tha bổng, nhưng KHÔNG có bảng kiểm
      // phiếu: `vote-swing` chỉ ghi lại thứ tự một lá phiếu đổi chiều. Dựng một
      // con số ở đây là bịa, nên cân chỉ nghiêng bằng chính lá phiếu đó.
      return {
        effect: "TRIAL_SCALES",
        originId: origin(evidence.voterId),
        targetIds: keep([evidence.accusedId]),
        tally: null,
      };
    case "cursed-turned":
      return plain("CURSED_MOON", [evidence.playerId]);
    case "lone-survivor":
      return plain("LONE_LIGHT", [evidence.playerId]);
    case "priest":
      return plain("GENERIC", [evidence.priestId, evidence.targetId]);
    case "quiet-match":
      return plain("GENERIC", []);
    default:
      // Loại evidence chưa biết: vẫn dựng bước, chỉ soi vào người có mặt.
      return plain("GENERIC", highlight.participants);
  }
}

/**
 * Điểm ngoặt xếp theo thứ tự XẢY RA.
 *
 * `selectHighlights` đã trả về đúng thứ tự này, nên với hồ sơ vừa dựng xong thì
 * đây là một phép sao chép. Nó tồn tại vì đường vào thứ hai: lịch sử trận đọc
 * `caseFile` lên từ một cột Json, do một phiên bản server nào đó ghi ra, và
 * kiểu của nó ở đó là `unknown`. Một màn hồi ức kể Ngày 3 trước Đêm 1 thì không
 * còn là hồi ức nữa, và tin vào thứ tự của dữ liệu ngoài là chỗ để chuyện đó
 * xảy ra.
 *
 * Cùng bộ khoá so sánh mà `selectHighlights` dùng, tới tận `type` - một chuỗi
 * duy nhất trong toàn tập - nên thứ tự là TOÀN PHẦN chứ không dựa vào tính ổn
 * định của `Array.sort`.
 */
function chronological(highlights: CaseHighlight[]): CaseHighlight[] {
  return [...highlights].sort(
    (a, b) =>
      a.round - b.round ||
      PHASE_RANK[a.phase] - PHASE_RANK[b.phase] ||
      b.importance - a.importance ||
      (a.type < b.type ? -1 : a.type > b.type ? 1 : 0),
  );
}

// ---- Sáng tối theo dòng thời gian ----

/**
 * Bước nào tắt đèn của ai.
 *
 * Đây là chỗ trả lời câu hỏi khó nhất của tính năng: một mái nhà sáng hay tối
 * KHÔNG được lấy từ trạng thái cuối ván, vì như vậy thì cảnh Đêm 1 đã hiện ra
 * một ngôi làng chết. Nó phải lấy từ dòng thời gian, tính lại ở từng bước.
 *
 * Mỗi cái chết được gán vào ĐÚNG MỘT bước, theo ba nấc:
 *
 *   1. Có bước nào cùng vòng-cùng pha VÀ có người chết trong danh sách người
 *      trong cuộc không? Bước đó tắt đèn - đó chính là cảnh kể cái chết này.
 *   2. Không thì lấy bước CUỐI ở cùng vòng-cùng pha: cái chết vẫn xảy ra trong
 *      khoảnh khắc ấy, chỉ là hồ sơ chọn kể một chuyện khác của cùng đêm đó.
 *   3. Không có bước nào ở khoảnh khắc ấy: đèn đã tắt SẴN từ trước khi bước kế
 *      tiếp bắt đầu. Không có cảnh nào để tắt nó, và không được dựng ra một cảnh.
 *
 * Hai nấc đầu là `during` - đèn tắt TRONG bước, nên hiệu ứng còn kịp diễn.
 * Nấc ba là `before` - đèn đã tối ngay từ khung hình đầu của bước đó.
 */
interface DeathMark {
  index: number;
  during: boolean;
}

function markDeaths(
  highlights: CaseHighlight[],
  timeline: CaseFile["timeline"],
  hasHouse: (id: string) => boolean,
): Map<string, DeathMark> {
  const stepMoments = highlights.map((h) => momentKey(h.round, h.phase));
  const marks = new Map<string, DeathMark>();

  for (const entry of timeline) {
    // `cursed-turned` là đổi phe, KHÔNG phải chết. Kẻ Nguyền Rủa hoá Sói vẫn
    // ngồi trong nhà mình và vẫn sáng đèn cho tới lúc thật sự ngã xuống.
    if (entry.kind !== "death") continue;
    if (!hasHouse(entry.playerId)) continue;
    // Một người chỉ chết một lần; bản ghi đầu tiên là bản ghi đúng.
    if (marks.has(entry.playerId)) continue;

    const key = momentKey(entry.round, entry.phase);
    const sameMoment: number[] = [];
    for (let index = 0; index < stepMoments.length; index += 1) {
      if (stepMoments[index] === key) sameMoment.push(index);
    }

    if (sameMoment.length > 0) {
      const claimed = sameMoment.find((index) =>
        highlights[index].participants.includes(entry.playerId),
      );
      marks.set(entry.playerId, {
        index: claimed ?? sameMoment[sameMoment.length - 1],
        during: true,
      });
      continue;
    }

    const after = stepMoments.findIndex((moment) => moment > key);
    // Chết SAU bước cuối cùng: ở mọi bước có thật, người này vẫn còn sống, nên
    // nhà vẫn sáng. Đó là sự thật của dòng thời gian, không phải một lỗ hổng.
    if (after < 0) continue;
    marks.set(entry.playerId, { index: after, during: false });
  }

  return marks;
}

const isDarkAtStart = (mark: DeathMark | undefined, stepIndex: number) =>
  mark !== undefined && (mark.during ? mark.index < stepIndex : mark.index <= stepIndex);

// ---- Dựng model ----

/**
 * Dựng mô hình hồi ức từ một ván ĐÃ KẾT THÚC.
 *
 * Trả `null` ở hai cửa, và cả hai đều đóng: snapshot chưa ở `GAME_OVER`, hoặc
 * chưa có hồ sơ vụ án. Cửa thứ hai đã bao cửa thứ nhất - `buildCaseFile` cũng
 * gác đúng pha đó - nhưng để lại cả hai vì bên gọi có thể truyền một hồ sơ đọc
 * từ nơi khác, và lúc đó chỉ còn `snapshot.phase` nói được ván đã xong hay chưa.
 */
export function buildVillageMemory(
  snapshot: RoomSnapshot,
  file: CaseFile | null,
): VillageMemoryModel | null {
  if (snapshot.phase !== "GAME_OVER") return null;
  if (!file) return null;

  const houses = buildHouses(file.cast);
  const byId = new Map(houses.map((house) => [house.playerId, house]));
  const hasHouse = (id: string) => byId.has(id);
  const highlights = chronological(file.highlights);
  const marks = markDeaths(highlights, file.timeline, hasHouse);

  const steps: VillageStep[] = highlights.map((highlight, index) => {
    const plan = planFor(highlight, hasHouse);
    // Camera nhắm vào NGƯỜI BỊ TÁC ĐỘNG trước; thiếu thì lấy người trong cuộc;
    // thiếu nữa thì về quảng trường. Một ván "khép nhanh" không có ai để nhìn,
    // và lúc đó nhìn toàn cảnh là câu trả lời đúng chứ không phải nhìn vào một
    // căn nhà chọn bừa.
    const aim = plan.targetIds.length > 0 ? plan.targetIds : highlight.participants.filter(hasHouse);

    return {
      id: `${index}:${highlight.type}:${highlight.round}:${highlight.phase}`,
      index,
      round: highlight.round,
      phase: highlight.phase,
      momentLabel: momentLabel(highlight.round, highlight.phase),
      effect: plan.effect,
      title: highlight.title,
      description: highlight.description,
      participantIds: highlight.participants.filter(hasHouse),
      litIds: houses
        .filter((house) => !isDarkAtStart(marks.get(house.playerId), index))
        .map((house) => house.playerId),
      extinguishIds: [],
      originId: plan.originId,
      targetIds: plan.targetIds,
      tally: plan.tally,
      cameraTarget: centroid(aim, byId),
      letters: [],
    };
  });

  for (const [playerId, mark] of marks) {
    if (mark.during) steps[mark.index]?.extinguishIds.push(playerId);
  }
  // `marks` giữ thứ tự chèn, tức thứ tự của `file.timeline` - vốn đã được
  // `buildCaseFile` sắp xếp toàn phần. Sắp lại theo id để không phụ thuộc vào
  // một tính chất của Map mà chẳng ai buộc phải giữ.
  for (const step of steps) step.extinguishIds.sort();

  const epilogueLetters: CaseLastLetter[] = [];
  for (const letter of Array.isArray(file.lastLetters) ? file.lastLetters : []) {
    const mark = marks.get(letter.authorId);
    const step = mark && mark.during ? steps[mark.index] : undefined;
    // Ghép được thì phải ghép CHẮC: đúng bước tắt đèn của tác giả, và đúng vòng
    // lá thư được mở. Chỉ trùng một trong hai là chưa đủ.
    if (step && step.round === letter.openedRound) step.letters.push(letter);
    else epilogueLetters.push(letter);
  }

  return {
    caseId: file.caseId,
    title: VILLAGE_MEMORY_TITLE,
    winner: file.winner,
    // `teamLabel(file.winner)` cũ tra một `MatchOutcome` vào bảng nhãn PHE: với
    // `serial_killer` và `draw` nó ra `undefined`, và màn hồi ức mở đầu bằng
    // dòng "Phe undefined chiến thắng".
    winnerLabel: outcomeHeadline(file.winner),
    subtitle: `${roundsLabel(file.rounds)} · ${houses.length} người chơi`,
    houses,
    steps,
    epilogueLetters,
    // Nền đất phải rộng hơn vòng nhà đủ để còn chỗ cho rìa rừng và sương.
    groundRadius: round4(ringRadius(houses.length) + 3.2),
  };
}

function centroid(ids: string[], byId: Map<string, VillageHouse>): { x: number; z: number } {
  const points = ids.map((id) => byId.get(id)).filter((house): house is VillageHouse => !!house);
  if (points.length === 0) return { x: 0, z: 0 };
  const sum = points.reduce((acc, house) => ({ x: acc.x + house.x, z: acc.z + house.z }), {
    x: 0,
    z: 0,
  });
  return { x: round4(sum.x / points.length), z: round4(sum.z / points.length) };
}

// ---- Bảng nhà, dùng chung cho bản 3D lẫn bản dự phòng 2D ----

/**
 * Trạng thái ánh đèn của một căn nhà TẠI bước đang xem.
 *
 * Ba mức chứ không phải hai, vì "tắt ở bước này" là một câu chuyện khác hẳn với
 * "đã tắt từ trước": mức giữa chính là điều mà bước hiện tại đang kể.
 */
export type VillageLightState = "lit" | "extinguishing" | "dark";

/**
 * Nhãn chữ của từng trạng thái.
 *
 * Đây là chỗ thi hành lời hứa "không truyền đạt bằng riêng màu": mô hình 3D nói
 * sáng/tắt bằng ánh đèn và sương, còn dòng chữ này nói đúng điều đó cho người
 * không phân biệt được màu, cho ảnh chụp đen trắng, và cho trình đọc màn hình.
 */
export const VILLAGE_LIGHT_LABEL: Record<VillageLightState, string> = {
  lit: "Nhà còn sáng đèn",
  extinguishing: "Nhà tắt đèn ở bước này",
  dark: "Nhà đã tắt đèn",
};

export interface VillageLegendEntry {
  playerId: string;
  name: string;
  roleLabel: string;
  teamLabel: string;
  accent: VillageAccent;
  state: VillageLightState;
  /** Câu chữ của `state`, để nơi hiển thị không phải tự tra bảng. */
  statusLabel: string;
  /** Người trong cuộc của bước này: nguồn, mục tiêu, hoặc người tham gia. */
  focused: boolean;
}

/**
 * Bảng nhà tại một bước.
 *
 * MỘT hàm cho cả hai chế độ hiển thị. Bản 3D vẽ được ngôi làng nhưng không viết
 * được chữ lên nó - tên và vai phải nằm trong DOM, không dựng bằng 3D text - còn
 * bản dự phòng 2D thì chỉ có chữ. Hai đường vẽ khác nhau, nhưng "ai còn sáng
 * đèn, ai vừa tắt, ai đang là tâm điểm" phải là CÙNG một câu trả lời, nếu không
 * thì mất context WebGL giữa chừng sẽ đổi luôn nội dung người xem đang đọc.
 *
 * Ở cảnh mở đầu (`step === null`) bảng nói trạng thái CUỐI ván - đó là ngôi
 * làng mà người chơi vừa rời khỏi, và cả trải nghiệm là một cuộc tua ngược lại
 * xem nó đã thành ra như vậy bằng cách nào.
 */
export function villageLegend(
  houses: readonly VillageHouse[],
  step: VillageStep | null,
): VillageLegendEntry[] {
  const extinguishing = new Set(step?.extinguishIds ?? []);
  const lit = new Set(step?.litIds ?? []);
  const focused = new Set(
    step
      ? [...step.targetIds, ...step.participantIds, ...(step.originId ? [step.originId] : [])]
      : [],
  );

  return houses.map((house) => {
    const state: VillageLightState = step
      ? extinguishing.has(house.playerId)
        ? "extinguishing"
        : lit.has(house.playerId)
          ? "lit"
          : "dark"
      : house.aliveAtEnd
        ? "lit"
        : "dark";

    return {
      playerId: house.playerId,
      name: house.name,
      roleLabel: house.roleLabel,
      teamLabel: house.teamLabel,
      accent: house.accent,
      state,
      statusLabel: VILLAGE_LIGHT_LABEL[state],
      focused: focused.has(house.playerId),
    };
  });
}
