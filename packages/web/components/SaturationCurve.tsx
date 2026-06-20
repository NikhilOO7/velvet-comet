import type { SaturationPoint } from '@velvet-comet/contracts';

/**
 * The hero visual (PLAN.md §14): new-domains-per-round, flattening to the dry
 * stop. Watching it asymptote to zero *is* the proof we kept going until the
 * source set stopped growing. Hand-built SVG — no chart dependency.
 */
export function SaturationCurve({
  curve,
  saturated,
}: {
  curve: readonly SaturationPoint[];
  saturated: boolean;
}): React.JSX.Element {
  const w = 460;
  const h = 150;
  const pad = { l: 28, r: 12, t: 14, b: 22 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(1, ...curve.map((p) => p.newDomains));
  const n = Math.max(1, curve.length);
  const x = (i: number): number => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number): number => pad.t + innerH - (v / max) * innerH;

  const pts = curve.map((p, i) => ({ cx: x(i), cy: y(p.newDomains), p }));
  const linePath = pts.map((d, i) => `${i === 0 ? 'M' : 'L'}${d.cx},${d.cy}`).join(' ');
  const areaPath =
    pts.length > 0
      ? `${linePath} L${pts[pts.length - 1]?.cx ?? 0},${pad.t + innerH} L${pts[0]?.cx ?? 0},${pad.t + innerH} Z`
      : '';

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Saturation curve">
        <defs>
          <linearGradient id="sat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((t) => (
          <line
            key={t}
            x1={pad.l}
            x2={w - pad.r}
            y1={pad.t + innerH * t}
            y2={pad.t + innerH * t}
            stroke="#2a2a3c"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        ))}
        {areaPath ? <path d={areaPath} fill="url(#sat)" /> : null}
        {linePath ? <path d={linePath} fill="none" stroke="#22d3ee" strokeWidth={2} /> : null}
        {pts.map((d, i) => (
          <g key={i}>
            <circle cx={d.cx} cy={d.cy} r={d.p.newDomains === 0 ? 4 : 3} fill={d.p.newDomains === 0 ? '#34d399' : '#22d3ee'} />
            <text x={d.cx} y={d.cy - 8} textAnchor="middle" className="fill-muted" fontSize="9">
              {d.p.newDomains}
            </text>
            <text x={d.cx} y={h - 6} textAnchor="middle" className="fill-faint" fontSize="9">
              r{d.p.round}
            </text>
          </g>
        ))}
      </svg>
      <p className="mt-1 text-[11px] text-faint">
        new domains per round → {saturated ? <span className="text-success">reached 0 (dry)</span> : 'still climbing'}
      </p>
    </div>
  );
}
