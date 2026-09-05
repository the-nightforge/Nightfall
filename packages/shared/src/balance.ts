import { roleTeam } from "./roles";
import type { Role } from "./roles";
import type { RoomConfig } from "./phases";
import type { BalanceWarningView } from "./snapshot";

/**
 * Sức nặng của mỗi vai, tính bằng "hơn một lá Dân Làng bao nhiêu".
 *
 * Bảng này KHÔNG còn là số đoán tay: nó hiệu chỉnh từ
 * `apps/server/scripts/role-power.ts`, chạy self-play so cặp trên đúng bộ seed -
 * mỗi preset chạy hai lần, một lần nguyên vẹn và một lần gỡ đúng một vai ra (ghế
 * trống thành Dân Làng), rồi lấy chênh lệch tỉ lệ thắng. Đó đúng bằng đại lượng
 * `calculateBalanceScore` cần, vì nó chỉ dùng bảng này để đo ĐỘ LỆCH của một bộ
 * bài so với preset chứ không chấm bộ bài một cách tuyệt đối.
 *
 * Hiệu chỉnh lại 2026-09-04, SAU khi bảng preset đổi - bảng cũ đo trên bộ preset
 * cũ nên mọi con số trong đó đã hết hiệu lực. Chạy hai lượt để tách tín hiệu
 * khỏi nhiễu (neo SEER = 5, cột "đo" là giá trị script gợi ý):
 *
 *   vai              đo@300  đo@600  cũ -> mới   mẫu
 *   WOLF_CUB            6.4     9.2    6 -> 7      2
 *   SEER                5.0     5.0    5 -> 5      8   (neo)
 *   WITCH               3.0     3.0    3 -> 3      8
 *   GUARD               2.7     2.5    3 -> 2.5    8
 *   APPRENTICE_SEER     2.9     1.9  1.5 -> 2      2
 *   PRIEST              1.1     1.9    2 -> 1.5    2
 *   HUNTER              1.4     1.2    3 -> 2      8
 *   GUARDIAN_ANGEL      1.0     1.0    2 -> 1.5    3
 *   DETECTIVE           1.0     1.0    3 -> 2      7
 *   MAYOR               0.8     0.7  2.5 -> 1.5    5
 *   CURSED             -3.7    -4.6   -2 -> -3     2
 *
 * Bảng KHÔNG chép thẳng số đo, và có hai lý do - cùng hai lý do như lần trước:
 *
 * 1. Đây là BOT đánh BOT. Con số nói "lõi bot khai thác được bao nhiêu từ vai
 *    này", không phải "người chơi khai thác được bao nhiêu". Vai sống bằng đọc
 *    vị và phối hợp bị đo thấp nhất: Thị Trưởng đo ra 0.7 (lá phiếu x2 gần như
 *    vô dụng với bot vì chúng không hùa theo ai), Thợ Săn 1.2 (bot bắn kém),
 *    Thám Tử 1.0 (bot không nối được chuỗi suy luận từ kết quả "khác phe").
 *    Ba dòng đó vì thế bị hãm lại quanh 1.5-2 thay vì thả về đúng số đo.
 * 2. Bốn dòng có ĐÚNG 2 mẫu - Sói Con, Tiên Tri Tập Sự, Linh Mục, Kẻ Nguyền Rủa
 *    - cũng đúng là bốn dòng lệch nhiều nhất giữa hai lượt (Sói Con lệch 2.8
 *    điểm). Gấp đôi số ván KHÔNG làm chúng ổn định, vì bất ổn đến từ chỗ chỉ có
 *    2 preset chứa vai đó chứ không phải từ số ván. Chúng chỉ được dịch một nấc
 *    theo hướng số đo.
 *
 * Cảnh báo cho lần hiệu chỉnh sau: Sói Con tụt từ 7 mẫu xuống 2 vì bảng preset
 * mới chỉ còn để nó ở preset 9 và 10, và xuống ĐÚNG MỘT khi preset 9 đổi sang
 * hai Sói thường. Lá mạnh nhất bộ bài giờ là lá được đo thưa nhất. Muốn đo nó
 * cho ra hồn thì phải cho script chạy cả những bộ bài KHÔNG phải preset, chứ
 * không phải chạy thêm ván - đó đúng là cách con số 6 hiện tại được đo, xem chú
 * thích ngay dưới.
 *
 * Thứ số đo nói chắc chắn:
 * - Tiên Tri đứng RIÊNG một bậc trên đầu vế làng; Phù Thuỷ là bậc thứ hai; phần
 *   còn lại của vế làng dồn thành một bậc phẳng quanh 1.5-2.5.
 * - Sói Con là lá mạnh nhất cả bộ bài, hơn hẳn một con Sói thường.
 * - Kẻ Nguyền Rủa là lá có HẠI cho phe làng, và hại nặng hơn bảng cũ nghĩ.
 * - Thám Tử và Tiên Tri Tập Sự đáng giá GẦN BẰNG NHAU. Bảng cũ xếp chúng cách
 *   nhau gấp đôi (3 với 1.5), và chính vì thế `infoPower` từng chặn "gỡ Thám Tử"
 *   mà cho qua "gỡ Tiên Tri Tập Sự". Với bảng này thì cả hai đều lệch 2.0 điểm,
 *   tức đều DƯỚI ngưỡng 3 và đều cho qua. Đó là hệ quả có ý thức: ngưỡng giữ
 *   nguyên để bảng nói đúng số đo, thay vì vặn số cho vừa một ngưỡng cũ.
 */
