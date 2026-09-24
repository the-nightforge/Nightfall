/**
 * Đêm: nhận hành động của từng vai và tính kết cục của cả đêm.
 *
 * Hai hàm dài nhất của engine (mỗi hàm ~330 dòng) sống ở đây để `engine.ts`
 * còn đọc được như một bản đồ các pha. Import `GameEngine` bằng `import type`,
 * cùng quy ước với `engine-views.ts`.
 */
import type { GameEngine } from "./engine";

import {
  RESULT_MS,
  isWolfPack,
  roleTeam,
  sameFaction,
  type NightRecap,
  type RecapPlayer,
  type Role,
  type Team,
} from "@masoi/shared";
import {
  GameError,
  type DeathInfo,
  type EnginePlayer,
  type GameState,
} from "./types";

/** Hành động đêm mà `submitNightAction` chấp nhận. */
export type NightActionType =
  | "KILL"
  | "SEE"
  | "GUARD"
  | "HEAL"
  | "POISON"
  | "SKIP"
  | "DETECTIVE_CHECK"
  | "SERIAL_KILL"
  | "SORCERER_CHECK"
  | "TRACK";

const recapPlayer = (player: EnginePlayer | undefined): RecapPlayer | null =>
  player ? { id: player.id, name: player.name } : null;

/**
 * "Ra tay" = có nộp một hành động đêm CÓ MỤC TIÊU.
 *
 * `SKIP`, Phù Thuỷ bỏ qua cả hai bình, Sát Nhân bỏ lượt, và Sói bỏ phiếu `null`
 * đều KHÔNG tính. Mọi hành động đã để lại dấu trong `NightState`, nên hàm này
 * chỉ tra chứ không cần thêm state ghi chép nào.
 */
function didActTonight(st: GameState, playerId: string): boolean {
  const n = st.night;
  // Sói: bỏ phiếu một mục tiêu là ra tay; `null` (không cắn) thì không.
  if (n.wolfVotes[playerId] != null) return true;
  if (n.seerResults[playerId] !== undefined) return true;
  if (n.sorcererResults[playerId] !== undefined) return true;
  if (n.detectiveResults[playerId] !== undefined) return true;
  if (n.trackerTargets[playerId] !== undefined) return true;

  // Vai một-người-một-ghế: ánh xạ vai -> người rồi mới đọc ô của vai đó.
  const player = st.players.find((p) => p.id === playerId);
  if (!player) return false;
  if (player.role === "GUARD") return n.guardTarget !== null;
  if (player.role === "WITCH") return n.healTonight || n.poisonTarget !== null;
  if (player.role === "SERIAL_KILLER") return (n.serialKillerTarget ?? null) !== null;
  return false;
}

