// Minimal SVG charts: weekly bars and a progress line. Tap a mark to read its value.
import { useState } from 'react';

interface Point { x: number; y: number; label: string; tip: string }

function ticks(max: number) {
  if (max <= 0) return [0];
  const step = 10 ** Math.floor(Math.log10(max));
  const nice = [1, 2, 2.5, 5, 10].map(m => m * step).find(s => max / s <= 4) ?? step * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + nice * 0.001; v += nice) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + nice);
  return out;
}

const H = 170, PADL = 40, PADB = 22, PADT = 10, W = 340;

/** `fmt` labels the axis; `readFmt` (defaults to `fmt`) formats the value read-out above the chart. */
export function BarChart({ data, fmt, readFmt = fmt }: { data: Point[]; fmt: (v: number) => string; readFmt?: (v: number) => string }) {
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(...data.map(d => d.y), 0);
  const tk = ticks(max), top = tk[tk.length - 1] || 1;
  const bw = (W - PADL) / data.length;
  const yOf = (v: number) => PADT + (H - PADT - PADB) * (1 - v / top);
  const shown = sel ?? data.length - 1;
  return (
    <div className="chart">
      <div className="chart-read">
        <b>{readFmt(data[shown]?.y ?? 0)}</b> <span>{data[shown]?.tip}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weekly chart">
        {tk.map(t => (
          <g key={t}>
            <line x1={PADL} x2={W} y1={yOf(t)} y2={yOf(t)} className="grid" />
            <text x={PADL - 6} y={yOf(t) + 4} textAnchor="end" className="axis">{fmt(t)}</text>
          </g>
        ))}
        {data.map((d, i) => (
          <g key={i} onClick={() => setSel(i)}>
            <rect x={PADL + i * bw} y={PADT} width={bw} height={H - PADT - PADB} fill="transparent" />
            <rect x={PADL + i * bw + bw * 0.18} y={yOf(d.y)} width={bw * 0.64} height={Math.max(0, H - PADB - yOf(d.y))}
              rx={3} className={i === shown ? 'bar on' : 'bar'} />
            {(i % Math.ceil(data.length / 6) === 0) && (
              <text x={PADL + i * bw + bw / 2} y={H - 6} textAnchor="middle" className="axis">{d.label}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

/**
 * Progress line on a real time axis (x = unix seconds). An optional `projection` is drawn dashed after the
 * last point, so the expected (slowing) future shows next to the real history.
 */
export function LineChart({ data, fmt, projection }: { data: Point[]; fmt: (v: number) => string; projection?: { x: number; y: number }[] }) {
  const [sel, setSel] = useState<number | null>(null);
  if (data.length === 0) return null;
  const proj = projection ?? [];
  const ys = [...data.map(d => d.y), ...proj.map(p => p.y)];
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = (hi - lo) * 0.1 || hi * 0.1 || 1;
  const min = Math.max(0, lo - pad), max = hi + pad;
  const x0 = data[0].x, x1 = Math.max(data[data.length - 1].x, ...proj.map(p => p.x));
  const span = x1 - x0 || 1;
  const xOf = (x: number) => PADL + 6 + (data.length === 1 && !proj.length ? (W - PADL - 12) / 2 : ((x - x0) / span) * (W - PADL - 12));
  const yOf = (v: number) => PADT + (H - PADT - PADB) * (1 - (v - min) / (max - min));
  const tk = [min, (min + max) / 2, max];
  const shown = Math.min(sel ?? data.length - 1, data.length - 1);
  const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.x).toFixed(1)},${yOf(p.y).toFixed(1)}`).join('');
  const endLabel = proj.length
    ? new Date(proj[proj.length - 1].x * 1000).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
    : data[data.length - 1].label;
  return (
    <div className="chart">
      <div className="chart-read"><b>{fmt(data[shown].y)}</b> <span>{data[shown].tip}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Progress chart"
        onClick={e => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          data.forEach((p, i) => { if (Math.abs(xOf(p.x) - x) < Math.abs(xOf(data[best].x) - x)) best = i; });
          setSel(best);
        }}>
        {tk.map((t, i) => (
          <g key={i}>
            <line x1={PADL} x2={W} y1={yOf(t)} y2={yOf(t)} className="grid" />
            <text x={PADL - 6} y={yOf(t) + 4} textAnchor="end" className="axis">{fmt(t)}</text>
          </g>
        ))}
        {proj.length > 0 && <line x1={xOf(proj[0].x)} x2={xOf(proj[0].x)} y1={PADT} y2={H - PADB} className="now-line" />}
        <path d={path(data)} className="line" />
        {proj.length > 1 && <path d={path(proj)} className="proj" />}
        {data.length < 60 && data.map((p, i) => <circle key={i} cx={xOf(p.x)} cy={yOf(p.y)} r={2.5} className="dot" />)}
        <circle cx={xOf(data[shown].x)} cy={yOf(data[shown].y)} r={5} className="dot on" />
        <text x={PADL + 6} y={H - 6} className="axis">{data[0].label}</text>
        <text x={W - 6} y={H - 6} textAnchor="end" className="axis">{endLabel}</text>
      </svg>
    </div>
  );
}