export const ROLE_POWER: Record<Role, number> = {
  WEREWOLF: 5,
  /**
   * 6, hạ từ 7. Đo trên CẢ BỘ BÀI chứ không chỉ preset - xem cảnh báo ngay dưới
   * bảng này, lá mạnh nhất bộ bài từng là lá được đo thưa nhất (đúng 2 mẫu).
   *
   * Phép đo đúng cho con số này KHÔNG phải "thêm Sói Con vào", mà là "ĐỔI một
   * Sói thường thành Sói Con, giữ nguyên tổng số Sói" - vì 7-so-với-5 khẳng
   * định đúng chênh lệch đó. Bộ bài sinh ra tại chỗ với ba mức vai làng
   * (mỏng/vừa/đầy), seed ghép cặp, speech bật, 300 ván mỗi ô:
   *
   *   kit   |  n | thường | có SC |     Δ
   *   mỏng  |  9 |  33.3  | 22.7  | -10.7
   *   mỏng  | 13 |  64.3  | 49.0  | -15.3
   *   mỏng  | 18 |  75.3  | 79.7  |  +4.3
   *   vừa   | 13 |  59.3  | 50.7  |  -8.7
   *   vừa   | 18 |  78.0  | 78.7  |  +0.7
   *   đầy   | 13 |  59.0  | 52.7  |  -6.3
   *   đầy   | 18 |  77.0  | 81.0  |  +4.0
   *                              Δ TB = -4.57
   *
   * Quy đổi bằng cùng cái neo mà `TRAITOR` dùng: một con Sói thay một ghế Dân
   * Làng đáng -27 điểm cho 4.5 đơn vị, tức ~6 điểm mỗi đơn vị. -4.57 điểm vì
   * thế là ~0.76 đơn vị, cho 5.76 - làm tròn lên 6. Con số 7 cũ khẳng định
   * chênh lệch 2 đơn vị, tức đáng lẽ phải đo ra khoảng -12 điểm; nó đo ra một
   * phần ba chỗ đó.
   *
   * DẤU ĐỔI CHIỀU THEO CỠ PHÒNG, và đó là điều đáng chú ý nhất: Sói Con hơn hẳn
   * một con Sói thường ở bàn 9-13 người (-6 tới -15) nhưng KÉM hơn ở bàn 18
   * (+0.7 tới +4.3, cả ba kit đều dương). Cơn phẫn nộ cho bầy cắn hai người
   * trong MỘT đêm, mà giá trị của việc dồn hai cái chết vào một đêm giảm dần
   * khi bàn còn nhiều người và ván còn nhiều đêm. Bảng này chỉ có một con số
   * mỗi vai nên nó không diễn tả được điều đó - cùng giới hạn đã ghi ở `TRAITOR`.
   *
   * HỆ QUẢ: preset 10 (`1 WEREWOLF + WOLF_CUB`) hết báo động giả. Ở 7 nó chấm
   * `wolfPower` 12 so với `villagePower` 11.5 và tự kêu "sức mạnh làng thấp hơn
   * phe Sói" trong khi đo ra 52.7%. Ở 6 thì 11 so với 11.5, và phép kiểm im.
   * Đây là số đo tự gỡ một ngoại lệ, KHÔNG phải một con số vặn cho vừa ngưỡng:
   * phép đo trên chạy độc lập và không hề nhìn vào preset 10.
   */
  WOLF_CUB: 6,
  /**
   * 3.5, ĐÃ ĐO - thay cho con số 3 ước lượng lúc dựng vai.
   *
   * So cặp trên đúng bộ seed, speech BẬT, 600 ván mỗi ô, thay MỘT ghế Dân Làng
   * bằng lá này:
   *
   *   n  | không có | có Phản Bội |   Δ
   *   11 |   41.2   |    12.3     | -28.8
   *   12 |   42.8   |    22.2     | -20.7
   *   13 |   52.7   |    26.2     | -26.5
   *   15 |   56.8   |    40.7     | -16.2
   *   18 |   57.3   |    43.2     | -14.2
   *   20 |   49.3   |    40.5     |  -8.8
   *                        Δ TB   = -19.2
   *
   * Quy đổi: cùng bộ seed đó, thay một ghế Dân Làng bằng một con SÓI đáng -27
   * điểm (11 người: 68.3 xuống 41.2). Kẻ Phản Bội vì thế nặng khoảng 0.7 con
   * Sói, tức 0.7 x 4.5 = 3.15 điểm trên mức Dân Làng, tức 3.65. Làm tròn xuống
   * 3.5 theo đúng quy ước của bảng này: đừng chép thẳng số đo.
   *
   * NẶNG HƠN dự tính lúc thiết kế (12-15 điểm), và lý do đáng ghi lại: nó
   * không có hành động đêm nhưng nó ĐƯỢC ĐẾM vào thế cân bằng của `checkWin`,
   * nên bầy Sói chạm ngưỡng thắng sớm hơn đúng một cái chết - trong khi không
   * nguồn xác nhận nào của làng chỉ ra được nó. Không giết ai không có nghĩa là
   * không nguy hiểm.
   *
   * Δ CHẠY THEO CỠ PHÒNG, từ -28.8 (11 người) tới -8.8 (20 người). Một ghế
   * trong thế cân bằng đáng giá nhiều hơn ở bàn nhỏ. Bảng `ROLE_POWER` chỉ có
   * MỘT con số cho mỗi vai nên nó không diễn tả được điều đó - đây là giới hạn
   * của thang đo, và nó áp dụng cho mọi dòng khác trong bảng chứ không riêng
   * dòng này.
   */
  TRAITOR: 3.5,
  /**
   * 2, TẠM (chờ đo Task 9) - mirror Detective bên phe Sói.
   *
   * Sói Pháp Sư soi mỗi đêm để tìm dòng Tiên Tri, hẹp hơn Tiên Tri (chỉ trả
   * lời "có phải dòng Tiên Tri không" thay vì phe đầy đủ), nên đặt ngang
   * Detective - vai soi hẹp bên phe làng. Đo so cặp speech BẬT rồi chốt.
   */
  SORCERER: 2,
  /**
   * 6, TẠM (chờ đo Task 9) - ngang Sói Con nhưng ổn định hơn.
   *
   * Sói Alpha cắn cùng bầy mỗi đêm như Sói thường, cộng thêm khiên miễn soi
   * lần đầu. Đặt ngang Sói Con (lá mạnh nhất bộ bài) vì thêm một con cắn mà
   * còn che được một lượt soi; không phụ thuộc cỡ bàn như cơn phẫn nộ của
   * Sói Con nên con số này ít rủi ro hơn. Đo so cặp speech BẬT rồi chốt.
   */
  ALPHA_WOLF: 6,
  SEER: 5,
  /**
   * 1, hạ từ 2. Đo lại 2026-09-04 bằng SO CẶP trên đúng bộ seed, speech BẬT,
   * 600 ván mỗi ô - tức đúng cách `role-power.ts` đo, chỉ khác là có lời nói:
   *
   *   n  | không có | có Tập Sự |  Δ
   *   10 |   48.5   |   47.8    | -0.7
   *   12 |   43.2   |   42.7    | -0.5
   *   13 |   47.8   |   47.2    | -0.7
   *   14 |   50.7   |   47.7    | -3.0
   *   15 |   53.8   |   55.7    | +1.8
   *                       Δ TB  = -0.6
   *
   * Tức lá này đáng GẦN ĐÚNG một lá Dân Làng, không phải hơn 1.5 điểm như bảng
   * cũ ghi. Nó không làm gì cho tới khi Tiên Tri chết, và ở bàn bot thì Tiên
   * Tri thường sống tới cuối hoặc chết quá muộn để phần thừa kế kịp có giá.
   *
   * KHÔNG hạ thẳng xuống 0.5 dù số đo nói vậy, và lý do đúng bằng lý do đã
   * dùng cho Thợ Săn với Thám Tử ngay trên: phần giá trị của vai này nằm ở chỗ
   * làng CÒN một Tiên Tri dự phòng, mà bot không khai thác được sức ép tâm lý
   * đó - người thật thì có. Một nấc, không phải cả quãng.
   *
   * Ghi lại một lần đọc SAI để lần sau không lặp: một lượt đo 200 ván KHÔNG
   * ghép cặp từng cho ra Δ tới -8.5, và suýt nữa thì bảng này ghi vai đó là có
   * hại. Cùng cấu hình, đo ghép cặp 600 ván, ra -0.7. Đo không ghép cặp ở dải
   * này là đo nhiễu.
   *
   * HẠ THÊM MỘT NẤC (1 -> 0.5) sau khi LÀM LẠI kỹ năng: từ 2026-09-05 nó biết
   * Tiên Tri là ai ngay đêm 1 thay vì ngồi không tới lúc Tiên Tri chết. Đo lại
   * 7 preset x 1000 ván/nhánh: -1.77 điểm, SE 0.50, tức 3.6 sai số chuẩn - âm
   * THẬT, và âm hơn cả trước khi sửa. Kỹ năng mới có chạy (bằng chứng
   * `PROVEN_FALSE_CLAIM` nổ trong ván), nhưng nó không bù nổi cái giá của một
   * ghế đặc biệt.
   *
   * Vẫn "một nấc, không phải cả quãng", đúng chính sách dòng này đã dựng ở trên:
   * số đo quy về thang này là -0.2, nhưng dừng ở 0.5 - ngang một lá Dân Làng -
   * chứ không đi xuống âm. Lý do không đổi: bot không khai thác được sức ép của
   * việc làng CÒN một Tiên Tri dự phòng, và giờ có thêm một lý do thứ hai - lá
   * này khai vai, mà 70.7% lời khai ở bàn bot bị tranh chấp.
   */
  APPRENTICE_SEER: 0.5,
  DETECTIVE: 2,
  GUARD: 2.5,
  GUARDIAN_ANGEL: 1.5,
  WITCH: 3,
  /**
   * 0.5 - HẠ TỪ 1.5 sau khi làm lại kỹ năng và đo lại ở 1000 ván/nhánh.
   *
   * Bản đầu tắt kỹ năng phe làng TỚI HẾT VÁN khi chính làng giết Trưởng Lão, và
   * bẫy đó nổ ở 39% số ván preset 17-20 (đo 240 ván; 79/94 lần là treo cổ).
   * Lá bài khi đó đáng -3.7 điểm tỉ lệ thắng. Sau khi hình phạt rút còn ĐÚNG một
   * đêm và một ngày, nó đo lại ra -0.92 điểm (SE 0.68, tức 1.4 sai số chuẩn).
   *
   * 1.4σ nghĩa là KHÔNG phân biệt được với một lá Dân Làng, nên nó nhận đúng giá
   * trị của Dân Làng. Khoảng tin 95% chạy từ -0.4 tới +0.7 trên thang này, tức
   * 1.5 nằm NGOÀI khoảng đó - hạ xuống là kết luận của số đo, không phải làm tròn.
   */
  ELDER: 0.5,
  /**
   * 0.5 - HẠ TỪ 1.5, và con số cũ đo một kỹ năng CHƯA TỪNG CHẠY.
   *
   * `settleDoppelganger` thiếu hẳn trong harness self-play trong khi server vẫn
   * gọi, nên trong 60/60 ván preset 19/20 - ván nào cũng có người chết - lá này
   * không hoá vai lần nào. Mọi số đo trước đó đo một Dân Làng đổi tên.
   *
   * Nối xong (nay cả hai đường cùng đi qua `settleAndCheckWin`), nó hoá vai ở
   * 92% số ván và đo ra +0.45 điểm - THẤP hơn hẳn con số cũ. Có lý: nó hoá theo
   * vai của người chết ĐẦU TIÊN, mà cái chết đầu ván có thể là một con Sói, và
   * khi đó lá bài ĐỔI PHE - phe làng mất trắng một ghế.
   *
   * Mẫu chỉ 2 preset (19 và 20), nên đây vẫn là dòng kém chắc nhất bảng.
   */
  DOPPELGANGER: 0.5,
  HUNTER: 2,
  MAYOR: 1.5,
  // Âm là có chủ ý, xem chú thích trên: bảng đo "đóng góp cho phe đang giữ lá
  // này", và lá này đóng góp âm cho phe làng.
  //
  // Đừng thả nó xuống đúng số đo (-3.7 tới -4.6) mà không kiểm lại preset 10:
  // bộ bài đó có cả Kẻ Nguyền Rủa lẫn Sói Con, và ở -3 nó đã sát mép với
  // `villagePower` 12.5 so với `wolfPower` 12. Thêm một nấc âm nữa là chính
  // preset tự kêu ở phép kiểm "sức mạnh làng thấp hơn phe Sói" - trong khi nó
  // đo ra 45.0% cho phe làng, tức một báo động giả do bảng chứ không do bộ bài.
  CURSED: -3,
  VILLAGER: 0.5,
  /**
   * 0, và con số này KHÔNG đi vào cả `villagePower` lẫn `wolfPower`: Thằng Hề
   * là vai trung lập nên nó không đóng góp cho phe nào (xem `villageRoles`).
   *
   * Ảnh hưởng thật của nó lên bảng cân bằng vẫn có và vẫn đúng dấu: bật Thằng
   * Hề là lấy mất một ghế Dân Làng, nên `villagePower` giảm đúng 0.5 - một lá
   * hơi bất lợi cho làng, đúng như bản chất của nó (làng mất một lá phiếu biết
   * suy luận và có thêm một người chủ động phá ngày).
   */
  JESTER: 0,
  /**
   * 0, và cùng lý do với Thằng Hề: bảng này đo "đóng góp cho phe đang giữ lá
   * này", mà Sát Nhân không giữ lá cho phe nào - `villageRoles`/`wolfRoles` lọc
   * theo `roleTeam` nên con số này không bao giờ được cộng vào đâu cả.
   *
   * ĐỌC ĐÚNG con số 0 này: nó KHÔNG nói "lá bài này vô hại". Nó nói "thang đo
   * hai phe không đo được lá bài này". Sát Nhân giết mỗi đêm và tự nó là một
   * bên thứ ba tranh phần thắng chung - ảnh hưởng thật của nó lên ván đấu lớn
   * hơn hẳn mọi lá trong bảng, và nó nằm ngoài thứ `calculateBalanceScore` biết
   * cách chấm. Vì vậy `generateWarnings` phát một cảnh báo RIÊNG khi lá này
   * được bật, thay vì để một điểm số 40-60 đứng ra bảo lãnh cho bộ bài.
   */
  SERIAL_KILLER: 0,
  /**
   * 0, và cùng lý do hình thức với hai vai trung lập trên: `villageRoles` và
   * `wolfRoles` lọc theo `roleTeam`, nên con số này không bao giờ được cộng vào
   * vế nào của phép trừ.
   *
   * ĐỌC ĐÚNG con số 0 này. Nó KHÔNG nói "lá bài này vô hại", và cũng không nói
   * "đã đo ra 0". Kẻ Báo Thù không giết ai và không có kỹ năng nào, nên phần
   * ảnh hưởng mà thang đo BẮT được là đúng một ghế Dân Làng bị lấy đi
   * (`villagePower` giảm 0.5) - y hệt Thằng Hề. Phần thang đo KHÔNG bắt được
   * thì lớn hơn thế: cả ván nó vận động để làng treo cổ MỘT người vô tội cụ
   * thể, tức một áp lực có hướng nhằm thẳng vào phe Dân, và một bảng cộng trừ
   * sức mạnh hai phe không có ô nào cho đại lượng đó. Chưa có batch self-play
   * nào đo vai này, nên `generateWarnings` nói thẳng giới hạn ấy thay vì để
   * một điểm số 40-60 đứng ra bảo lãnh.
   */
  EXECUTIONER: 0,
};

