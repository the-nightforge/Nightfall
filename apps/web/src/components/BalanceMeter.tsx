"use client";

interface Props {
  score: number;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function BalanceMeter({ score }: Props) {
  const clamped = clamp(Math.round(score * 10) / 10, 0, 100);
  let label: string;
  let labelClass: string;
  if (clamped >= 45 && clamped <= 55) {
    label = "Cân bằng";
    labelClass = "text-emerald-300";
  } else if (clamped > 55) {
    label = "Phe Dân áp đảo";
    labelClass = "text-sky-300";
  } else {
    label = "Phe Sói áp đảo";
    labelClass = "text-blood-400";
  }

  // Position needle; keep within bounds visually (0.5% inset to avoid overflow)
  const needleLeft = `${clamped}%`;

  return (
    <div className="mb-4" data-testid="balance-meter">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-mist/65">
          Cân bằng
        </span>
        <span className={`text-xs font-bold ${labelClass}`} data-testid="balance-label">
          {label} &middot; {clamped}
        </span>
      </div>
      {/* Track */}
      <div className="relative h-3 overflow-hidden rounded-full border border-white/10 bg-night-800">
        {/* Gradient: red (wolves) -> emerald (balanced) -> blue (village) */}
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(90deg, #dc2640 0%, #f87171 18%, #34d399 50%, #60a5fa 82%, #2563eb 100%)",
          }}
          aria-hidden="true"
        />
        {/* Tick at centre */}
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/30" aria-hidden="true" />
        {/* Needle */}
        <div
          className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)] motion-reduce:transition-none"
          style={{ left: needleLeft }}
          data-testid="balance-needle"
          role="slider"
          tabIndex={0}
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Cân bằng ${label} ${clamped} trên 100`}
        >
          <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-white" aria-hidden="true" />
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-mist/60">
        <span>0 Sói mạnh</span>
        <span>50</span>
        <span>Dân mạnh 100</span>
      </div>
    </div>
  );
}
