import type { HunterShotRecap } from "@masoi/shared";

export function HunterShotTimeline({ shots }: { shots: HunterShotRecap[] }) {
  if (shots.length === 0) return null;

  return (
    <div className="card">
      <h3 className="mb-3 font-semibold text-white">Phản kích của Thợ Săn</h3>
      <ul className="space-y-2 text-sm text-mist/80">
        {shots.map((shot, index) => (
          <li
            key={`${shot.round}-${shot.hunter.id}-${index}`}
            className="rounded-lg bg-night-800 px-3 py-2"
          >
            🔫 {shot.target
              ? `${shot.hunter.name} đã bắn ${shot.target.name}.`
              : `${shot.hunter.name} đã không bắn ai.`}
          </li>
        ))}
      </ul>
    </div>
  );
}