/**
 * Luật cân bằng sống ở `shared` chứ không ở `game-engine`, vì nó có ĐÚNG HAI
 * người dùng ở hai đầu: server dùng để CHẶN cấu hình lệch, còn sảnh chờ dùng để
 * xem trước tức thì lúc host bật/tắt vai.
 *
 * Trước đây mỗi bên giữ một bản chép tay (`apps/web/src/lib/balance.ts` ghi rõ
 * là nhân bản để né việc kéo `game-engine` vào bundle Next). Hai bản khớp nhau
 * ở thời điểm chép, nhưng chỉnh một bên là sảnh chờ báo "Cân bằng" trong khi
 * server chặn - lệch mà không ai thấy. `shared` chỉ phụ thuộc `zod` nên web
 * import được mà không đụng tới lõi engine hay bộ não BOT.
 */

const BASE_TIMINGS: Pick<
  RoomConfig,
  "nightSeconds" | "discussionSeconds" | "voteSeconds" | "defenseSeconds" | "finalVoteSeconds"
> = {
  nightSeconds: 30,
  discussionSeconds: 60,
  voteSeconds: 30,
  defenseSeconds: 25,
  finalVoteSeconds: 20,
};

/**
 * SÁU VAI LÕI - có mặt trong MỌI preset, không có ngoại lệ.
 *
 * Đây là một ràng buộc SẢN PHẨM, không phải một kết luận từ số đo, và thứ tự
 * đó quan trọng: khi cân bằng và danh sách này xung đột thì cân bằng phải tìm
 * đường khác. Sáu lá này là hình dạng mà người chơi nhận ra một ván Ma Sói qua
 * đó; một preset thiếu Phù Thuỷ đo ra 50% vẫn là một ván mà không ai cứu được
 * ai, và đó là một trò chơi khác chứ không phải một trò chơi cân bằng hơn.
 *
 * `VILLAGER` nằm trong danh sách và nó KHÔNG thừa: `validateRoomConfig` đã đòi
 * còn ít nhất một ghế trống, nhưng nó đòi vì lý do kỹ thuật (bộ chia bài cần
 * chỗ lấp), còn ở đây là vì lý do trò chơi - phải có người thật sự không biết
 * gì thì những lá biết mới có nghĩa.
 *
 * `WEREWOLF` nghĩa là Sói THƯỜNG, ít nhất một con: một bầy chỉ toàn Sói Con là
 * một bầy chơi bằng luật khác.
 *
 *  Lá được phép gỡ ra để chỉnh cân bằng là phần còn lại: Thám Tử, Thị Trưởng,
 *  Thiên Thần Hộ Mệnh, Tiên Tri Tập Sự, Sói Con, Kẻ Nguyền Rủa.
 */
export const CORE_PRESET_ROLES: readonly Role[] = [
  "SEER",
  "GUARD",
  "HUNTER",
  "WITCH",
  "WEREWOLF",
  "VILLAGER",
];

