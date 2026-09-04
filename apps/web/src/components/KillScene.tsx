"use client";

import { breathOffsetFor, tintFor } from "@/lib/avatar";
import {
  killAnnouncement,
  killEyebrow,
  killTitle,
  type KillSceneView,
  type KillVictim,
} from "@/lib/kill-cinematic";
import { CharacterPortrait } from "./CharacterPortrait";
import { ShadowFigure } from "./ShadowFigure";

/**
 * Cảnh kill - khuôn mặt thật của người vừa ngã xuống, phủ kín màn hình.
 *
 * Component này CỐ Ý mỏng và CỐ Ý câm:
 *
 *   - Không `useState`, không `useEffect`, không `setTimeout`, không
 *     `requestAnimationFrame`, không canvas. Toàn bộ nhịp diễn nằm trong
 *     `cinematics.css` dưới dạng keyframes chạy MỘT lần với `forwards`, đúng
 *     luật chung của mọi cảnh trong file đó. Nhờ vậy nó không có gì để rò rỉ:
 *     lớp phủ tháo ra là mọi thứ biến mất cùng cây DOM.
 *   - Không đọc snapshot. Nó chỉ nhận `KillSceneView`, một model đã lọc sẵn ở
 *     `lib/kill-cinematic.ts` và chỉ mang ba trường công khai của mỗi nạn nhân.
 *     Đó là chỗ khoá lại việc một cảnh chuyển tiếp không thể trở thành cửa hậu
 *     đọc vai qua devtools.
 *   - Không biết gì về NGUYÊN NHÂN, và không có đường nào để biết: client không
 *     nhận `cause`, và cảnh này cũng không suy diễn hộ.
 *
 * Nó cũng độc lập với `CinematicOverlay`: overlay quyết định lúc nào phát và
 * lúc nào tháo, còn đây chỉ dựng hình. Đó là lý do `titleId` được truyền vào
 * thay vì tự đặt - `aria-labelledby` của lớp phủ trỏ vào đúng phần tử này.
 */

interface Props {
  view: KillSceneView;
  /** Id mà `aria-labelledby` của lớp phủ đang trỏ tới. */
  titleId: string;
}

