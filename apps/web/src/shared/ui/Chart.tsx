'use client';
import { useId, useState, type ReactNode } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Table } from 'lucide-react';

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  unit: string;
  dashed?: boolean;
}

export interface ChartPoint {
  /** epoch ms */
  t: number;
  /** label shown in tables/tooltips ("24/10 • 08:15") */
  label: string;
  [key: string]: number | string | null;
}

const DAY = 86_400_000;

/**
 * Time-based line chart. Points are plotted at their real instants (no zero fill);
 * a single record shows as a single dot. Always paired with an accessible values table.
 */
export function TimeLineChart({
  title,
  points,
  series,
  formatValue,
  height = 220,
  emptyText = 'Sem registros neste período.',
  tickFormat,
}: {
  title: string;
  points: ChartPoint[];
  series: ChartSeries[];
  formatValue: (v: number, s: ChartSeries) => string;
  height?: number;
  emptyText?: string;
  tickFormat: (t: number) => string;
}) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  if (points.length === 0) {
    return <p className="rounded-field bg-surface-muted px-4 py-6 text-center text-sm text-ink-muted">{emptyText}</p>;
  }
  const ts = points.map((p) => p.t);
  const min = Math.min(...ts);
  const max = Math.max(...ts);
  const domain: [number, number] = min === max ? [min - DAY, max + DAY] : [min, max];
  const single = points.length === 1;

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="sr-only">{title}</figcaption>
      <div aria-hidden style={{ height }} className="w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="#ebe6df" strokeDasharray="4 4" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={domain}
              tickFormatter={tickFormat}
              tick={{ fontSize: 11, fill: '#574239' }}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fontSize: 11, fill: '#574239' }}
              tickLine={false}
              axisLine={false}
              width={44}
              allowDecimals
            />
            <Tooltip
              labelFormatter={(_, payload) => (payload?.[0]?.payload as ChartPoint | undefined)?.label ?? ''}
              formatter={(value, name) => {
                const s = series.find((x) => x.key === name || x.label === name);
                return [s ? formatValue(Number(value), s) : String(value), s?.label ?? String(name)];
              }}
              contentStyle={{ borderRadius: 12, border: '1px solid #ebe6df', fontSize: 13 }}
            />
            {series.length > 1 && <Legend verticalAlign="top" height={28} iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2.5}
                strokeDasharray={s.dashed ? '6 4' : undefined}
                dot={{ r: single ? 5 : 3, fill: '#fff', stroke: s.color, strokeWidth: 2 }}
                activeDot={{ r: 6 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-4 text-xs text-ink-muted" aria-label="Legenda">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-1 w-5 rounded-full" style={{ background: s.color }} />
              {s.label} ({s.unit})
            </li>
          ))}
        </ul>
      )}
      <div>
        <button
          type="button"
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable((v) => !v)}
          className="inline-flex min-h-11 items-center gap-2 rounded-[12px] px-2 text-sm font-semibold text-brand-teal-ink hover:bg-brand-teal-wash"
        >
          <Table aria-hidden className="size-4" />
          {showTable ? 'Ocultar valores' : 'Ver valores'}
        </button>
        <div id={tableId} hidden={!showTable} className="mt-2 max-h-72 overflow-auto rounded-field border border-line">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Valores de {title}</caption>
            <thead className="sticky top-0 bg-surface-muted text-xs text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Data
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="px-3 py-2 font-semibold">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {[...points].reverse().map((p, i) => (
                <tr key={`${p.t}-${i}`} className="border-t border-line">
                  <th scope="row" className="px-3 py-2 font-medium">
                    {p.label}
                  </th>
                  {series.map((s) => (
                    <td key={s.key} className="px-3 py-2">
                      {p[s.key] == null ? '—' : formatValue(Number(p[s.key]), s)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </figure>
  );
}

/** Tiny sparkline (decorative; the card shows the value in text). */
export function Sparkline({ values, color = '#069494', label }: { values: number[]; color?: string; label?: ReactNode }) {
  if (values.length === 0) return null;
  const w = 120;
  const h = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - 6) + 3;
    const y = h - 4 - ((v - min) / span) * (h - 8);
    return [x, y] as const;
  });
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1]!;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
        {values.length > 1 && <path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />}
        <circle cx={last[0]} cy={last[1]} r={3.5} fill={color} />
      </svg>
      {label && <span className="text-[11px] text-ink-muted">{label}</span>}
    </div>
  );
}
