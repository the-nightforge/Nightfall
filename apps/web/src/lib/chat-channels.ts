import { ROLE_META, type ChatChannel, type RoomSnapshot } from "@masoi/shared";

/**
 * Bốn kênh chat của cả ván.
 *
 * Lấy thẳng `ChatChannel` của @masoi/shared chứ không khai lại một union giống
 * hệt: server gắn đúng những chuỗi đó vào `ChatMessage.channel`, và hai bản
 * khai báo song song là hai thứ trôi lệch nhau được.
 */
export type ChatChannelId = ChatChannel;

export interface ChatChannelMeta {
  /** Nhãn đứng một mình được, dùng cho tab và cho nhãn trên từng tin nhắn. */
  label: string;
  /** Câu đầy đủ cho tiêu đề khung và cho aria-label. */
  longLabel: string;
  icon: string;
}

/**
 * MỘT bảng tra cho cả trang.
 *
 * Trước đây `ChatBox` giữ hai bảng riêng (nhãn + icon) còn trang phòng giữ một
 * bảng nhãn thứ ba của riêng nó, và ba bảng đó đã lệch nhau: trang phòng gọi là
 * "Kênh người chết" trong khi bong bóng tin nhắn gọi là "Người chết". Kênh là
 * thông tin an toàn quan trọng nhất trong khung chat, nên nó không được phép có
 * hai tên tuỳ chỗ nhìn.
 */
export const CHAT_CHANNEL_META: Record<ChatChannelId, ChatChannelMeta> = {
  lobby: { label: "Phòng", longLabel: "Kênh phòng chờ", icon: "🏠" },
  day: { label: "Làng", longLabel: "Kênh làng", icon: "☀️" },
  wolves: { label: "Sói", longLabel: "Kênh phe Sói", icon: "🐺" },
  dead: { label: "Người chết", longLabel: "Kênh người chết", icon: "💀" },
};

export function channelMeta(channel: string): ChatChannelMeta {
  return CHAT_CHANNEL_META[channel as ChatChannelId] ?? { label: channel, longLabel: channel, icon: "💬" };
}

/** Thứ tự cố định cho tab lọc, để tab không nhảy chỗ giữa hai lần render. */
const CHANNEL_ORDER: ChatChannelId[] = ["lobby", "day", "wolves", "dead"];

/**
 * Những kênh mà người xem ĐANG ĐỌC.
 *
 * Đây là nửa từng bị thiếu và là nguyên nhân của lỗi "header ghi Kênh người
 * chết nhưng bên dưới toàn tên người còn sống": trang phòng chỉ tính được kênh
 * mà người xem GỬI VÀO rồi in nó lên đầu danh sách ĐỌC. Với người chơi còn sống
 * hai thứ đó trùng nhau nên không ai thấy gì sai; với người đã chết thì họ gửi
 * vào `dead` nhưng đọc được cả `day`, `wolves` và `dead` - server cố ý cho khán
 * giả theo dõi trọn ván (visibleChatLog trong apps/server/src/rooms/snapshot.ts).
 *
 * Danh sách dưới đây phải khớp với `visibleChatLog`. Nó KHÔNG phải một tầng bảo
 * vệ: những gì server không gửi thì không có trong `snapshot.chatLog`, còn hàm
 * này chỉ quyết định cách gọi tên và cách xếp phần đã nhận được.
 */
export function readableChannels(snapshot: RoomSnapshot | null): ChatChannelId[] {
  if (!snapshot) return [];
  const phase = snapshot.phase;
  if (phase === "LOBBY") return ["lobby"];
  if (phase === "GAME_OVER") return ["lobby", "day", "wolves", "dead"];
  // Không phải thành viên phòng thì server không gửi dòng nào; đừng mở tab cho
  // một danh sách chắc chắn rỗng.
  if (!snapshot.you) return [];
  if (!snapshot.you.alive) return ["day", "wolves", "dead"];
  if (phase === "NIGHT") {
    return isWolfViewer(snapshot) && !isSilentNight(snapshot) ? ["wolves"] : [];
  }
  return ["day"];
}

/**
 * Kênh có mặt THẬT trong danh sách đang hiển thị, theo thứ tự cố định.
 *
 * Lấy giao của quyền đọc với dữ liệu thực tế: mở tab "Hang Sói" cho một khán
 * giả trong ván chưa có đêm nào là mở một tab rỗng.
 */