export function KillScene({ view, titleId }: Props) {
  const night = view.mode === "NIGHT";
  /*
   * Component này KHÔNG tự tính khuôn mặt.
   *
   * Bản đầu gọi `assignAvatars` ngay tại đây với riêng danh sách nạn nhân, và
   * đó là một lỗi thật: hàm đó dò chỗ trống theo cả tập id, nên một tập nhỏ hơn
   * cho ra một bảng khác hẳn bảng của bàn chơi - `p4` là `bandit` trên lưới
   * nhưng thành `cultist` trong cảnh. Khuôn mặt giờ đã được `killSceneFor` chốt
   * từ toàn bộ `players[]` và đi vào đây qua `victim.avatar`; ở đây không còn
   * quyền tính lại nữa.
   */

  return (
    <div className={`kill-scene ${night ? "kill-night" : "kill-gallows"}`}>
      {/* --- Phần hình, không mang chữ nào --------------------------------- */}
      <div className="kill-stage" aria-hidden="true">
        {night ? (
          <>
            {/* Khe sáng như một cánh cửa hé: nhịp "dựng" của cảnh. */}
            <span className="kill-slit" />
            {/*
             * Bóng người quét NGANG qua hàng chân dung, một lần duy nhất, rồi
             * đi khỏi khung. Nó không dừng lại, không quay mặt, không chạm vào
             * ai - chuyển động là thứ kể chuyện, không phải một hành động vẽ ra.
             */}
            {/* `aria-hidden` đặt ngay TẠI ĐÂY, dù thẻ bọc `.kill-stage` cũng đã
              * ẩn: sự ẩn danh của bóng người không được phép phụ thuộc vào một
              * thuộc tính nằm ở tổ tiên, thứ mà một lần đổi bố cục sau này có
              * thể gỡ đi mà không ai nhận ra. */}
            <span className="kill-attacker" data-kill-attacker aria-hidden="true">
              <ShadowFigure className="h-full w-full text-black" />
            </span>
            <span className="kill-flash" />
          </>
        ) : (
          <>
            {/*
             * Dây thòng lọng và ván bục KHÔNG nằm ở đây.
             *
             * Cả hai phải chạm đúng vào chân dung - dây rơi xuống đỉnh đầu, ván
             * nằm ngay dưới chân - mà vị trí của chân dung là do flexbox quyết
             * định, không phải một con số phần trăm đoán trước. Nên chúng là
             * pseudo-element của chính hàng chân dung (`.kill-gallows .kill-row`
             * trong `cinematics.css`) và tự đi theo bố cục ở mọi cỡ màn.
             *
             * Còn lại ở đây là hai thứ phủ TOÀN KHUNG, vốn không neo vào ai cả.
             */}
            {/* Vòng khán giả: cả làng đứng xem, và cả làng đều ẩn danh như nhau. */}
            <span className="kill-crowd" />
            <span className="kill-spot" />
          </>
        )}
      </div>

      {/* --- Hàng chân dung ------------------------------------------------ */}
      <div className="kill-row">
        {view.victims.map((victim, index) => (
          <VictimFace
            key={victim.playerId}
            victim={victim}
            /*
             * Lệch nhịp theo VỊ TRÍ, không theo id.
             *
             * Ba khuôn mặt ngã xuống cùng một khung hình đọc ra như một hiệu
             * ứng; ngã lệch nhau thì đọc ra là ba người. Cả ba vẫn nằm gọn
             * trong cùng một cửa sổ va chạm, nên thời lượng cảnh không nhúc
             * nhích - xem `KIND_META.NIGHT_KILL`.
             */
            index={index}
          />
        ))}
        {view.overflow > 0 && (
          /*
           * Người thứ tư trở đi KHÔNG biến mất.
           *
           * Màn 390px chỉ chứa nổi ba khuôn mặt còn nhận ra được, nhưng "chỉ
           * hiện ba" và "chỉ chết ba" là hai câu khác hẳn nhau ở một trò chơi
           * mà cả ván xoay quanh việc đếm xem ai còn lại. Chip này giữ đúng con
           * số, và `killAnnouncement` đọc lại nó thành lời.
           */
          <span className="kill-overflow" data-kill-overflow>
            +{view.overflow}
          </span>
        )}
      </div>

      {/* --- Chữ ------------------------------------------------------------ */}
      {/*
       * HAI phần tử tách hẳn nhau, không phải một phần tử mang cả hai vai.
       *
       * Bản đầu nhét câu đầy đủ vào BÊN TRONG chính thẻ mang `titleId`, nên tên
       * của dialog là nội dung gộp của cả hai và trình đọc màn hình đọc ra một
       * câu lặp: "Không qua khỏi đêm nay. Trời đã sáng. An không qua khỏi đêm
       * nay."
       *
       * Giờ mỗi phần tử một việc: phần nhìn thấy chỉ để nhìn (và vì thế
       * `aria-hidden` - từng chữ của nó đã có trong câu đầy đủ), còn phần mang
       * `titleId` chỉ mang đúng một câu, là thứ DUY NHẤT được đọc lên về cảnh.
       */}
      <div className="kill-caption">
        <p className="kill-eyebrow" aria-hidden="true">
          {killEyebrow(view)}
        </p>
        <p className="kill-title" aria-hidden="true">
          {killTitle(view)}
        </p>
        {/* Gọi đủ tên, kể cả những người bị gộp vào chip đếm - xem
          * `allVictimNames`. Đây là đường tiếp cận duy nhất tới hai cái tên
          * không có chỗ trên màn 390px. */}
        <p id={titleId} className="sr-only">
          {killAnnouncement(view)}
        </p>
      </div>
    </div>
  );
}

function VictimFace({ victim, index }: { victim: KillVictim; index: number }) {
  return (
    <span
      className="kill-victim"
      data-kill-portrait
      // Biến CSS chứ không phải class riêng cho từng vị trí: keyframes dùng
      // chung, chỉ mốc bắt đầu là khác.
      style={{ "--kill-index": index } as React.CSSProperties}
    >
      <span className="kill-face">
        <CharacterPortrait
          // Ảnh tự tải lên là danh tính người chơi tự đặt nên nó luôn thắng;
          // `victim.avatar` là khuôn mặt đã chốt theo bảng của cả phòng.
          avatar={victim.avatarUrl ?? victim.avatar}
          tint={tintFor(victim.playerId)}
          /*
           * `alive` vẫn là TRUE ở đây, và đó là chủ đích.
           *
           * Chân dung phải bước vào cảnh còn nguyên màu, còn thở - rồi mới tắt
           * đi trước mắt người xem. Truyền `alive={false}` là bỏ mất đúng nhịp
           * mà cả cảnh này sinh ra để kể; lúc đó nó chỉ còn là một tấm ảnh xám
           * hiện lên. Việc chuyển sang xám là của CSS, ở đúng khung hình va
           * chạm.
           */
          alive
          breathOffset={breathOffsetFor(victim.playerId)}
          className="h-full w-full"
          isCustom={victim.avatarUrl !== null}
        />
      </span>
      {/* Tên nằm dưới mặt, không nằm trên: mắt bắt khuôn mặt trước, rồi mới
        * đọc xem đó là ai. Cắt ở một dòng - tên tối đa 20 ký tự và khung chỉ
        * rộng 88px, nên không có tên nào vừa. */}
      <span className="kill-name">{victim.name}</span>
    </span>
  );
}
