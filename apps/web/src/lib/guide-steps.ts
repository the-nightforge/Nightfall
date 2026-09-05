import { ROLE_META, roleTeam, type RoomSnapshot } from "@masoi/shared";
import { GUIDE_TABLE_SIZE, hasGuideDeck, type GuidePrepStage } from "./guide-prep";
import { roleGoal } from "./role-goal";

/**
 * Ván đầu có hướng dẫn - phần NỘI DUNG, tách khỏi React để test được.
 *
 * Mỗi pha một bước ngắn: đang ở đâu, việc cần làm ngay, và một điều người mới
 * hay hiểu sai ở đúng pha đó. Không phải một bài luật: luật đầy đủ đã có ở
 * "Luật và vai trò" trong phòng chờ và ở thẻ vai lúc chia bài. Đây là lời nhắc
 * đứng cạnh thao tác, dài không quá hai câu, để người chơi đọc xong trong lúc
 * đồng hồ đang chạy.
 *
 * Mục tiêu phe lấy từ `roleGoal` - cùng câu với thẻ vai - và tên vai từ
 * `ROLE_META`. Không viết lại luật thắng ở đây: hai bản của cùng một luật là
 * hai bản để trôi lệch.
 *
 * Hàm này chỉ ĐỌC snapshot đã lọc theo người xem, nên nó không thể nói ra điều
 * mà người đó không được biết.
 */
export interface GuideStep {
  /** Tiêu đề ngắn, nói tên bước. */
  title: string;
  /** Việc cần làm hoặc điều đang diễn ra. Tối đa hai câu. */
  body: string;
  /** Điều người mới hay nhầm ở pha này, nếu có. */
  tip?: string;
}

/** Khoá localStorage đánh dấu người này đã đi hết một ván hướng dẫn. */
export const GUIDE_COMPLETED_KEY = "masoi:guide:completed";
/** Tiền tố sessionStorage: trạng thái hướng dẫn của một phòng, theo mã phòng. */
export const GUIDE_ROOM_KEY_PREFIX = "masoi:guide:room:";
/** Tiền tố sessionStorage: bàn của ván hướng dẫn đã được server xác nhận. */
export const GUIDE_PREP_KEY_PREFIX = "masoi:guide:prep:";

/**
 * Những gì thẻ cần biết mà snapshot không nói: bước chuẩn bị bàn đang ở đâu.
 * `prep` là `null` khi người xem không phải người chuẩn bị (không phải host,
 * hoặc hướng dẫn không được xin cho phòng này).
 */
export interface GuideStepContext {
  prep: GuidePrepStage | null;
}