export function submitNightAction(
  engine: GameEngine,
  playerId: string,
  type: NightActionType,
  targetId: string | null,
  secondaryTargetId?: string | null,
  rng: () => number = Math.random,
): void {
  const st = engine.state;
  if (st.phase !== "NIGHT") throw new GameError("Chỉ được hành động vào ban đêm");
  const p = engine.mustPlayer(playerId);
  if (!p.alive) throw new GameError("Người chết không thể hành động");
  // `hasNightAction` đã giấu hành động khỏi mọi màn hình và mọi lõi bot; đây
  // là chỗ DUY NHẤT có quyền cưỡng chế, nên luật phải được nhắc lại ở đây.
  if (roleTeam(p.role) === "village" && !engine.villagePowersActive()) {
    throw new GameError("Kỹ năng đặc biệt của phe làng đã mất hiệu lực");
  }

  const target = targetId ? engine.player(targetId) : undefined;
  if (targetId && !target) throw new GameError("Mục tiêu không tồn tại");
  // Mọi hành động đêm đều nhắm vào người còn sống, không có ngoại lệ: vai
  // duy nhất từng được chừa ra (Bà Đồng gọi hồn) đã bị xóa cứng.
  if (target && !target.alive) {
    throw new GameError("Mục tiêu đã chết");
  }

  const isWitchMedicine = type === "HEAL" || type === "POISON";
  if (isWitchMedicine && p.role !== "WITCH") {
    throw new GameError("Chỉ Phù Thủy mới được dùng thuốc");
  }
  // Phù Thuỷ đi sau bầy Sói: chỉ hành động khi đã biết nạn nhân đêm nay.
  if (p.role === "WITCH" && !st.night.wolvesLocked) {
    throw new GameError("Chưa tới lượt Phù Thủy");
  }
  if ((isWitchMedicine || (type === "SKIP" && p.role === "WITCH")) && st.night.witchSkipped) {
    throw new GameError("Phù Thủy đã bỏ qua dùng thuốc đêm nay");
  }
  if ((type === "KILL" || (type === "SKIP" && isWolfPack(p.role))) && st.night.wolvesLocked) {
    throw new GameError("Bầy Sói đã chốt mục tiêu đêm nay");
  }

  switch (type) {
    case "KILL": {
      if (!isWolfPack(p.role)) throw new GameError("Chỉ Ma Sói mới được cắn");
      if (!targetId || !target) throw new GameError("Hãy chọn một mục tiêu để cắn");
      /*
       * `isWolfPack`, KHÔNG phải `roleTeam`: bầy phải cắn được Kẻ Phản Bội.
       *
       * Bầy không biết nó là ai, nên một lời từ chối ở đây chính là một lời
       * khai - người chơi thử từng tên cho tới khi engine kêu lên là biết.
       * Ngược lại, một Kẻ Phản Bội chết vì đồng minh của chính nó là một kết
       * cục hoàn toàn hợp lệ của lá bài này.
       */
      if (isWolfPack(target.role)) throw new GameError("Không thể cắn đồng bọn");
      // Một phiếu, không phải quyết định cuối: Sói được đổi ý tới lúc khoá phiếu.
      st.night.wolfVotes[playerId] = targetId;
      if (secondaryTargetId) {
        const canDoubleKill = st.night.wolfCubRageTonight || st.activeEvent?.id === "BLOODY_HUNT";
        if (!canDoubleKill) throw new GameError("Chỉ được cắn 2 mục tiêu khi có Sói Con phẫn nộ hoặc event Cuộc Săn Đẫm Máu");
        const secTarget = engine.player(secondaryTargetId);
        if (!secTarget || !secTarget.alive) throw new GameError("Mục tiêu phụ không hợp lệ");
        // Cùng lý do với mục tiêu chính ngay trên.
        if (isWolfPack(secTarget.role)) throw new GameError("Không thể cắn đồng bọn");
        if (targetId === secondaryTargetId) throw new GameError("Không thể cắn cùng một người 2 lần");
        st.night.wolfSecondaryTarget = secondaryTargetId;
      }
      break;
    }
    /*
     * Sát Nhân ra tay MỘT MÌNH.
     *
     * Không đi qua `wolfVotes`, không bị `wolvesLocked` chặn, và không kiểm
     * phiếu với ai: nó là một người, không phải một bầy. Vì thế nó cũng đổi ý
     * được tới lúc đêm khép lại - đúng như bầy Sói trước khi khoá phiếu.
     *
     * Ngoại lệ duy nhất là BỎ QUA: một khi đã chốt "đêm nay không giết ai"
     * thì không rút lại được, cùng luật và cùng lý do với `witchSkipped` -
     * một quyết định bỏ lượt phải là một quyết định, không phải một khoảng
     * trống để lấp lại sau.
     */
    case "SERIAL_KILL": {
      if (p.role !== "SERIAL_KILLER") throw new GameError("Chỉ Sát Nhân mới được ra tay");
      if (!targetId || !target) throw new GameError("Hãy chọn một người để giết");
      if (targetId === playerId) throw new GameError("Sát Nhân không thể tự giết mình");
      if (st.night.serialKillerSkipped) {
        throw new GameError("Sát Nhân đã bỏ qua đêm nay");
      }
      st.night.serialKillerTarget = targetId;
      break;
    }
    case "SEE": {
      const canSee = p.role === "SEER" || (p.role === "APPRENTICE_SEER" && st.apprenticeAwakened);
      if (!canSee) throw new GameError("Chỉ Tiên Tri (hoặc Tiên Tri Tập Sự đã thức tỉnh) mới được soi");
      // MỘT lượt soi mỗi đêm, chốt ngay tại lần nộp đầu.
      //
      // Sói và Bảo Vệ được đổi ý tới hết đêm vì lựa chọn của họ
      // KHÔNG trả lại thông tin gì; kết quả soi thì hiện ra ngay trong
      // snapshot của chính lần nộp này. Không có hàng rào ở đây thì "đổi ý"
      // trở thành "soi lại", và soi lại không giới hạn là quét sạch cả làng
      // trong một đêm - đủ để kết thúc ván ngay đêm 1.
      //
      // Ba chỗ khác của engine (`acted`, `nightActionPending`, và bộ chọn
      // hành động hợp lệ của BOT) từ trước tới nay đã coi "có kết quả soi" là
      // "đã hết lượt". Dòng này chỉ mang luật ấy về đúng nơi có quyền cưỡng
      // chế: client giấu nút đi không phải là một hàng rào.
      if (st.night.seerResults[playerId]) throw new GameError("Bạn đã soi trong đêm nay");
      if (st.activeEvent?.id === "MOONLESS_NIGHT") {
        throw new GameError("Đêm Không Trăng: Tiên Tri không thể soi đêm nay");
      }
      if (!targetId || !target) throw new GameError("Hãy chọn một người để soi");
      if (targetId === playerId) throw new GameError("Không thể soi chính mình");

      let secTargetId: string | undefined;
      let secTeam: Team | undefined;

      if (secondaryTargetId) {
        if (st.activeEvent?.id !== "CLEARING_MIST") {
          throw new GameError("Chỉ được soi 2 người khi có sự kiện Màn Sương Tan");
        }
        const secTarget = engine.player(secondaryTargetId);
        if (!secTarget || !secTarget.alive) throw new GameError("Mục tiêu soi thứ 2 không hợp lệ");
        if (targetId === secondaryTargetId) throw new GameError("Không thể soi cùng 1 người 2 lần");
        secTargetId = secondaryTargetId;
        secTeam = secTarget.role === "TRAITOR" ? "village" : roleTeam(secTarget.role);
      }

      const isWolfShadow = st.activeEvent?.id === "WOLF_SHADOW";
      const shouldFlip = isWolfShadow && rng() < 0.3;
      /*
       * Kết quả soi là một PHE, và `isWolf` là hệ quả của nó.
       *
       * Trước đây chỉ có `isWolf`, và với hai phe thì "không phải Sói" đúng
       * bằng "phe làng". Với một vai trung lập thì câu đó thành lời nói dối:
       * Tiên Tri phải đọc ra "Phe trung lập" chứ không phải một lời bảo đảm
       * rằng người kia đứng về phía làng.
       *
       * Bóng Sói lật kết quả thì lật cả hai cho khớp nhau: một mục tiêu bị
       * lật luôn hiện ra là Sói (hoặc là làng nếu nó vốn là Sói), chứ không
       * bao giờ là một phe thứ ba mà nó không hề thuộc về.
       */
      const flipTeam = (team: Team): Team =>
        shouldFlip ? (team === "wolves" ? "village" : "wolves") : team;
      /*
       * Kẻ Phản Bội hiện ra là PHE LÀNG, không phải phe Sói.
       *
       * Đây là cả lá bài: nó thắng cùng phe Sói (`roleTeam` trả về `wolves`,
       * và `checkWin` đếm nó) nhưng Tiên Tri soi không ra. Để `roleTeam` chạy
       * thẳng ở đây thì nó chỉ còn là một con Sói không biết cắn.
       *
       * `village` chứ không phải `neutral`: nó không phải một phe thứ ba, và
       * Tiên Tri phải đọc ra đúng thứ mà một người làng đọc ra.
       */
      const seenTeam = (role: Role): Team =>
        role === "TRAITOR" ? "village" : roleTeam(role);
      const team = flipTeam(seenTeam(target.role));
      if (secTeam !== undefined) secTeam = flipTeam(secTeam);

      const seerResult: GameState["night"]["seerResults"][string] = {
        targetId,
        isWolf: team === "wolves",
        team,
      };
      if (secTargetId !== undefined) {
        seerResult.secondaryTargetId = secTargetId;
        seerResult.secondaryIsWolf = secTeam === "wolves";
        seerResult.secondaryTeam = secTeam;
      }

      st.night.seerResults[playerId] = seerResult;
      break;
    }
    case "GUARD": {
      if (p.role !== "GUARD") throw new GameError("Chỉ Bảo Vệ mới được bảo vệ");
      if (!targetId || !target) throw new GameError("Hãy chọn một người để bảo vệ");
      if (targetId === playerId) throw new GameError("Bảo Vệ không thể tự bảo vệ mình");
      if (engine.guardedLastNight().includes(targetId)) {
        throw new GameError("Không thể bảo vệ cùng một người hai đêm liên tiếp");
      }
      /*
       * Mục tiêu thứ hai: gương đúng Màn Sương Tan của Tiên Tri ở trên.
       *
       * Mọi luật của lượt che đầu áp lại y nguyên cho lượt thứ hai - không tự
       * che, không che lại người đêm trước, không trùng người vừa chọn. Nới
       * một luật ra ở đây là biến sự kiện thành đường vòng qua chính luật của
       * vai: "che 2 người" phải là hai lượt che, không phải một lượt che cộng
       * một ngoại lệ.
       */
      let guardSecondId: string | null = null;
      if (secondaryTargetId) {
        if (st.activeEvent?.id !== "VIGILANT_NIGHT") {
          throw new GameError("Chỉ được che 2 người khi có sự kiện Đêm Cảnh Giác");
        }
        const secTarget = engine.player(secondaryTargetId);
        if (!secTarget || !secTarget.alive) throw new GameError("Mục tiêu che thứ 2 không hợp lệ");
        if (secondaryTargetId === playerId) throw new GameError("Bảo Vệ không thể tự bảo vệ mình");
        if (secondaryTargetId === targetId) throw new GameError("Không thể che cùng 1 người 2 lần");
        if (engine.guardedLastNight().includes(secondaryTargetId)) {
          throw new GameError("Không thể bảo vệ cùng một người hai đêm liên tiếp");
        }
        guardSecondId = secondaryTargetId;
      }
      st.night.guardTarget = targetId;
      st.night.guardSecondTarget = guardSecondId;
      break;
    }
    case "TRACK": {
      if (p.role !== "TRACKER") throw new GameError("Chỉ Kẻ Theo Dõi mới được theo dõi");
      if (!targetId || !target) throw new GameError("Hãy chọn một người để theo dõi");
      // Gương theo Tiên Tri và Bảo Vệ. Thêm nữa: "đêm nay tôi có ra tay
      // không" là thứ chính chủ đã biết, nên tự nhắm là nước phí trắng.
      if (targetId === playerId) {
        throw new GameError("Kẻ Theo Dõi không thể theo dõi chính mình");
      }
      // CỐ Ý không cấm lặp mục tiêu hai đêm liền - xem plan Task 2.
      st.night.trackerTargets[playerId] = targetId;
      break;
    }
    case "DETECTIVE_CHECK": {
      if (p.role !== "DETECTIVE") throw new GameError("Chỉ Thám Tử mới được kiểm tra");
      // Cùng lý do với lượt soi ở trên: kết quả về ngay lúc nộp, nên lần nộp
      // đầu tiên là lần duy nhất.
      if (st.night.detectiveResults[playerId]) {
        throw new GameError("Thám Tử đã điều tra trong đêm nay");
      }
      if (!targetId || !secondaryTargetId) {
        throw new GameError("Thám Tử cần chọn đủ 2 người chơi khác nhau để kiểm tra");
      }
      if (targetId === secondaryTargetId) {
        throw new GameError("Không thể chọn cùng một người chơi 2 lần");
      }
      /*
       * Thám Tử không được ghép chính mình vào cặp.
       *
       * Không phải một luật cho gọn: tự ghép biến vai này THÀNH Tiên Tri. Thám
       * Tử biết chắc phe của chính nó, nên cặp `mình + X` đọc ra "cùng phe" là
       * X thuộc phe làng, "khác phe" là X thuộc Sói hoặc trung lập - một lượt
       * soi mỗi đêm, đúng thứ mà kết quả hai người vốn KHÔNG được phép nói.
       * Cái giá thiết kế của vai này là không biết ai trong hai người là Sói;
       * tự ghép xoá sạch cái giá đó.
       *
       * Hàng rào phải nằm ở đây chứ không chỉ ở `legalTargets`: danh sách hợp
       * lệ là gợi ý cho client và cho BOT, còn engine mới là nơi có quyền cưỡng
       * chế. Lõi BOT vốn đã tự loại mình (`bot/roles/detective.ts`), nên lỗ này
       * chỉ người thật khai thác được - tức self-play không bao giờ đo thấy nó.
       */
      if (targetId === playerId || secondaryTargetId === playerId) {
        throw new GameError("Thám Tử không thể tự đưa mình vào cặp kiểm tra");
      }
      const t1 = engine.player(targetId);
      const t2 = engine.player(secondaryTargetId);
      if (!t1 || !t1.alive || !t2 || !t2.alive) {
        throw new GameError("Cả 2 mục tiêu phải còn sống");
      }
      /*
       * `sameFaction`, KHÔNG phải `roleTeam(a) === roleTeam(b)`.
       *
       * Hai vai trung lập cùng mang nhãn `neutral` nhưng không đứng cùng ai,
       * kể cả nhau: Sát Nhân đi tìm cái chết của cả bàn, Thằng Hề thì không.
       * Trả "cùng phe" cho cặp đó là đưa cho Thám Tử một kết luận sai về đúng
       * hai lá bài nguy hiểm nhất ván.
       */
      const sameTeam = sameFaction(t1.role, t2.role);
      st.night.detectiveTargets = { target1: targetId, target2: secondaryTargetId };
      st.night.detectiveResults[playerId] = {
        target1Id: targetId,
        target2Id: secondaryTargetId,
        sameTeam,
      };
      break;
    }
    case "SORCERER_CHECK": {
      if (p.role !== "SORCERER") throw new GameError("Chỉ Sói Pháp Sư mới được kiểm tra dòng Tiên Tri");
      if (st.night.sorcererResults[playerId]) {
        throw new GameError("Sói Pháp Sư đã kiểm tra trong đêm nay");
      }
      if (!targetId || !target) throw new GameError("Hãy chọn một người để kiểm tra");
      if (targetId === playerId) throw new GameError("Sói Pháp Sư không thể tự kiểm tra mình");
      const isSeerLine = target.role === "SEER" || target.role === "APPRENTICE_SEER";
      st.night.sorcererResults[playerId] = { targetId, isSeerLine };
      break;
    }
    case "HEAL": {
      if (st.healUsed) throw new GameError("Bình cứu đã được sử dụng");
      if (!st.night.killTarget) throw new GameError("Đêm nay không có ai bị cắn để cứu");
      // HEAL là quyết định cứu nạn nhân đêm nay, không cần chỉ định mục tiêu
      st.night.healTonight = true;
      break;
    }
    case "POISON": {
      if (st.poisonUsed) throw new GameError("Bình độc đã được sử dụng");
      if (!targetId || !target) throw new GameError("Hãy chọn một người để đầu độc");
      st.night.poisonTarget = targetId;
      break;
    }
    case "SKIP": {
      if (targetId !== null) throw new GameError("Bỏ qua hành động không cần mục tiêu");
      if (p.role === "WITCH") {
        // Dọn thuốc đã chọn trước đó: bỏ qua mà vẫn để nguyên lựa chọn cũ thì
        // `resolveNight` vẫn đổ thuốc, và người chơi lãnh một bình họ đã rút lại.
        st.night.healTonight = false;
        st.night.poisonTarget = null;
        st.night.witchSkipped = true;
      } else if (isWolfPack(p.role)) {
        st.night.wolfVotes[playerId] = null;
      } else if (p.role === "SERIAL_KILLER") {
        if (st.night.serialKillerSkipped) throw new GameError("Sát Nhân đã bỏ qua đêm nay");
        // Dọn mục tiêu đã chọn trước đó, cùng lý do với Phù Thuỷ ở trên: bỏ
        // qua mà vẫn để nguyên lựa chọn cũ thì `resolveNight` vẫn ra tay.
        st.night.serialKillerTarget = null;
        st.night.serialKillerSkipped = true;
      } else {
        throw new GameError("Chỉ Phù Thủy, Ma Sói hoặc Sát Nhân mới được bỏ qua hành động");
      }
      break;
    }
    default:
      throw new GameError("Hành động không hợp lệ");
  }
}

