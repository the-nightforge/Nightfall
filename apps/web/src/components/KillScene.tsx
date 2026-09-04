"use client";

import { assignAvatars, breathOffsetFor, tintFor } from "@/lib/avatar";
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
   * Bảng ảnh dựng từ CHÍNH những người lên hình, không phải từ cả phòng.
   *
   * `assignAvatars` tránh trùng trong phạm vi tập id nó nhận, nên tập nhỏ hơn
   * có thể cho ra kết quả khác với lưới người chơi. Đổi lại là cảnh này không
   * cần `players[]` - tức là nó không có đường nào chạm vào `role` của ai.
   * Người đã tự tải ảnh lên thì dùng đúng ảnh đó và không đi qua bảng này.
   */
  const avatars = assignAvatars(view.victims.map((victim) => victim.playerId));

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
            avatar={avatars[victim.playerId]}
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
      <div className="kill-caption">
        <p className="kill-eyebrow">{killEyebrow(view)}</p>
        <p id={titleId} className="kill-title">
          {killTitle(view)}
          {/*
           * Câu đầy đủ chỉ dành cho trình đọc màn hình.
           *
           * Lớp phủ trỏ `aria-labelledby` vào đúng phần tử này, nên đây là thứ
           * DUY NHẤT được đọc lên về cảnh. Dòng nhìn thấy được cố tình ngắn và
           * không mang tên (tên đã nằm dưới từng khuôn mặt); dòng này thì phải
           * gọi đủ tên, kể cả những người bị gộp vào chip đếm.
           */}
          <span className="sr-only">{killAnnouncement(view)}</span>
        </p>
      </div>
    </div>
  );
}

function VictimFace({
  victim,
  avatar,
  index,
}: {
  victim: KillVictim;
  avatar: string;
  index: number;
}) {
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
          avatar={victim.avatarUrl ?? avatar}
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