export function guideStepFor(
  snapshot: RoomSnapshot,
  context: GuideStepContext = { prep: null },
): GuideStep {
  const you = snapshot.you;
  const role = you?.role;
  const dead = you !== null && !you.alive;
  const roleName = role ? ROLE_META[role].name : null;

  // Hành động đặc biệt mà SERVER đã cho phép người này đi TRƯỚC mọi lời nhắc
  // chung - kể cả lời nhắc cho người chết. Thợ Săn ở pha bắn đã chết theo
  // định nghĩa, và một lời "bạn không còn hành động" ngay lúc server đang chờ
  // họ chọn mục tiêu là lời sai đúng vào 20 giây quan trọng nhất của vai đó.
  // Chỉ đọc cờ đã lọc (`canAct`, `resolved`), không suy từ vai: web không
  // biết và không cần biết vì sao server cho ai làm gì.
  const shot = snapshot.hunterShot;
  if (snapshot.phase === "HUNTER_SHOT" && shot?.canAct) {
    if (!shot.resolved) {
      return {
        title: "Thợ Săn: lượt bắn của bạn",
        body: "Bạn vừa chết, nhưng còn một phát đạn: chọn một người để bắn theo, hoặc bấm “Không bắn ai”.",
        tip: "Hết giờ mà chưa chọn thì tính là không bắn. Người bị bắn chết ngay, vai chỉ lộ khi ván kết thúc.",
      };
    }
    return {
      title: "Thợ Săn: đã ghi nhận",
      body: shot.target
        ? `Bạn đã bắn ${shot.target.name}. Chờ máy chủ chuyển pha.`
        : "Bạn đã chọn không bắn ai. Chờ máy chủ chuyển pha.",
    };
  }

  // Tiếng Vọng Người Chết: linh hồn ĐƯỢC CHỌN có một lượt gửi lời nhắn ẩn
  // danh. Cờ này chỉ đúng với người nhận snapshot; không nói ra ai được chọn.
  if (dead && snapshot.deadCanSpeak?.canAct) {
    return {
      title: "Tiếng Vọng Người Chết",
      body: "Bạn được gửi đúng một lời nhắn ẩn danh tới cả làng. Gõ vào ô “Tiếng Vọng Người Chết” rồi bấm Gửi.",
      tip: "Không ai biết lời nhắn là của bạn - kể cả sau khi ván kết thúc.",
    };
  }

  // Người chết vẫn có việc: theo dõi và đọc chat. Nói rõ trước khi họ đi tìm
  // nút bỏ phiếu không còn nữa. Trừ lúc chia vai và kết thúc, ở đó bước theo
  // pha nói đúng hơn.
  if (dead && snapshot.phase !== "GAME_OVER" && snapshot.phase !== "ROLE_REVEAL") {
    return {
      title: "Bạn đã chết",
      body:
        snapshot.phase === "HUNTER_SHOT" && shot
          ? `Thợ Săn ${shot.hunterName} vừa chết đang chọn người để bắn theo. Bạn xem được diễn biến và chat của người chết, nhưng không còn bỏ phiếu hay hành động.`
          : "Bạn vẫn xem được toàn bộ diễn biến và chat của người chết, nhưng không còn bỏ phiếu hay hành động đêm.",
      tip: "Vai của bạn chưa lộ với ai - làng chỉ biết khi ván kết thúc.",
    };
  }

  switch (snapshot.phase) {
    case "LOBBY":
      return lobbyStep(snapshot, context);
    case "ROLE_REVEAL":
      return role
        ? {
            title: `Bạn là ${roleName}`,
            body: roleGoal(role),
            tip:
              roleTeam(role) === "wolves"
                ? "Đừng để lộ mình là Sói trong chat - cả làng đang đọc."
                : "Kỹ năng của vai nằm ngay trên thẻ; hãy đọc trước khi trời tối.",
          }
        : { title: "Đang chia vai", body: "Chờ máy chủ phát bài. Vai của bạn sẽ hiện ngay tại đây." };
    case "NIGHT":
      if (snapshot.night?.canAct && !snapshot.night.acted) {
        return {
          title: "Đêm: lượt của bạn",
          body:
            roleTeam(role ?? "VILLAGER") === "wolves"
              ? "Chọn nạn nhân cùng đồng bọn rồi bấm xác nhận. Kênh Sói bên chat chỉ bầy Sói đọc được."
              : "Chọn mục tiêu cho kỹ năng của bạn rồi bấm xác nhận trước khi hết giờ.",
        };
      }
      return {
        title: "Đêm",
        body: snapshot.night?.acted
          ? "Đã ghi nhận hành động của bạn. Chờ trời sáng."
          : "Vai của bạn không có việc ban đêm. Chờ trời sáng để xem chuyện gì đã xảy ra.",
      };
    case "NIGHT_RESULT":
      return {
        title: "Trời sáng",
        body: "Xem ai không qua khỏi đêm qua. Đây là dữ kiện đầu tiên để cả làng bàn luận.",
      };
    case "DAY_DISCUSSION":
      return {
        title: "Thảo luận",
        body: "Đọc chat, hỏi và buộc tội. Gọi thẳng tên một bot (“An nghĩ sao?”) thì bot thường sẽ đáp.",
        tip: "Chưa ai bị treo ở bước này - đây là lúc gom nghi ngờ.",
      };
    case "VOTING":
      return {
        title: "Bỏ phiếu sơ bộ = đề cử",
        body: "Chọn một người rồi bấm “Bỏ phiếu”. Vòng này chỉ chọn ra BỊ CÁO, chưa ai bị treo.",
        tip: "Được đổi phiếu tới khi hết giờ. Chọn “Không treo ai” cũng là một lá phiếu.",
      };
    case "DEFENSE":
      return {
        title: "Biện hộ",
        body: `${snapshot.trial?.accusedName ?? "Bị cáo"} đang biện hộ. Nghe và chuẩn bị quyết định Treo hay Tha ở bước tiếp theo.`,
      };
    case "FINAL_VOTE":
      return {
        title: "Phán quyết: Treo hay Tha",
        body: `Khác vòng đề cử: lần này ${snapshot.trial?.accusedName ?? "bị cáo"} có thể chết thật. Bấm “Treo cổ” hoặc “Tha”.`,
        tip: "Không bỏ phiếu được tính là Tha.",
      };
    case "ELIMINATION":
    case "CHECK_WIN":
      return {
        title: "Kết quả phiên toà",
        body: "Làng đã phán quyết. Vai của người bị treo chỉ lộ khi ván kết thúc, nên hãy nhớ lấy để đối chiếu sau.",
      };
    case "HUNTER_SHOT":
      // Nhánh `canAct` đã được xử lý ở đầu hàm; tới đây là người đứng xem.
      return {
        title: "Thợ Săn phản kích",
        body: `Thợ Săn ${shot?.hunterName ?? "vừa chết"} đang chọn người để bắn theo. Người bị bắn chết ngay, không qua phiên toà.`,
      };
    case "GAME_OVER":
      return {
        title: "Hết ván",
        body: "Mọi vai đã lật. Cuộn xuống xem lại từng đêm và vì sao ván đấu rẽ như vậy.",
        tip: "Hết hướng dẫn từ đây: “Về phòng chờ” để chơi tiếp ván nữa với bàn này, hoặc “Tạo phòng mới” ở trang chủ - cả hai đều không còn thẻ này.",
      };
    default:
      return { title: "Đang diễn ra", body: "Theo dõi thanh pha ở trên để biết còn bao lâu." };
  }
}