export function presentChannels(
  snapshot: RoomSnapshot | null,
  messages: Array<{ channel: string }>,
): ChatChannelId[] {
  const allowed = new Set(readableChannels(snapshot));
  const seen = new Set(messages.map((message) => message.channel));
  return CHANNEL_ORDER.filter((channel) => allowed.has(channel) && seen.has(channel));
}

/** Tiêu đề + dòng phụ của khung chat, nói đúng thứ đang HIỂN THỊ bên dưới. */
export interface ChatHeading {
  title: string;
  subtitle: string;
}

export function chatHeading(snapshot: RoomSnapshot | null): ChatHeading {
  const channels = readableChannels(snapshot);
  if (!snapshot || channels.length === 0) {
    return { title: "Trò chuyện", subtitle: "Chưa có kênh nào mở" };
  }
  if (channels.length === 1) {
    const meta = CHAT_CHANNEL_META[channels[0]];
    return { title: meta.longLabel, subtitle: `Chỉ hiển thị ${meta.label.toLowerCase()}` };
  }
  /*
   * Nhiều kênh thì tiêu đề KHÔNG được mang tên một kênh nào.
   *
   * "Kênh người chết" đứng trên một danh sách trộn cả kênh làng là đúng câu nói
   * dối mà cả màn hình này phải sửa. "Toàn cảnh" nói thật về thứ bên dưới, còn
   * chuyện gõ vào đâu thì thanh soạn ở đáy khung tự nói lấy.
   */
  return {
    // "Toàn cảnh" chứ không phải "Toàn cảnh khán giả": cột chat hẹp 17.5rem ở
    // nấc lg, và cái tên dài hơn gãy làm hai dòng ngay trên đầu khung. Danh
    // sách kênh nằm ở dòng phụ, và hàng tab ngay bên dưới lặp lại nó ở dạng
    // bấm được.
    title: "Toàn cảnh",
    subtitle: channels.map((id) => CHAT_CHANNEL_META[id].label).join(" · "),
  };
}

/** Quyền GỬI của người xem ở pha hiện tại. */
export interface ChatComposerState {
  canSend: boolean;
  /** Kênh mà một tin nhắn gửi bây giờ sẽ rơi vào; null khi không gửi được. */
  channel: ChatChannelId | null;
  /** Gợi ý trong ô nhập. Ngắn để không bị cắt ở cột chat 368px. */
  placeholder: string;
  /** Vì sao đang khoá; chuỗi rỗng khi gửi được. */
  reason: string;
}

const LOCKED: Omit<ChatComposerState, "placeholder" | "reason"> = { canSend: false, channel: null };

function isWolfViewer(snapshot: RoomSnapshot): boolean {
  const role = snapshot.you?.role;
  return !!role && ROLE_META[role].team === "wolves";
}

function isSilentNight(snapshot: RoomSnapshot): boolean {
  return snapshot.activeEvent?.id === "SILENT_NIGHT";
}

/**
 * Bản sao CLIENT của `resolveChat` trên server.
 *
 * Bản sao, không phải nguồn sự thật: server vẫn tự quyết mọi thứ và từ chối mọi
 * tin nhắn sai quyền kể cả khi bundle này bị sửa (apps/server/src/rooms/service.ts
 * gọi `resolveChat` trước khi phát đi bất kỳ dòng nào). Cái nó mua về là hai
 * thứ mà server không làm hộ được: ô nhập bị TẮT trước khi người chơi gõ xong
 * một câu rồi mới nhận về một dòng chữ đỏ, và người chơi đọc được VÌ SAO.
 *
 * Mọi nhánh dưới đây phải giữ đúng thứ tự của bản server - đặc biệt là nhánh
 * người chết đứng TRƯỚC cổng biện hộ, nếu không người chết sẽ bị khoá oan trong
 * lúc biện hộ dù luật cho họ nói tiếp trong kênh của mình.
 */
