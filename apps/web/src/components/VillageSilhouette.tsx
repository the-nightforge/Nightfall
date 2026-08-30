/**
 * Bóng ngôi làng, vẽ bằng tay trong SVG.
 *
 * Dùng chung cho hero trang chủ và cho hai cảnh NIGHTFALL / DAWN. Là SVG nội bộ
 * chứ không phải ảnh: nó phải đổi màu theo cảnh (đêm thì gần như đen, rạng đông
 * thì viền cam), và một file ảnh thì phải có hai bản. Cũng không phải asset tải
 * về, nên không có câu hỏi bản quyền nào cả.
 *
 * `meet` chứ không phải `slice`, và bám mép dưới: khung 800x200 rất bẹt, còn ô
 * chứa nó trên màn dọc thì gần vuông - `slice` phóng to gấp đôi và cắt cả làng
 * xuống còn đúng một mái nhà. `meet` giữ trọn dãy nhà thành một dải thấp đứng
 * trên mặt đất, đúng nghĩa một đường chân trời.
 */
export function VillageSilhouette({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 800 200"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
      className={className}
    >
      {/* Rặng cây phía sau, thấp và mờ hơn để có chiều sâu. */}
      <g opacity="0.55">
        <path d="M0 200V150l18-30 16 30 14-22 15 22 20-34 18 34 22-26 20 26 26-40 24 40h-233z" />
        <path d="M560 200v-46l20-32 18 32 16-24 18 24 22-36 20 36 26-28 24 28 26-44 24 44v46H560z" />
      </g>
      {/* Mái nhà, ống khói, hàng rào. Tỷ lệ cố ý lệch nhau: bốn nóc bằng nhau
        * trông ra một khu quy hoạch chứ không ra một ngôi làng. */}
      <path d="M0 200v-28h84l46-44 46 44h40v-52l52-40 52 40v16h34l40-38 40 38h30v34h72l40-30 40 30h84v30H0z" />
      <rect x="196" y="86" width="14" height="30" />
      <rect x="612" y="150" width="12" height="24" />
      {/* Hàng rào thưa ở tiền cảnh. */}
      <g opacity="0.8">
        {[10, 34, 58, 82, 106, 690, 714, 738, 762, 786].map((x) => (
          <rect key={x} x={x} y="182" width="6" height="18" />
        ))}
      </g>
    </svg>
  );
}