/**
 * Vai lõi nào còn THIẾU trong một bộ bài, ở cỡ phòng đó.
 *
 * Trả về mảng rỗng là đủ. Nhận `playerCount` vì `VILLAGER` không phải một cờ
 * trong `RoomConfig` - nó là phần ghế còn lại, nên chỉ đếm được khi biết bàn có
 * bao nhiêu người.
 */
export function missingCoreRoles(config: RoomConfig, playerCount: number): Role[] {
  const roles = new Set<Role>(specialRoleList(config));
  const villagerSeats = config.villagers ?? playerCount - specialRoleList(config).length;
  if (villagerSeats > 0) roles.add("VILLAGER");
  return CORE_PRESET_ROLES.filter((role) => !roles.has(role));
}

function preset(overrides: Partial<RoomConfig>): RoomConfig {
  return {
    werewolves: 2,
    // Không preset nào chứa vai trung lập, và khai báo tường minh ở đây là cách
    // khẳng định điều đó: `isPresetDeck` so từng khoá, nên một bộ bài bật Hề
    // hay Sát Nhân không bao giờ được coi là "preset chuẩn".
    jester: false,
    serialKiller: false,
    executioner: false,
    seer: false,
    guard: false,
    witch: false,
    hunter: false,
    cursed: false,
    wolfCub: false,
    sorcerer: false,
    alphaWolf: false,
    apprenticeSeer: false,
    detective: false,
    guardianAngel: false,
    mayor: false,
    elder: false,
    doppelganger: false,
    mode: "ranked",
    ...BASE_TIMINGS,
    ...overrides,
  } as RoomConfig;
}

/*
 * Preset 8-15, hiệu chỉnh 2026-09-04 từ self-play trên chính `PRESET_DECKS`.
 *
 * Bảng cũ (spec 2026-08-29) đo ra 7-47% cho phe làng, và tệ dần theo cỡ phòng:
 * 12 người ra 7.3%, 15 người ra 13.7%. Nguyên nhân là SỐ SÓI, không phải vế
 * làng - mọi preset từ 9 người trở lên thừa đúng một con.
 *
 *   n  | sói cũ  | làng cũ | sói mới | làng mới
 *    8 | 2       |  47.3%  | 2       |  52.3%   (giữ nguyên)
 *    9 | 2+Con   |  16.3%  | 1+Con   |  52.0%
 *   10 | 2+Con   |  16.7%  | 1+Con   |  45.0%
 *   11 | 2+Con   |  29.3%  | 3       |  35.0%
 *   12 | 3+Con   |   7.3%  | 3       |  38.0%
 *   13 | 3+Con   |  15.0%  | 3       |  40.7%
 *   14 | 3+Con   |  15.7%  | 3       |  50.0%
 *   15 | 3+Con   |  13.7%  | 3       |  42.7%
 *
 * CẢNH BÁO 2026-09-04, ĐỌC TRƯỚC KHI TIN MỘT CON SỐ NÀO Ở TRÊN: cả cột "cũ" lẫn
 * cột "mới" trong bảng ấy đo với `speech: false`, và chế độ đó KHÔNG phải trò
 * chơi mà phòng thật đang chạy.
 *
 * Lời nói của BOT không phải lớp trang trí phủ lên một quyết định đã chốt. Nó
 * đi qua `chat-analysis -> claim-credibility -> applyEvidence`, tức nó nuôi
 * thẳng vào belief và đổi phiếu. `role-power.ts` tắt speech "chỉ để chạy nhanh
 * hơn", với lý do "lõi quyết trước, câu chữ dựng sau" - lý do đó SAI. Đo lại
 * cùng preset, 300 ván mỗi ô:
 *
 *   n  | speech tắt | speech BẬT | Δ
 *    8 |    42.7    |    45.0    |  +2.3
 *    9 |    42.7    |    50.0    |  +7.3
 *   10 |    49.7    |    58.0    |  +8.3
 *   11 |    37.3    |    41.0    |  +3.7
 *   12 |    48.0    |    69.7    | +21.7
 *   13 |    42.3    |    46.0    |  +3.7
 *   14 |    34.7    |    51.3    | +16.7
 *   15 |    40.0    |    63.7    | +23.7
 *
 * Δ chạy từ +2.3 tới +23.7 nên KHÔNG quy về một hệ số bù được: một bảng đo
 * speech-tắt không dịch được sang phòng thật bằng bất kỳ phép cộng nào.
 *
 * Với `speech: true`, 600 ván/ô, chính bảng preset dưới đây đo ra:
 *
 *   n  |  8   |  9   |  10  |  11  |  12  |  13  |  14  |  15
 *   %  | 51.0 | 51.2 | 49.3 | 36.0 | 41.0 | 43.8 | 47.2 | 53.5
 *
 * Tức bảng này ĐANG ở trong dải, và cỡ phòng lệch thật sự là 11 người (36.0) -
 * không phải 10 và 12 như bảng speech-tắt tố cáo. Một lượt "sửa" theo bảng
 * speech-tắt đã thử gỡ Kẻ Nguyền Rủa khỏi preset 10 và hạ preset 12 xuống 2 Sói;
 * đo lại với speech bật thì hai bộ ấy vọt lên 62.0% và 70.8%, nên cả hai đã được
 * TRẢ LẠI. Preset 15 giữ thay đổi (bỏ Kẻ Nguyền Rủa): 44.0 -> 53.5, đó là lần
 * duy nhất trong ba lần mà số đo đúng chế độ cũng đồng ý.
 *
 * Hai điều cần biết trước khi chỉnh tiếp bảng này:
 *
 * 1. ĐO VỚI `speech: true`. Xem ngay trên. Sàn nhiễu khi đó vẫn quanh ±3 với
 *    600-900 ván (3 seed family x 200-300), nên hiệu ứng số Sói (20-30 điểm)
 *    tin được, còn hiệu ứng thêm/bớt một vai làng (0-8 điểm) thì vẫn KHÔNG.
 *    Ghi chú cũ "sàn nhiễu ±5, cá biệt ±9" là hiện vật của việc chạy một lượt
 *    300 ván trên một seed base duy nhất.
 * 2. Đây là BOT đánh BOT, và bot làng bỏ phiếu trúng Sói chỉ 40-47%. Người thật
 *    đọc vị tốt hơn, nên chỉnh cho self-play chạm đúng 50% là đẩy phòng người
 *    sang phía làng. Dải 35-55% ở đây là cố ý chừa khoảng đó.
 * 3. Harness self-play KHÔNG chạy pha DEFENSE: `runSelfPlay` đi thẳng từ
 *    `resolveNomination` sang `beginFinalVote`, nên `decideDefense` chưa từng
 *    chạy trong một ván đo nào. Mọi con số ở đây vì thế đo một ván mà bị cáo
 *    không được tự bào chữa.
 *
 * Sói Con vì thế chỉ còn ở preset 9 và 10. Ở 11 và 15 nó đắt hơn hẳn một con
 * Sói thường (11 người: 30.5% với Con so với 40.5% không Con), và `ROLE_POWER`
 * cũng đã ghi nó là lá mạnh nhất bộ bài. Nó vẫn bật được trong bộ bài tuỳ chỉnh.
 *
 * Preset 6 và 7 đã GỠ HẲN: `MIN_PLAYERS_TO_START` lên 8 nên không phòng nào với
 * tới chúng nữa, và cả hai đều không cân bằng được (xem chú thích ở hằng số đó).
 *
 * Deck details:
 * 8: WEREWOLF x2, SEER, WITCH, GUARD, HUNTER, DETECTIVE, VILLAGER
 * 9: WEREWOLF, WOLF_CUB, SEER, WITCH, GUARD, DETECTIVE, HUNTER, VILLAGER x2
 * 10: WEREWOLF, WOLF_CUB, CURSED, SEER, APPRENTICE_SEER, WITCH, GUARD, HUNTER, VILLAGER x2
 * 11: xem khối chú thích ngay trên `11: preset(...)` - đã đổi 2026-09-04
 * 12: xem khối chú thích ngay trên `11: preset(...)` - đã đổi 2026-09-04
 * 13: WEREWOLF x3, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, VILLAGER x3
 * 14: WEREWOLF x3, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, VILLAGER x4
 * 15: WEREWOLF x3, CURSED, SEER, APPRENTICE_SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, VILLAGER x3
 */

