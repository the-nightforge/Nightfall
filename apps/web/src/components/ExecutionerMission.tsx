"use client";

import { ROLE_META, type RoomSnapshot } from "@masoi/shared";

/**
 * Khu nhiệm vụ RIÊNG của Kẻ Báo Thù.
 *
 * Không tự lọc gì cả, và đó là chủ đích: `snapshot.executioner` chỉ khác `null`
 * trong snapshot của đúng chủ nhân nó (engine gác ở `executionerViewFor`), nên
 * component này chỉ cần hỏi "có nhiệm vụ không". Một tầng lọc thứ hai ở đây sẽ
 * tạo ra ảo giác an toàn: nếu dữ liệu đã lên tới trình duyệt thì bất kỳ ai mở
 * devtools cũng đọc được, bất kể React vẽ ra sao.
 *
 * Ba trạng thái, ba câu khác nhau - vì đó là ba tình thế khác nhau của người
 * chơi, không phải ba cách tô màu:
 *
 *  - **Đang săn**: một cái tên và đúng một việc phải làm.
 *  - **Đã xong**: thành tích đã ghi và KHÔNG mất đi nữa, kể cả khi họ chết sau
 *    đó hoặc ván kết thúc hoà. Câu chữ phải nói được điều đó, vì nếu không thì
 *    người vừa thắng sẽ ngồi lo suốt phần còn lại của ván.
 *  - **Đã hoá Thằng Hề**: mục tiêu chết bởi một nguồn khác. Thẻ vai bên cạnh đã
 *    đổi sang Thằng Hề rồi, nên việc của khối này là giải thích VÌ SAO nó đổi -
 *    thiếu câu đó thì người chơi chỉ thấy vai mình tự nhiên khác đi.
 */
export function ExecutionerMission({ snapshot }: { snapshot: RoomSnapshot | null }) {
  const mission = snapshot?.executioner;
  if (!snapshot || !mission) return null;
  // Ván đã lật bài: màn kết thúc nói đủ, và một thẻ nhiệm vụ ở đó chỉ lặp lại.
  if (snapshot.phase === "GAME_OVER") return null;

  const targetName = mission.target?.name ?? "một người không còn trong danh sách";

  if (mission.turnedJester) {
    return (
      <Frame tone="amber" title={`Nhiệm vụ đã đổ vỡ - bạn là ${ROLE_META.JESTER.name}`}>
        <p>
          <b className="text-white">{targetName}</b> đã chết, nhưng không phải trên giá treo cổ. Bạn
          mất mục tiêu và không được cấp mục tiêu mới.
        </p>
        <p className="mt-1">
          Từ giờ bạn chơi theo luật của {ROLE_META.JESTER.name}: bạn chỉ thắng khi CHÍNH BẠN bị
          làng treo cổ.
        </p>
      </Frame>
    );
  }

  if (mission.won) {
    return (
      <Frame tone="emerald" title="Nhiệm vụ hoàn thành">
        <p>
          <b className="text-white">{targetName}</b> đã bị treo cổ trong lúc bạn còn sống. Thắng lợi
          cá nhân của bạn đã được ghi nhận.
        </p>
        <p className="mt-1">
          Nó KHÔNG mất đi nữa - kể cả khi bạn chết sau đó, hay ván kết thúc hoà.
        </p>
      </Frame>
    );
  }

  return (
    <Frame tone="amber" title={`Mục tiêu của ${ROLE_META.EXECUTIONER.name}`}>
      <p>
        <b className="text-white">{targetName}</b> phải bị làng{" "}
        <b className="text-amber-200">treo cổ</b>, và bạn phải còn sống vào lúc đó.
        {mission.target && !mission.target.alive && (
          <>
            {" "}
            <span className="text-blood-300">Người này đã chết.</span>
          </>
        )}
      </p>
      <p className="mt-1">
        Không cần chính bạn đề cử hay bỏ phiếu kết tội - chỉ cần bản án được tuyên. Mục tiêu không
        đổi cả ván, kể cả khi họ đổi phe.
      </p>
      <p className="mt-1 text-amber-200/70">
        Chỉ mình bạn thấy khối này. Nói tên mục tiêu ra là tự khai mình cầm lá gì.
      </p>
    </Frame>
  );
}

function Frame({
  tone,
  title,
  children,
}: {
  tone: "amber" | "emerald";
  title: string;
  children: React.ReactNode;
}) {
  const skin =
    tone === "emerald"
      ? "border-emerald-600/45 bg-emerald-950/25 text-emerald-100/90"
      : "border-amber-600/45 bg-amber-950/25 text-amber-100/90";
  return (
    <div className={`rounded-xl border px-3.5 py-3 text-sm ${skin}`}>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.22em] opacity-80">
        <span aria-hidden="true">🔒</span> {title}
      </p>
      {children}
    </div>
  );
}