/** Xử lý toàn bộ hành động ban đêm theo thứ tự:
 * 1. Shields (Guard & Guardian Angel)
 * 2. Information (Seer, Apprentice Seer awakened, Detective)
 * 3. Offensive Actions (Wolves Bites)
 * 4. Witch Reaction (Heal & Poison)
 * 5. Impact & Conversion (Shields/Heal nullify kill, Cursed turned, Poison ignores shields)
 * 6. Post-night triggers (Hunter, Apprentice Seer awakening, Wolf Cub rage)
 */
export function resolveNight(
  engine: GameEngine,
  now = Date.now(),
  rng: () => number = Math.random,
): DeathInfo[] {
  const st = engine.state;
  if (st.phase !== "NIGHT") throw new GameError("Chỉ xử lý đêm khi đang trong pha NIGHT");

  // Đêm kết thúc mà chưa ai khoá phiếu Sói thì chốt ngay tại đây: mọi lối vào
  // resolveNight đều phải thấy cùng một killTarget đã kiểm phiếu.
  if (!st.night.wolvesLocked) engine.lockWolves(rng);

  const deaths: DeathInfo[] = [];
  const addDeath = (death: DeathInfo): void => {
    if (!deaths.some((item) => item.playerId === death.playerId)) {
      deaths.push(death);
    }
  };

  // LAST_STAND: check pending victim at start of this night's resolution
  if (engine.state.pendingLastStandVictim && engine.state.pendingLastStandVictim.dieRound <= engine.state.round) {
    const pending = engine.state.pendingLastStandVictim;
    const victim = engine.player(pending.playerId);
    if (victim && victim.alive) {
      victim.alive = false;
      engine.noteDeathOrder([victim.id]);
      addDeath({ playerId: victim.id, name: victim.name, cause: "wolf" });
      engine.state.log.push(`Tử Thủ: ${victim.name} đã gục sau khi kéo dài sự sống!`);
      engine.queueHunterReaction([{ playerId: victim.id }], "night");
      if (victim.role === "WOLF_CUB") engine.state.wolfCubRageNextNight = true;
      if (victim.role === "SEER") engine.state.apprenticeAwakened = true;
    }
    engine.state.pendingLastStandVictim = null;
  }

  // 1. Ghi nhận shields
  const guardedIds = new Set<string>();
  if (st.night.guardTarget) guardedIds.add(st.night.guardTarget);
  if (st.night.guardSecondTarget) guardedIds.add(st.night.guardSecondTarget);
  /*
   * Trăng Máu: nạp từ đêm trước thì đêm nay 20% xuyên MỘT khiên.
   *
   * Chỉ QUYẾT ĐỊNH ở đây, chưa xoá khiên nào - khiên nào bị xuyên phải đợi
   * tới lúc biết Sói cắn ai. Trước đây chỗ này gỡ ngay phần tử đầu của Set,
   * tức luôn là khiên của Bảo Vệ và không bao giờ là của Thiên Thần Hộ Mệnh,
   * lại còn gỡ mà không cần biết người được che có nằm trong tầm cắn không:
   * Bảo Vệ che A, Sói cắn B thì cú xuyên tiêu vào hư không.
   *
   * Cú tung xúc xắc vẫn nằm sau `guardedIds.size > 0` như cũ - đêm không có
   * khiên nào thì không rút số, để dòng RNG của một ván không đổi.
   */
  let bloodMoonPierce = false;
  if (st.bloodMoonArmed) {
    st.bloodMoonArmed = false;
    st.bloodMoonUsed = true;
    bloodMoonPierce = guardedIds.size > 0 && rng() < 0.2;
  }

  // 2. Information results are already recorded during submitNightAction

  // 3 & 5. Xác định nạn nhân bị cắn bởi Sói (Primary & Secondary target)
  let healApplied = false;
  let cursedBitten: EnginePlayer | null = null;

  const isPeacefulNight = st.activeEvent?.id === "PEACEFUL_NIGHT";
  const primaryWolfTarget = isPeacefulNight ? null : st.night.killTarget;

  // Đêm Bình Yên tước CẢ lượt phụ: đêm Sói Con nổi giận là đêm duy nhất lượt
  // phụ tồn tại mà không cần sự kiện, và đó đúng là đêm làng cần được cứu.
  let secondaryTargetToProcess = isPeacefulNight ? null : st.night.wolfSecondaryTarget;
  if (st.activeEvent?.id === "BLOODY_HUNT" && secondaryTargetToProcess) {
    const success = rng() < 0.5;
    if (!success) {
      secondaryTargetToProcess = null;
    }
  }

  const wolfTargets = [primaryWolfTarget, secondaryTargetToProcess].filter(
    (t): t is string => t !== null && t !== undefined,
  );

  // Giờ mới biết Sói cắn ai: xuyên đúng khiên đang chắn một mục tiêu của Sói.
  // Sói cắn hai người mà cả hai đều có khiên thì mục tiêu chính mất khiên
  // trước - `wolfTargets` xếp chính trước phụ.
  if (bloodMoonPierce) {
    const pierced = wolfTargets.find((targetId) => guardedIds.has(targetId));
    if (pierced) {
      guardedIds.delete(pierced);
      st.log.push(`Trăng Máu xuyên thủng khiên bảo vệ ${engine.player(pierced)?.name ?? "?"}!`);
    }
  }

  for (const targetId of wolfTargets) {
    const victim = engine.player(targetId);
    if (victim && victim.alive) {
      const isGuarded = guardedIds.has(victim.id);
      const isHealed = targetId === st.night.killTarget && st.night.healTonight && !st.healUsed;
      if (isHealed) healApplied = true;

      if (!isGuarded && !isHealed) {
        if (victim.role === "CURSED") {
          cursedBitten = victim;
        } else if (victim.role === "ELDER" && !st.elderBiteSurvived) {
          /*
           * Tấm đệm của Trưởng Lão, dùng đúng MỘT lần cả ván.
           *
           * Đứng cùng chỗ với Kẻ Nguyền Rủa vì cùng một loại luật: nhát cắn
           * trúng đích nhưng KHÔNG thành một cái chết. Khác ở chỗ Nguyền Rủa
           * đổi phe còn lá này chỉ đơn giản là còn sống.
           *
           * Cờ bật ngay tại đây chứ không đợi khép đêm: bầy Sói cắn hai người
           * trong cùng một đêm (Sói Con nổi giận, Cuộc Săn Đẫm Máu) thì tấm
           * đệm chỉ được chắn cho nhát ĐẦU - vòng lặp này chạy qua cả hai
           * mục tiêu, và một tấm đệm chắn được cả hai là hai lần dùng.
           */
          st.elderBiteSurvived = true;
          st.log.push(`${victim.name} sống sót một cách khó hiểu qua đêm nay.`);
        } else {
          // LAST_STAND: delay death until end of next day, but not when cub rage double-kill is active
          if (st.activeEvent?.id === "LAST_STAND" && !st.pendingLastStandVictim && !st.night.wolfCubRageTonight) {
            st.pendingLastStandVictim = { playerId: victim.id, dieRound: st.round + 1 };
            st.log.push(`Tử Thủ: ${victim.name} được kéo dài sự sống tới hết ngày mai!`);
          } else {
            addDeath({ playerId: victim.id, name: victim.name, cause: "wolf" });
          }
        }
      }
    }
  }

  /*
   * Nhát dao của Sát Nhân.
   *
   * Đứng SAU vòng cắn của bầy Sói và TRƯỚC `st.healUsed = true` - vị trí là
   * một phần của luật, không phải một chi tiết sắp xếp:
   *
   *  - Sau vòng cắn, để `healApplied` đã biết bình cứu có đổ vào nạn nhân đêm
   *    nay hay không. Cứu thành công một người thì đêm đó người đó miễn CẢ
   *    hai đòn, đúng như đã chốt.
   *  - Trước `if (healApplied) st.healUsed = true;` ở dưới, vì `st.healUsed`
   *    chưa được đặt nên biểu thức kiểm tra ở đây đọc ra cùng một câu trả lời
   *    với vòng cắn, và khối này còn KỊP ghi vào `healApplied`. Đảo hai khối
   *    là bình cứu lặng lẽ mất tác dụng với riêng nhát dao.
   *
   * KHÔNG tra xem Sát Nhân còn sống hay không. `submitNightAction` đã đòi nó
   * còn sống lúc bấm, và `emptyNight` xoá ô này mỗi đêm - nên một mục tiêu
   * nằm đây luôn là đòn của một người còn sống lúc đêm bắt đầu được xử. Đó
   * chính là điều phải giữ: kẻ đâm có ngã xuống trong cùng đêm (một nhát cắn,
   * một bình độc, hay Tử Thủ đến hạn ở ngay đầu hàm này)
   * thì nhát dao vẫn tới nơi.
   *
   * Tử Thủ KHÔNG hoãn nhát dao: sự kiện đó viết cho nạn nhân của bầy Sói và
   * chỉ giữ được một người mỗi lần, nên nới nó ra cho cả nguồn thứ hai là đổi
   * luật của một sự kiện đang chạy.
   */
  if (st.night.serialKillerTarget) {
    const victim = engine.player(st.night.serialKillerTarget);
    if (victim && victim.alive) {
      const isGuarded = guardedIds.has(victim.id);
      const isHealed =
        victim.id === st.night.killTarget && st.night.healTonight && !st.healUsed;
      /*
       * Bình cứu chặn được nhát dao thì bình cứu ĐÃ DÙNG, y như khi nó chặn
       * một cú cắn. Không thể để dòng này cho riêng vòng cắn lo: trong một
       * Đêm Bình Yên vòng cắn không chạy một lần nào, nên mục tiêu chính của
       * bầy Sói còn sống nhờ đúng bình cứu ấy mà `healApplied` vẫn là `false`
       * - Phù Thuỷ được cứu MIỄN PHÍ một mạng và recap báo là chưa dùng bình.
       *
       * Đặt TRƯỚC `isGuarded`, cùng thứ tự với vòng cắn: bình đã đổ vào một
       * người thật sự bị nhắm thì nó mất, kể cả khi một tấm khiên cũng đang
       * đỡ đúng người đó. Hai nguồn đòn phải trả lời câu này giống hệt nhau.
       */
      if (isHealed) healApplied = true;
      if (!isGuarded && !isHealed) {
        /*
         * Kẻ Nguyền Rủa chết THẬT ở đây, không hoá Sói.
         *
         * Không cần một nhánh riêng để chặn: cơ chế hoá Sói đọc `cursedBitten`
         * (chỉ do vòng cắn đặt) và chỉ chạy khi người đó CÒN SỐNG sau khi mọi
         * cái chết đã áp. Một nhát dao trúng đúng người vừa bị cắn vì thế tự
         * huỷ lần chuyển phe - đúng luật "chỉ đòn Sói hợp lệ mới hoá Sói".
         */
        addDeath({ playerId: victim.id, name: victim.name, cause: "serial_killer" });
      }
    }
  }

  // Bình cứu chỉ mất khi có nạn nhân thật để cứu
  if (healApplied) st.healUsed = true;

  // Bình độc: đâm xuyên mọi protection
  if (st.night.poisonTarget && !st.poisonUsed) {
    const victim = engine.player(st.night.poisonTarget);
    if (victim && victim.alive) {
      addDeath({ playerId: victim.id, name: victim.name, cause: "poison" });
      st.poisonUsed = true;
    }
  }

  /*
   * Tính NGAY TẠI ĐÂY: mọi hành động đêm đã để dấu trong `NightState` từ lúc
   * nộp (xem mục 2 ở trên), nên thời điểm tính không phụ thuộc gì thêm - chỉ
   * cần đứng TRƯỚC khi ai đó bị đánh dấu chết (`p.alive = false` ở dưới) và
   * TRƯỚC khi Kẻ Nguyền Rủa hoá Sói. Một con Sói bỏ phiếu cắn rồi trúng Bình
   * Độc, hay một mục tiêu chết ngay đêm đó, vẫn đọc ra ĐÃ ra tay - Kẻ Theo
   * Dõi canh người đó suốt đêm, không phải tới sáng mới xem còn sống hay
   * không. Và vai được tra đúng như lúc đêm diễn ra, trước khi Kẻ Nguyền Rủa
   * kịp đổi phe.
   */
  for (const [trackerId, targetId] of Object.entries(st.night.trackerTargets)) {
    st.night.trackerResults[trackerId] = { targetId, acted: didActTonight(st, targetId) };
  }

  // Cập nhật trạng thái
  st.guardPrevious = st.night.guardTarget;
  st.guardSecondPrevious = st.night.guardSecondTarget ?? null;
  // Bình Độc của Phù Thuỷ là nguồn chết ĐÊM duy nhất do chính phe làng gây ra,
  // nên nó là nguồn duy nhất ở đây kích được cái bẫy của Trưởng Lão. Nhát cắn
  // và nhát dao thì không: xem `elderKilledByVillage`.
  for (const death of deaths) {
    if (death.cause === "poison") engine.elderKilledByVillage(death.playerId);
  }
  st.lastNightDeaths = deaths.map((d) => ({ playerId: d.playerId, name: d.name }));
  engine.noteDeathOrder(deaths.map((d) => d.playerId));
  for (const d of deaths) {
    const p = engine.player(d.playerId);
    if (p) p.alive = false;
  }

  // 6. Post-night triggers
  // Cursed conversion
  const cursedTurned = cursedBitten !== null && cursedBitten.alive ? cursedBitten : null;
  if (cursedTurned) {
    cursedTurned.role = "WEREWOLF";
    cursedTurned.cursedTurned = true;
  }

  // Check if Seer died -> awaken apprentice seer
  const seerDied = deaths.some((d) => {
    const p = engine.player(d.playerId);
    return p?.role === "SEER";
  });
  if (seerDied) {
    st.apprenticeAwakened = true;
  }

  // Check if Wolf Cub died -> trigger wolf cub rage next night
  const wolfCubDied = deaths.some((d) => {
    const p = engine.player(d.playerId);
    return p?.role === "WOLF_CUB";
  });
  if (wolfCubDied) {
    st.wolfCubRageNextNight = true;
  }

  // BLOOD_MOON arm: if active and 0 wolf deaths this night, arm for next night
  const wolfDeaths = deaths.filter((d) => d.cause === "wolf").length;
  if (st.activeEvent?.id === "BLOOD_MOON" && wolfDeaths === 0 && !st.bloodMoonArmed && !st.bloodMoonUsed) {
    st.bloodMoonArmed = true;
    st.log.push(`Trăng Máu đã được kích hoạt: đêm sau có 20% xuyên khiên!`);
  } else if (st.activeEvent?.id === "BLOOD_MOON" && wolfDeaths > 0) {
    // if kill happened, still mark used (consumed)
    st.bloodMoonUsed = true;
  }

  engine.queueHunterReaction(deaths, "night");
  st.log.push(
    deaths.length === 0
      ? `Đêm ${st.round}: bình yên vô sự.`
      : `Đêm ${st.round}: ${deaths.length} người đã mất.`,
  );

  const wolfTarget = recapPlayer(st.night.killTarget ? engine.player(st.night.killTarget) : undefined);
  const usedHeal = healApplied;
  const recap: NightRecap = {
    round: st.round,
    wolfTarget,
    guardTarget: recapPlayer(st.night.guardTarget ? engine.player(st.night.guardTarget) : undefined),
    seerChecks: Object.entries(st.night.seerResults).flatMap(([seerId, result]) => {
      const seer = recapPlayer(engine.player(seerId));
      const target = recapPlayer(engine.player(result.targetId));
      if (!seer || !target) return [];
      const secondaryTarget = result.secondaryTargetId
        ? (recapPlayer(engine.player(result.secondaryTargetId)) ?? undefined)
        : undefined;
      return [{
        seer,
        target,
        isWolf: result.isWolf,
        team: result.team,
        secondaryTarget,
        secondaryIsWolf: secondaryTarget ? result.secondaryIsWolf : undefined,
      }];
    }),
    witch: {
      usedHeal,
      healedTarget: usedHeal ? wolfTarget : null,
      poisonTarget: recapPlayer(st.night.poisonTarget ? engine.player(st.night.poisonTarget) : undefined),
    },
    deaths: deaths.map((death) => ({
      player: { id: death.playerId, name: death.name },
      cause: death.cause,
    })),
    cursedTurned: recapPlayer(cursedTurned ?? undefined),
    detectiveChecks: Object.entries(st.night.detectiveResults).flatMap(([detectiveId, result]) => {
      const detective = recapPlayer(engine.player(detectiveId));
      const target1 = recapPlayer(engine.player(result.target1Id));
      const target2 = recapPlayer(engine.player(result.target2Id));
      return detective && target1 && target2
        ? [{ detective, target1, target2, sameTeam: result.sameTeam }]
        : [];
    }),
    sorcererChecks: Object.entries(st.night.sorcererResults).flatMap(([sorcererId, result]) => {
      const sorcerer = recapPlayer(engine.player(sorcererId));
      const target = recapPlayer(engine.player(result.targetId));
      return sorcerer && target
        ? [{ sorcerer, target, isSeerLine: result.isSeerLine }]
        : [];
    }),
    // `priest` vắng mặt ở đêm mới: Linh Mục đã bị xóa cứng nên không còn đêm
    // nào sinh ra mục này nữa. Đêm CŨ nạp lại vẫn giữ nguyên trường `priest`
    // của nó (dữ liệu nằm trong nightHistory), và các cái chết cũ với cause
    // "priest"/"priest_backfire" vẫn kể lại qua mảng `deaths` ở dưới.
    wolfSecondaryTarget: recapPlayer(
      secondaryTargetToProcess ? engine.player(secondaryTargetToProcess) : undefined,
    ),
    // Ô RIÊNG cạnh `wolfTarget`, không ghi đè nó: một đêm mà cả hai cùng ra
    // tay phải kể lại được thành hai đòn, kể cả khi chúng nhắm cùng một người.
    serialKillerTarget: recapPlayer(
      st.night.serialKillerTarget ? engine.player(st.night.serialKillerTarget) : undefined,
    ),
  };

  st.nightHistory.push(recap);

  st.phase = "NIGHT_RESULT";
  st.phaseEndsAt = now + RESULT_MS;
  return deaths;
}