const RAW_PRESET_DECKS: Record<number, RoomConfig> = {
  8: preset({ werewolves: 2, seer: true, witch: true, guard: true, hunter: true, detective: true }),
  9: preset({ werewolves: 2, seer: true, witch: true, guard: true, detective: true, hunter: true }),
  10: preset({
    werewolves: 1,
    wolfCub: true,
    cursed: true,
    seer: true,
    apprenticeSeer: true,
    witch: true,
    guard: true,
    hunter: true,
  }),
  /*
   * 11 và 12: HAI Sói cộng KẺ PHẢN BỘI - nấc thang mà bộ vai cũ không có.
   *
   * Hai cỡ phòng này lệch nhất bảng suốt lần hiệu chỉnh, và vấn đề là SỐ HỌC
   * chứ không phải bộ bài: 2 Sói trên 11 người là 18%, 3 Sói là 27%, và không
   * có giá trị nguyên nào ở giữa. Đo trên V10, speech bật, 600 ván mỗi ô:
   *
   *   n  | 3 sói | 2 sói | khoảng trống
   *   11 | 41.2  | 68.3  |  27 điểm
   *   12 | 42.8  | 69.5  |  27 điểm
   *
   * Vế làng KHÔNG bắc được cầu đó. Bỏ vai làng không-lõi khỏi nhánh 2 Sói dịch
   * chưa tới 1 điểm (Thám Tử 61.8, Thị Trưởng 61.0, cả hai 61.5). Thêm vai làng
   * vào nhánh 3 Sói cũng vậy, thậm chí âm (11 người + Thiên Thần: 35.0).
   *
   * `TRAITOR` được dựng ra ĐÚNG cho khoảng trống này, và nó rơi vào giữa:
   *
   *   n  | 3 sói | 2 sói + Phản Bội | 2 sói
   *   11 | 41.2  |       43.5       | 68.3
   *   12 | 42.8  |       47.7       | 69.5
   *
   * 12 người dừng ở đó: 47.7, gần 50 nhất mà cỡ phòng này từng chạm.
   *
   * 11 người cần thêm một nấc nữa vì bàn nhỏ hơn nên mỗi ghế nặng hơn. Thiên
   * Thần Hộ Mệnh (không phải vai lõi, được phép thêm) đưa nó từ 39.3 lên 43.7 -
   * hơn bộ cũ 5.2 điểm, tức khoảng 2.6 sai số chuẩn ở 600 ván. Tiên Tri Tập Sự
   * cũng ra đúng 43.7; chọn Thiên Thần vì nó có việc để làm ngay từ đêm 1, còn
   * Tập Sự đo ra gần bằng 0 (xem `ROLE_POWER`).
   *
   * 11 người vẫn là cỡ phòng lệch nhất bảng. Nó nằm trong dải 35-55 mà repo tự
   * tuyên bố, nhưng không chạm được 45 - và cả bộ vai hiện có đã thử hết.
   *
   * 11: WEREWOLF x2, TRAITOR, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, VILLAGER x2
   * 12: WEREWOLF x2, TRAITOR, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, VILLAGER x4
   */
  11: preset({
    werewolves: 2,
    traitor: true,
    guardianAngel: true,
    seer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
  }),
  12: preset({
    werewolves: 2,
    traitor: true,
    seer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
  }),
  13: preset({
    werewolves: 3,
    seer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
    guardianAngel: true,
  }),
  14: preset({
    werewolves: 3,
    seer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
    guardianAngel: true,
  }),
  15: preset({
    werewolves: 3,
    cursed: true,
    seer: true,
    apprenticeSeer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
    guardianAngel: true,
  }),
  /*
   * 16-20: bộ vai làng đã CẠN, nên lá điều chỉnh là Kẻ Nguyền Rủa.
   *
   * Cả năm bộ dùng trọn 9 vai chức năng phe làng - không còn lá nào để thêm.
   * Cùng lúc, một con Sói ở cỡ này đáng tới 22 điểm tỉ lệ thắng (đo 200 ván/ô,
   * speech bật):
   *
   *   n  | 3 sói | 4 sói | 5 sói
   *   16 | 60.5  | 38.5  | 16.5
   *   18 | 63.0  | 40.5  | 21.5
   *   20 | 69.0  | 46.5  | 27.5
   *
   * Không có cách nào chọn giữa 60.5 và 38.5 mà trúng 50. Kẻ Nguyền Rủa lấp
   * đúng khoảng đó: nó ngồi ghế phe làng nhưng `ROLE_POWER` của nó là -3, và đo
   * thực tế hôm nay cho thấy gỡ nó khỏi preset 10/15 đáng +7.4 tới +9.9 điểm.
   * Nó là NỬA CON SÓI của bộ bài này, và đó là lý do nó quay lại đây sau khi bị
   * gỡ khỏi preset 15.
   *
   *   n  | bộ bài chọn         | chốt | (sàng @200) | phương án bị loại
   *   16 | 3 sói + Nguyền Rủa  | 51.2 |    48.0     | 3 sói 60.5 / 4 sói 38.5
   *   17 | 3 sói + Nguyền Rủa  | 52.8 |    47.0     | 4 sói 38.5
   *   18 | 3 sói + Nguyền Rủa  | 58.0 |    56.5     | 4 sói 40.5
   *   19 | 4 sói               | 50.8 |    52.5     | 3 sói + Nguyền Rủa 64.0
   *   20 | 4 sói               | 52.0 |    46.5     | 4 sói + Nguyền Rủa 36.0
   *
   * Cột "chốt" là 600 ván/cỡ phòng (3 seed family x 200); cột trong ngoặc là
   * lượt sàng 200 ván đã dùng để CHỌN bộ bài. Hai cột lệch nhau tới 5.8 điểm ở
   * n=20, và đó là lời nhắc rằng lượt sàng chỉ đủ để phân biệt 3 với 4 Sói (cách
   * nhau 22 điểm), không đủ để tin một con số lẻ.
   *
   * PHƯƠNG SAI Ở BÀN LỚN CAO HƠN HẲN bàn nhỏ: ba seed family của n=17 ra 50.0 /
   * 62.5 / 46.0, của n=20 ra 58.0 / 44.5 / 53.5 - trải 16 điểm, trong khi ở
   * n=10 ba family chỉ trải 3 điểm. Ván dài 7-9 vòng nên một cú treo trúng hay
   * trượt sớm còn cả ván để nhân lên. Muốn kết luận gì ở dải này thì phải chạy
   * nhiều seed family, không phải nhiều ván trên một family.
   *
   * 18 người ra 58.0, tức trên dải 45-55. Phương án còn lại (4 sói, 40.5) lệch
   * xa hơn về phía kia, nên đây là chỗ tốt nhất mà bộ bài với tay tới được -
   * vế làng đã dùng trọn 10 lá nên không còn gì để bớt ngoài việc đổi hẳn số Sói.
   *
   * CẢNH BÁO khi so với bảng 8-15 ở trên: bảng đó đo với `spareTrustMargin` 3
   * (BOT_WEIGHTS_V9), còn bảng này đo sau khi mặc định chuyển sang V10 (margin
   * 0). V10 đo ra tỉ lệ thắng của phe làng không đổi (Δ trung bình +0.6 trên
   * sáu cỡ phòng), nên hai bảng so được với nhau - nhưng đó là một kết quả đo,
   * không phải một điều hiển nhiên.
   *
   * KHÔNG bộ nào chạm trần 4 Sói của `roomConfigSchema`, và đó là một kết quả
   * chứ không phải một ràng buộc: 5 Sói đo ra 16.5-27.5%, dưới sàn 35% ở cả ba
   * cỡ phòng. Bảng trên là lý do đừng nâng trần đó.
   *
   * Ván ở cỡ này DÀI: 7.0 vòng ở 16 người tới 8.8 vòng ở 20, so với 3.3 vòng ở
   * 8 người. Với `BASE_TIMINGS` thì một ván 20 người chạm 25-30 phút. Timing
   * không bị đụng tới ở đây vì bàn đông cần NHIỀU thời gian nói hơn chứ không
   * ít hơn, nhưng con số đó là một quyết định sản phẩm chưa ai ra.
   *
   * 16: WEREWOLF x3, CURSED, SEER, APPRENTICE_SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, VILLAGER x4
   * 17: WEREWOLF x3, CURSED, SEER, APPRENTICE_SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, ELDER, SORCERER, VILLAGER x3
   * 18: WEREWOLF x4, SEER, APPRENTICE_SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, ELDER, SORCERER, VILLAGER x4
   * 19: WEREWOLF x4, DOPPELGANGER, SEER, APPRENTICE_SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, ELDER, ALPHA_WOLF, VILLAGER x4
   * 20: như trên thêm CURSED, VILLAGER x4
   *
   * Đổi 2026-09-05 (SORCERER + ALPHA_WOLF thay MEDIUM + PRIEST, xóa cứng):
   * 14-16 trả ghế Linh Mục về Dân Làng (mỗi preset +1 Dân); 17-18 đổi
   * Bà Đồng thành Sói Pháp Sư, ghế Linh Mục về Dân (+1 Dân); 19-20 đổi Linh
   * Mục thành Sói Alpha, ghế Bà Đồng về Dân (+1 Dân). Mỗi preset lớn thêm
   * đúng 1 sói mới, villagers suy tự động từ cỡ phòng trừ số lá đặc biệt.
   */
  /*
   * ĐO LẠI 2026-09-04 sau khi 17-20 nhận Trưởng Lão, Bà Đồng, Kẻ Song Trùng.
   *
   * Bảng ngay trên đo bộ bài CŨ. Ba lá mới thêm vào để bàn lớn bớt dân thường -
   * n=20 từ 7 dân xuống 3 - và cả ba đều là vai phe làng, nên vế làng nặng lên
   * đúng như số học dự đoán. 450 ván mỗi ô (3 seed family x 150), `--preset`,
   * speech bật, cùng bộ trọng số mặc định:
   *
   *   n  | cũ   | mới  |   Δ   | sd giữa family | Δ/SE | kết luận
   *   17 | 52.8 | 59.1 | +6.3  |      1.6       | 7.0  | chắc
   *   18 | 58.0 | 61.5 | +3.5  |      2.4       | 2.6  | khá chắc
   *   19 | 50.8 | 58.2 | +7.4  |      3.0       | 4.3  | chắc
   *   20 | 52.0 | 57.1 | +5.1  |      7.9       | 1.1  | KHÔNG kết luận được
   *
   * CẢ BỐN GIỜ NẰM TRÊN DẢI 35-55 mà repo tự tuyên bố, 57-61. Đó là một khoản
   * nợ đã biết chứ không phải một kết quả: bài này đổi bộ bài cho mục tiêu SỐ
   * GHẾ ("dân thường không vượt quá ghế phe Sói"), và cái giá của nó là cán cân
   * dịch khoảng +5 điểm về phía làng.
   *
   * Lá điều chỉnh sẵn có là Kẻ Nguyền Rủa: nó đáng -7.4 tới -9.9 điểm (số đo cũ,
   * xem khối trên), tức vừa đúng cỡ cần bù. 17 và 20 đã có nó; thả nó vào 18 và
   * 19 là phép thử hiển nhiên tiếp theo, và cũng làm hai cỡ đó bớt thêm một dân
   * thường. CHƯA LÀM vì chưa đo, và một lần thả không đo là đổi hai thứ cùng lúc.
   *
   * n=20 vẫn là ô tệ nhất bảng để kết luận bất cứ điều gì: ba family ra 50.7 /
   * 54.7 / 66.0, trải 15 điểm. Cảnh báo ở khối trên vẫn nguyên giá trị - muốn
   * kết luận ở dải này thì chạy thêm SEED FAMILY, không phải thêm ván.
   */
  16: preset({
    werewolves: 3,
    cursed: true,
    seer: true,
    apprenticeSeer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
    guardianAngel: true,
  }),
  17: preset({
    werewolves: 3,
    cursed: true,
    seer: true,
    apprenticeSeer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
    guardianAngel: true,
    elder: true,
    sorcerer: true,
  }),
  18: preset({
    werewolves: 4,
    seer: true,
    apprenticeSeer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
    guardianAngel: true,
    elder: true,
    sorcerer: true,
  }),
  19: preset({
    werewolves: 4,
    doppelganger: true,
    seer: true,
    apprenticeSeer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
    guardianAngel: true,
    elder: true,
    alphaWolf: true,
  }),
  20: preset({
    werewolves: 4,
    doppelganger: true,
    cursed: true,
    seer: true,
    apprenticeSeer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
    guardianAngel: true,
    elder: true,
    alphaWolf: true,
  }),
};