/**
 * Phòng chờ nói đúng chuyện đang xảy ra, không nói chuyện đáng lẽ phải xảy ra.
 *
 * "Sẵn sàng" chỉ được nói khi bàn ĐÃ đủ người theo snapshot và bước chuẩn bị
 * đã xong (hoặc không có bước nào - người xem không phải host). Còn đang xin
 * bộ bài hay đang gọi bot thì nói đúng như thế, kèm số đếm từ snapshot chứ
 * không từ số lần đã gửi. Bộ bài chỉ được gọi là "chuẩn của bàn 8" khi cấu
 * hình hiện tại đúng là như vậy - host đã chỉnh thì nói là đã chỉnh.
 */
function lobbyStep(snapshot: RoomSnapshot, context: GuideStepContext): GuideStep {
  const count = snapshot.players.length;
  const isHost = snapshot.you !== null && snapshot.you.id === snapshot.hostId;
  const deckReady = hasGuideDeck(snapshot.config);
  const full = count >= GUIDE_TABLE_SIZE;
  const progress = `${count}/${GUIDE_TABLE_SIZE}`;

  if (context.prep === "failed") {
    return {
      title: "Cần bạn thiết lập tay",
      body: `Máy chủ chưa xác nhận được thiết lập tự động. Mở “Thiết lập ván”, bấm “Áp dụng đội hình chuẩn”, rồi “+ Thêm bot” cho đủ ${GUIDE_TABLE_SIZE} người (${progress}).`,
      tip: "Tải lại trang cũng sẽ thử thiết lập lại từ đầu.",
    };
  }

  if (!isHost) {
    return {
      title: "Chờ chủ phòng",
      body: full
        ? "Bàn đã đủ người. Chủ phòng sẽ bấm Bắt đầu; bạn chỉ cần bấm Sẵn sàng."
        : `Chủ phòng đang gọi bot cho đủ ${GUIDE_TABLE_SIZE} người (${progress}). Bạn chỉ cần bấm Sẵn sàng.`,
    };
  }

  if (context.prep === "config" || (context.prep !== "done" && !deckReady && !full)) {
    return {
      title: "Đang thiết lập bộ bài",
      body: `Đang xin máy chủ dùng bộ bài chuẩn của bàn ${GUIDE_TABLE_SIZE} người (có Thợ Săn và Thám Tử), rồi mới gọi bot.`,
    };
  }

  if (!full) {
    return {
      title: "Đang gọi bot vào làng",
      body: `Ván hướng dẫn cần ${GUIDE_TABLE_SIZE} người; đang thêm bot cho đủ (${progress}).`,
    };
  }

  return {
    title: "Sẵn sàng bắt đầu",
    body: "Bàn đã đủ người: bạn và các bot. Bấm “Bắt đầu trò chơi” để chia vai.",
    tip: deckReady
      ? `Bộ bài là đội hình chuẩn của bàn ${GUIDE_TABLE_SIZE} người - cùng luật với ván xếp hạng thật.`
      : "Bộ bài đang là do bạn tự chỉnh, không phải đội hình chuẩn - vẫn chơi được nếu máy chủ không báo mất cân bằng.",
  };
}
