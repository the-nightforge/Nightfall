import type { NightRecap } from "@masoi/shared";
import { cursedTurnedText } from "@/lib/cursed";

const causeLabel = (cause: "wolf" | "poison") =>
  cause === "wolf" ? "bị Sói cắn" : "trúng độc của Phù Thủy";

export function NightRecapTimeline({ nights }: { nights: NightRecap[] }) {
  return (
    <div className="card">
      <h3 className="mb-3 font-semibold text-white">Diễn biến các đêm</h3>
      {nights.length === 0 ? (
        <p className="text-sm text-mist/60">
          Ván đấu kết thúc trước khi có diễn biến ban đêm.
        </p>
      ) : (
        <div className="space-y-3">
          {nights.map((night) => (
            <section key={night.round} className="rounded-lg bg-night-800 px-3 py-3 text-sm">
              <h4 className="mb-2 font-bold text-mist">Đêm {night.round}</h4>
              <ul className="space-y-1 text-mist/80">
                <li>
                  🐺 {night.wolfTarget ? `Sói chọn cắn ${night.wolfTarget.name}.` : "Sói không chọn được mục tiêu."}
                </li>
                <li>
                  🛡️ {night.guardTarget ? `Bảo Vệ bảo vệ ${night.guardTarget.name}.` : "Bảo Vệ không hành động."}
                </li>
                {night.seerChecks.length > 0 ? (
                  night.seerChecks.map((check) => (
                    <li key={`${check.seer.id}-${check.target.id}`}>
                      🔮 Tiên Tri {check.seer.name} soi {check.target.name}: {check.isWolf ? "Ma Sói" : "Không phải Ma Sói"}.
                    </li>
                  ))
                ) : (
                  <li>🔮 Tiên Tri không hành động.</li>
                )}
                <li>
                  🧪 {night.witch.usedHeal
                    ? night.witch.healedTarget
                      ? `Phù Thủy dùng bình cứu cho ${night.witch.healedTarget.name}.`
                      : "Phù Thủy đã dùng bình cứu nhưng không có nạn nhân để cứu."
                    : "Phù Thủy không dùng bình cứu."}
                </li>
                <li>
                  ☠️ {night.witch.poisonTarget
                    ? `Phù Thủy đầu độc ${night.witch.poisonTarget.name}.`
                    : "Phù Thủy không dùng bình độc."}
                </li>
                {(() => {
                  const turned = cursedTurnedText(night);
                  return turned ? <li>🩸 {turned}</li> : null;
                })()}
              </ul>
              <p className={`mt-2 font-semibold ${night.deaths.length > 0 ? "text-blood-400" : "text-emerald-300"}`}>
                {night.deaths.length > 0
                  ? `Kết quả: ${night.deaths.map(({ player, cause }) => `${player.name} (${causeLabel(cause)})`).join(", ")}.`
                  : "Kết quả: Không ai chết trong đêm này."}
              </p>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