/**
 * Preset, có `villagers` khai TƯỜNG MINH.
 *
 * Suy từ chính khoá của record chứ không chép tay: khoá LÀ cỡ phòng, nên
 * `villagers = cỡ phòng - số lá đặc biệt` cho ra đúng bộ bài mà bảng này vẫn
 * chia từ trước khi `villagers` tồn tại. Chép tay 13 con số là 13 chỗ để trôi
 * lệch mỗi lần một preset đổi một lá.
 */
export const PRESET_DECKS: Record<number, RoomConfig> = Object.fromEntries(
  Object.entries(RAW_PRESET_DECKS).map(([size, config]) => [
    Number(size),
    { ...config, villagers: Number(size) - specialRoleList(config).length },
  ]),
);


/**
 * Cảnh báo "thang đo này không đo được lá bài đó".
 *
 * Hằng số chứ không phải một chuỗi viết thẳng trong hàm: web phải NHẬN RA đúng
 * cảnh báo này để đổi câu tiêu đề của thẻ cân bằng - một bộ bài mà lời phàn nàn
 * duy nhất là "có vai ngoài thang đo" thì KHÔNG "hơi lệch", nó chỉ nằm ngoài
 * tầm với của phép chấm. So khớp bằng một tiền tố chép tay ở phía web là chỗ để
 * hai bên trôi khỏi nhau ngay lần sửa câu chữ đầu tiên.
 */
export const UNMEASURED_EXECUTIONER_WARNING =
  "Bộ bài có Kẻ Báo Thù - một người chơi vận động cả ván để làng treo cổ đúng một người vô tội. BalanceScore chỉ chấm cán cân Dân/Sói nên nó KHÔNG đo được lá bài này.";

/**
 * Thằng Hề, và KHÁC hai hằng số kia ở chỗ nó nói một con số ĐÃ ĐO ĐƯỢC.
 *
 * Hai cảnh báo trên nói "thang đo không với tới lá này". Ở đây thì với tới rồi,
 * và kết quả mới là thứ đáng cảnh báo: tỉ lệ thắng của Thằng Hề leo theo cỡ
 * phòng vì nó chỉ cần trúng MỘT phiên toà, mà bàn càng đông thì càng nhiều
 * phiên toà (240 ván/ô, speech bật):
 *
 *   n  |  8   |  12  |  16  |  18  |  20
 *   Hề | 13.0 | 22.3 | 52.9 | 61.7 | 62.1
 *
 * Từ khoảng 16 người trở lên nó là lá DỄ THẮNG NHẤT bàn - hơn cả phe làng lẫn
 * phe Sói - trong khi `ROLE_POWER` của nó là 0 và phép trừ `villagePower -
 * wolfPower` chỉ thấy đúng một ghế Dân Làng bị lấy đi (-0.5 điểm).
 *
 * Vì vậy cảnh báo này CÓ ngưỡng người chơi, khác hai hằng số kia: ở bàn nhỏ con
 * số 13-22% không có gì để nói, và phát một cảnh báo ở đó chỉ dạy host bỏ qua
 * cảnh báo.
 */
export const JESTER_LARGE_TABLE_WARNING =
  "Bộ bài có Thằng Hề ở bàn đông: đo được nó thắng 53-62% số ván từ 16 người trở lên, vì bàn càng đông càng nhiều phiên toà mà nó chỉ cần trúng một lần.";