export function chatComposerState(snapshot: RoomSnapshot | null): ChatComposerState {
  if (!snapshot) {
    return { ...LOCKED, placeholder: "Đang kết nối...", reason: "Chưa vào được phòng" };
  }

  const phase = snapshot.phase;
  if (phase === "LOBBY" || phase === "GAME_OVER") {
    return { canSend: true, channel: "lobby", placeholder: "Chat phòng...", reason: "" };
  }

  const you = snapshot.you;
  // Không có khối `you` nghĩa là người xem không phải thành viên phòng - cùng
  // nhánh từ chối đầu tiên của `resolveChat` trên server.
  if (!you) {
    return { ...LOCKED, placeholder: "Bạn không ở trong phòng này", reason: "Bạn không ở trong phòng này." };
  }

  if (!you.alive) {
    /*
     * Thợ Săn vừa ngã xuống nhưng chưa bắn thì CHƯA phải khán giả: server giữ
     * họ ngoài kênh người chết để phát súng còn là một cú bắn mù. Client chỉ
     * nhìn thấy được cửa sổ này ở pha HUNTER_SHOT - xem chú thích cuối hàm.
     */
    if (phase === "HUNTER_SHOT" && snapshot.hunterShot?.hunterId === you.id) {
      return {
        ...LOCKED,
        placeholder: "Bạn còn một phát súng...",
        reason: "Bắn xong bạn mới vào được kênh người chết.",
      };
    }
    return {
      canSend: true,
      channel: "dead",
      placeholder: "Nhắn kênh người chết...",
      reason: "",
    };
  }

  if (phase === "NIGHT") {
    if (!isWolfViewer(snapshot)) {
      return {
        ...LOCKED,
        placeholder: "Ban đêm bạn không thể nói",
        reason: "Ban đêm cả làng ngủ, chỉ phe Sói bàn nhau.",
      };
    }
    if (isSilentNight(snapshot)) {
      return {
        ...LOCKED,
        placeholder: "Bạn không thể nói lúc này",
        reason: "Đêm Tĩnh Lặng: kênh phe Sói bị vô hiệu hoá.",
      };
    }
    return { canSend: true, channel: "wolves", placeholder: "Chat phe Sói...", reason: "" };
  }

  if (phase === "DEFENSE") {
    const accusedId = snapshot.trial?.accusedId;
    if (accusedId && you.id === accusedId) {
      return { canSend: true, channel: "day", placeholder: "Nhập lời biện hộ...", reason: "" };
    }
    const accusedName = snapshot.trial?.accusedName;
    return {
      ...LOCKED,
      // Tên người biện hộ nằm trong placeholder chứ không chỉ ở dòng lý do:
      // trên điện thoại tấm trượt chat che gần hết màn, và ô nhập là thứ duy
      // nhất người chơi còn nhìn thấy lúc định gõ.
      placeholder: accusedName ? `Đang lắng nghe ${accusedName}...` : "Đang lắng nghe lời biện hộ...",
      reason: accusedName
        ? `Chỉ ${accusedName} được nói trong lúc biện hộ.`
        : "Chỉ người đang biện hộ được nói.",
    };
  }

  if (
    phase === "ROLE_REVEAL" ||
    phase === "NIGHT_RESULT" ||
    phase === "DAY_DISCUSSION" ||
    phase === "VOTING" ||
    phase === "FINAL_VOTE" ||
    phase === "ELIMINATION"
  ) {
    return { canSend: true, channel: "day", placeholder: "Chat làng...", reason: "" };
  }

  /*
   * HUNTER_SHOT và CHECK_WIN rơi xuống đây, đúng như nhánh cuối của server.
   *
   * Bản cũ của trang phòng trả về "day" cho mọi pha ban ngày không kể tên, nên
   * ở hai pha này ô nhập vẫn mời "Chat làng..." rồi mọi câu gõ vào đều dội về
   * một dòng lỗi đỏ.
   */
  return {
    ...LOCKED,
    placeholder: "Bạn không thể nói lúc này",
    reason: "Pha này không mở kênh chat nào.",
  };
}

/**
 * Câu gợi ý khi khung chat còn rỗng. Ba giai đoạn, ba câu.
 */
export function chatEmptyHint(snapshot: RoomSnapshot | null): string {
  if (!snapshot || snapshot.phase === "LOBBY") {
    return "Chào cả phòng một câu trong lúc chờ đủ người.";
  }
  if (snapshot.phase === "GAME_OVER") return "Chưa có tin nhắn nào sau trận.";
  return "Chưa có tin nhắn trong kênh này.";
}
