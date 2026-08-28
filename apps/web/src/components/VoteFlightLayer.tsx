"use client";

import { m } from "motion/react";

export interface Point {
  x: number;
  y: number;
}

export interface VoteFlightSpec {
  id: number;
  /** Toạ độ tính theo lưới, không theo viewport: lưới cuộn thì phiếu cuộn theo. */
  from: Point;
  to: Point;
}

/** Bay xong ở đây thì vòng va chạm mới nở. Giữ hai số này ăn khớp nhau. */
const TRAVEL_S = 0.42;

/**
 * Lớp phủ vẽ những lá phiếu đang bay tới ghế của chúng.
 *
 * Nằm ngoài luồng layout và pointer-events:none, nên nó không bao giờ chen vào
 * lưới ghế bên dưới - lưới đó vẫn là nút bấm bình thường trong lúc phiếu bay.
 *
 * Chỉ animate transform và opacity. Lưới này có tới 15 ô và mỗi lá phiếu là
 * một lần render lại, animate left/top hay width ở đây là chỗ rớt frame đầu
 * tiên trên điện thoại tầm trung.
 */
export function VoteFlightLayer({
  flights,
  onLanded,
}: {
  flights: VoteFlightSpec[];
  onLanded: (id: number) => void;
}) {
  return (
    // overflow để mở: phiếu ẩn danh rơi từ phía trên ghế, với hàng đầu tiên thì
    // điểm xuất phát nằm ngoài khung lưới.
    <div className="pointer-events-none absolute inset-0 z-20 overflow-visible" aria-hidden>
      {flights.map((flight) => (
        <div key={flight.id}>
          <m.div
            className="absolute left-0 top-0"
            initial={{ x: flight.from.x, y: flight.from.y, opacity: 0, scale: 0.45 }}
            animate={{
              x: flight.to.x,
              y: flight.to.y,
              opacity: [0, 1, 1, 0],
              scale: [0.45, 1, 1, 0.72],
            }}
            transition={{
              // Vào nhanh, hãm dần ở cuối: lá phiếu phải có cảm giác được ném
              // tới chỗ nào đó, không phải trôi đều từ A sang B.
              x: { duration: TRAVEL_S, ease: [0.24, 0.86, 0.32, 1] },
              y: { duration: TRAVEL_S, ease: [0.24, 0.86, 0.32, 1] },
              opacity: { duration: TRAVEL_S + 0.16, times: [0, 0.2, 0.72, 1] },
              scale: { duration: TRAVEL_S + 0.16, times: [0, 0.3, 0.72, 1] },
            }}
          >
            <Ballot />
          </m.div>

          <m.span
            className="absolute block h-11 w-11 rounded-full ring-2 ring-blood-500/70"
            style={{ left: flight.to.x, top: flight.to.y, marginLeft: -22, marginTop: -22 }}
            initial={{ opacity: 0, scale: 0.55 }}
            animate={{ opacity: [0.85, 0], scale: [0.55, 1.35] }}
            transition={{ delay: TRAVEL_S - 0.04, duration: 0.34, ease: "easeOut" }}
            onAnimationComplete={() => onLanded(flight.id)}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Mảnh giấy nhỏ nghiêng một chút. Cố ý KHÔNG dùng lại hình tròn đỏ của huy hiệu
 * số phiếu: huy hiệu nói "ô này đang có bao nhiêu phiếu", còn cái này nói "vừa
 * có thêm một lá" - hai chuyện khác nhau thì không nên trông giống nhau.
 */
function Ballot() {
  return (
    <span className="block -translate-x-1/2 -translate-y-1/2">
      <span className="block h-[19px] w-[15px] -rotate-6 rounded-[3px] bg-mist shadow-lg shadow-black/70 ring-1 ring-white/60">
        <span className="mx-auto mt-[5px] block h-[2px] w-[9px] rounded-full bg-blood-600" />
        <span className="mx-auto mt-[3px] block h-[2px] w-[6px] rounded-full bg-blood-600/60" />
      </span>
    </span>
  );
}