/**
 * Cỡ phòng mà `JESTER_LARGE_TABLE_WARNING` bắt đầu có hiệu lực.
 *
 * 16 chứ không phải 15: 12 người đo ra 22.3% còn 16 người ra 52.9%, và bước
 * nhảy nằm giữa hai mốc đó. Chưa có số cho 13-15, nên ngưỡng đặt ở mốc ĐÃ ĐO
 * chứ không nội suy - một cảnh báo dựa trên số phỏng đoán thì không hơn gì một
 * cảnh báo không có số.
 */
export const JESTER_LARGE_TABLE_MIN_PLAYERS = 16;

/**
 * Cùng loại với hằng số ngay trên và cùng lý do tồn tại, chỉ khác lá bài.
 */
export const UNMEASURED_NEUTRAL_WARNING =
  "Bộ bài có Sát Nhân - một bên thứ ba tranh phần thắng chung. BalanceScore chỉ chấm cán cân Dân/Sói nên nó KHÔNG đo được lá bài này.";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Danh sách vai đặc biệt theo cấu hình, CHƯA có Dân Làng lấp chỗ trống.
 *
 * Dùng chung giữa bộ chia bài (`buildRoleDeck`) và bộ chấm cân bằng: chấm điểm
 * một bộ bài khác với bộ bài thật sự được chia là cách chắc chắn nhất để bảng
 * cân bằng nói dối.
 */
export function specialRoleList(config: RoomConfig): Role[] {
  const roles: Role[] = [];
  for (let i = 0; i < config.werewolves; i++) roles.push("WEREWOLF");
  if (config.wolfCub) roles.push("WOLF_CUB");
  // Tối đa một Kẻ Phản Bội mỗi ván; boolean nên "tối đa 1" là tính chất của kiểu.
  if (config.traitor) roles.push("TRAITOR");
  // Hai sói mới, mỗi lá tối đa một như mọi cờ boolean khác. Sói Pháp Sư không
  // cắn nhưng vẫn thuộc bầy (isWolfPack) nên nó nằm trong bộ bài như một lá sói.
  if (config.sorcerer) roles.push("SORCERER");
  if (config.alphaWolf) roles.push("ALPHA_WOLF");
  if (config.seer) roles.push("SEER");
  if (config.apprenticeSeer) roles.push("APPRENTICE_SEER");
  if (config.detective) roles.push("DETECTIVE");
  if (config.guard) roles.push("GUARD");
  if (config.guardianAngel) roles.push("GUARDIAN_ANGEL");
  if (config.witch) roles.push("WITCH");
  if (config.hunter) roles.push("HUNTER");
  if (config.mayor) roles.push("MAYOR");
  if (config.elder) roles.push("ELDER");
  if (config.doppelganger) roles.push("DOPPELGANGER");
  // Tối đa một Kẻ Nguyền Rủa mỗi ván: một lá duy nhất trong bộ bài.
  if (config.cursed) roles.push("CURSED");
  // Tối đa một Thằng Hề mỗi ván, cùng lý do và cùng cách: cấu hình là boolean
  // nên "tối đa 1" là tính chất của kiểu dữ liệu, không phải một phép kiểm tra
  // ai đó phải nhớ viết.
  if (config.jester) roles.push("JESTER");
  // Tối đa một Sát Nhân, cùng lý do và cùng cách với hai lá trên.
  if (config.serialKiller) roles.push("SERIAL_KILLER");
  // Tối đa một Kẻ Báo Thù, cùng lý do và cùng cách với ba lá trên.
  if (config.executioner) roles.push("EXECUTIONER");
  return roles;
}

function villagerCount(config: RoomConfig, playerCount: number): number {
  const count = playerCount - specialRoleList(config).length;
  return count < 0 ? 0 : count;
}

function deckRoles(config: RoomConfig, playerCount: number): Role[] {
  const roles = specialRoleList(config);
  const vCount = villagerCount(config, playerCount);
  for (let i = 0; i < vCount; i++) roles.push("VILLAGER");
  return roles;
}

function sumPower(roles: Role[]): number {
  return roles.reduce((acc, r) => acc + (ROLE_POWER[r] ?? 0), 0);
}

function wolfRoles(roles: Role[]): Role[] {
  return roles.filter((r) => roleTeam(r) === "wolves");
}

/**
 * Suy ra từ `roleTeam` chứ không phải "mọi thứ không phải Sói".
 *
 * Định nghĩa cũ (`r !== "WEREWOLF" && r !== "WOLF_CUB"`) trùng kết quả khi chỉ
 * có hai phe, nhưng nó xếp một vai TRUNG LẬP vào sức mạnh của làng - tức bảng
 * cân bằng sẽ tính Thằng Hề như một người sẽ cố giúp làng thắng, đúng ngược
 * điều nó làm. Vai trung lập không nằm ở cả hai vế, nên nó chỉ ảnh hưởng tới
 * điểm số qua đúng thứ nó thật sự lấy đi: một ghế Dân Làng.
 */
function villageRoles(roles: Role[]): Role[] {
  return roles.filter((r) => roleTeam(r) === "village");
}

function infoPower(roles: Role[]): number {
  return roles.reduce((acc, r) => {
    if (r === "SEER") return acc + ROLE_POWER["SEER"];
    if (r === "APPRENTICE_SEER") return acc + ROLE_POWER["APPRENTICE_SEER"];
    if (r === "DETECTIVE") return acc + ROLE_POWER["DETECTIVE"];
    return acc;
  }, 0);
}

export function calculateBalanceScore(
  config: RoomConfig,
  playerCount: number,
): { score: number; villagePower: number; wolfPower: number } {
  const roles = deckRoles(config, playerCount);
  const wolfPower = sumPower(wolfRoles(roles));
  const villagePower = sumPower(villageRoles(roles));

  const presetDeck = PRESET_DECKS[playerCount];
  let score: number;
  if (presetDeck) {
    const presetRoles = deckRoles(presetDeck, playerCount);
    const presetDiff = sumPower(villageRoles(presetRoles)) - sumPower(wolfRoles(presetRoles));
    const rawDiff = villagePower - wolfPower;
    // Scale factor: spec says 10, but diff-of-preset centers score at 50;
    // use 3 to make moderate deviations block near 40/60.
    const SCALE = 3;
    score = clamp(50 + (rawDiff - presetDiff) * SCALE, 0, 100);
  } else {
    score = clamp(50 + (villagePower - wolfPower) * 2, 0, 100);
  }
  // Round to 1 decimal
  score = Math.round(score * 10) / 10;
  return { score, villagePower, wolfPower };
}

export function generateWarnings(config: RoomConfig, playerCount: number): BalanceWarningView {
  const { score, villagePower, wolfPower } = calculateBalanceScore(config, playerCount);
  const warnings: string[] = [];
  let blocking = false;

  /*
   * NGƯỠNG BẤT ĐỐI XỨNG: chỉ chặn phía Sói.
   *
   * `score` chấm ĐỘ LỆCH so với preset cùng cỡ phòng, nên một ngưỡng đối xứng
   * "40-60" phát biểu rằng preset đứng đúng giữa. Nó không đứng đúng giữa: đo
   * lại 900 ván/cỡ phòng (3 seed family x 300) cho phe làng 33-45%, tức chính
   * preset đã nghiêng về phe Sói. Với neo lệch như vậy, cận TRÊN chặn đúng
   * những bộ bài đã kéo ván về gần 50% - bộ 12 người 2 Sói đo ra 47.9% mà ăn
   * điểm 66.5 và bị chặn, trong khi bộ 12 người "2 Sói + Sói Con" đo ra 30.2%
   * thì ăn 44 điểm và đi qua. Thước đo khi đó không gác cân bằng nữa, nó cưỡng
   * chế độ lệch của chính preset.
   *
   * Cận DƯỚI ở lại nguyên vẹn và vẫn chặn: một bộ bài lệch về phe Sói so với
   * một preset vốn đã lệch về phe Sói thì lệch gấp đôi, và đó đúng là thứ phải
   * chặn. Cận trên hạ xuống mức cảnh báo - host vẫn được báo là bộ bài nghiêng
   * về làng, chỉ không bị khoá phòng vì điều đó nữa.
   */
  if (score < 40) {
    warnings.push(`Cân bằng lệch về phe Sói: BalanceScore ${score} dưới ngưỡng 40`);
    blocking = true;
  } else if (score > 60) {
    warnings.push(`Bộ bài nghiêng về phe Dân: BalanceScore ${score} trên ngưỡng 60`);
  } else if (score < 45 || score > 55) {
    warnings.push(`Cảnh báo cân bằng: BalanceScore ${score} ngoài ngưỡng 45-55`);
  }

  /*
   * MỐC TUYỆT ĐỐI - hai phép kiểm KHÔNG đọc `PRESET_DECKS`.
   *
   * Mọi thứ còn lại trong hàm này, kể cả `score`, đều chấm bộ bài bằng độ lệch
   * so với preset cùng cỡ phòng. Hệ quả toán học: một preset luôn ra đúng 50 và
   * không bao giờ tự tố cáo được mình. Bảng preset trước 2026-09-04 vì thế được
   * cấp chứng nhận "Cân bằng" ở cả 9 cỡ phòng trong khi đo thực tế trải từ 7%
   * tới 47%, và preset 10 người còn có `villagePower` 14 < `wolfPower` 16 mà
   * vẫn 50 điểm. Thước đo không nhìn thấy được cái thước.
   *
   * Hai mốc dưới đây suy thẳng từ luật, nên chúng còn hiệu lực kể cả khi bảng
   * preset sai.
   *
   * Cả hai CHỈ cảnh báo, không chặn: chúng là hàng rào chống bảng preset trôi
   * lệch, không phải một luật mới cho bộ bài tuỳ chỉnh, và bật `blocking` ở đây
   * sẽ khoá luôn những phòng đang chạy được hôm nay.
   */
  const wolfCount = config.werewolves + (config.wolfCub ? 1 : 0);
  if (wolfCount > 0) {
    /*
     * Ngân sách sai lầm của phe làng, chia cho số Sói phải treo.
     *
     * `checkWin` cho phe Sói thắng khi `sói >= số người còn lại`, nên phe làng
     * chịu được đúng `playerCount - 2 * sói` ca chết ngoài bầy trước khi chạm
     * thế cân bằng - và mỗi đêm tiêu một ca trong số đó mà không cần làng bỏ
     * phiếu sai lần nào. Chia cho số Sói vì đó là số lần làng BẮT BUỘC phải
     * treo trúng.
     *
     * Ngưỡng 1.5 đọc ra từ số đo: ba preset cũ tệ nhất (6, 9, 12 người) đều
     * đúng bằng 1.00. Bảng preset hiện tại thấp nhất là 1.67 (11 người).
     *
     * ponytail: mốc này chỉ mô hình hoá SỐ HỌC của thế cân bằng, nên nó bắt
     * được 4 trong 5 preset cũ tệ nhất mà trượt preset 15 người (ngân sách
     * 1.75, `villagePower` 23.5 > `wolfPower` 21, mà đo ra 13.7%). Nó mù với
     * chất lượng bầy Sói (Sói Con đáng giá trọn một con Sói) và với việc thông
     * tin loãng dần theo cỡ phòng. Đừng vặn ngưỡng lên 1.8 để vá chỗ đó: làm
     * thế là báo oan chính preset 11 người đang dùng. Muốn chặt hơn thì cần một
     * bài đo tỉ lệ thắng thật sự - `runBatch` trên từng preset, so với một dải
     * đã tuyên bố - chứ không phải một con số suy từ luật.
     */
    const budgetPerWolf = (playerCount - 2 * wolfCount) / wolfCount;
    if (budgetPerWolf < 1.5) {
      warnings.push(
        `Phe làng chỉ chịu được ${budgetPerWolf.toFixed(2)} ca chết cho mỗi Sói phải treo (dưới ngưỡng 1.5)`,
      );
    }
  }
  if (villagePower < wolfPower) {
    warnings.push(`Sức mạnh phe làng (${villagePower}) thấp hơn phe Sói (${wolfPower})`);
  }

  /*
   * Sát Nhân nằm NGOÀI thang đo, nên điểm số không được đứng ra bảo lãnh.
   *
   * `calculateBalanceScore` chấm một BỘ BÀI HAI PHE: nó cộng sức mạnh của làng,
   * trừ sức mạnh của Sói, rồi so với preset. Một bên thứ ba giết mỗi đêm và
   * tranh phần thắng chung không xuất hiện ở vế nào trong phép trừ đó - điểm
   * vẫn ra 50 và vẫn nằm gọn trong ngưỡng 40-60, trong khi ván đấu đã là một
   * ván khác hẳn.
   *
   * Cảnh báo, KHÔNG chặn: bộ bài này hợp lệ và host được quyền mở nó. Thứ bị
   * chặn là việc đọc một con số 40-60 thành "đã cân bằng".
   */
  if (config.serialKiller) {
    warnings.push(UNMEASURED_NEUTRAL_WARNING);
  }

  /*
   * Kẻ Báo Thù cũng nằm ngoài thang đo, và vì một lý do KHÁC Sát Nhân - nên nó
   * là một cảnh báo riêng chứ không dùng chung câu chữ.
   *
   * Sát Nhân nằm ngoài vì nó là một bên thứ ba giết mỗi đêm. Kẻ Báo Thù thì
   * không giết ai: thứ nó làm là dồn phiếu và lời nói của cả ván vào việc treo
   * cổ MỘT người phe Dân. Phép trừ `villagePower - wolfPower` bắt được đúng một
   * phần của điều đó (một ghế Dân Làng mất đi) và bỏ sót phần còn lại, nên con
   * số vẫn nằm gọn trong 40-60 trong khi phe Dân đang gánh thêm một áp lực có
   * hướng mà không lá bài nào trong bảng mô tả được.
   *
   * Cảnh báo, KHÔNG chặn: bộ bài này hợp lệ và host được quyền mở nó. Thứ bị
   * chặn là việc đọc một con số 40-60 thành "đã cân bằng".
   */
  if (config.executioner) {
    warnings.push(UNMEASURED_EXECUTIONER_WARNING);
  }

  /*
   * Thằng Hề ở bàn đông - xem `JESTER_LARGE_TABLE_WARNING` cho số đo.
   *
   * Cảnh báo, KHÔNG chặn, cùng lý do với hai lá trung lập kia: bộ bài hợp lệ và
   * host được quyền mở nó. Thứ bị chặn là việc đọc một điểm số 40-60 thành "lá
   * này không ảnh hưởng gì".
   *
   * Có ngưỡng người chơi, khác hai lá kia: ở bàn nhỏ Thằng Hề thắng 13-22% và
   * không có gì để cảnh báo.
   */
  if (config.jester && playerCount >= JESTER_LARGE_TABLE_MIN_PLAYERS) {
    warnings.push(JESTER_LARGE_TABLE_WARNING);
  }

  const presetDeck = PRESET_DECKS[playerCount];
  if (presetDeck) {
    const presetWolfCount = presetDeck.werewolves + (presetDeck.wolfCub ? 1 : 0);
    const wolfRatio = playerCount > 0 ? wolfCount / playerCount : 0;
    const presetRatio = playerCount > 0 ? presetWolfCount / playerCount : 0;
    const ratioDiff = Math.abs(wolfRatio - presetRatio);
    if (ratioDiff > 0.15) {
      warnings.push(
        `Tỉ lệ Sói lệch ${(ratioDiff * 100).toFixed(1)}% so với preset chuẩn (${presetWolfCount}/${playerCount})`,
      );
      blocking = true;
    }

    const cfgInfo = infoPower(deckRoles(config, playerCount));
    const presetInfo = infoPower(deckRoles(presetDeck, playerCount));
    const infoDiff = Math.abs(cfgInfo - presetInfo);
    if (infoDiff >= 3) {
      warnings.push(`Năng lực soi lệch ${infoDiff.toFixed(1)} điểm so với preset chuẩn`);
      blocking = true;
    }
  } else {
    warnings.push(`Không có preset cho ${playerCount} người chơi`);
  }

  // Ensure at least one warning when blocking due to score but no other
  if (warnings.length === 0 && blocking) {
    warnings.push(`Cấu hình mất cân bằng`);
  }

  return { score, warnings, blocking, villagePower, wolfPower };
}
