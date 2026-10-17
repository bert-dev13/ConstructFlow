'use client';

import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_DATA, CURRENT_PERIOD } from '../data/mockData';

export function ProgressChart() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-text">Progress Overview</h3>
          <p className="mt-1 text-sm text-text-muted">
            Planned vs actual progress based on project schedules and weekly
            reports.
          </p>
        </div>
        <span className="rounded-full border border-border bg-surface-muted px-3 py-1 text-xs font-medium text-text-muted">
          {CURRENT_PERIOD}
        </span>
      </div>

      <div className="h-64 w-full">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={CHART_DATA} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e0dfd8" strokeDasharray="4 4" vertical={false} />
              <XAxis
                dataKey="week"
                tick={{ fill: '#6b6b66', fontSize: 12 }}
                axisLine={{ stroke: '#e0dfd8' }}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tick={{ fill: '#6b6b66', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid #e0dfd8',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                }}
                formatter={(value, name) => [
                  value != null ? String(value) : '—',
                  name === 'planned' ? 'Planned' : 'Actual',
                ]}
              />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                formatter={(value) => (
                  <span className="text-sm text-text-muted">
                    {value === 'planned' ? 'Planned' : 'Actual'}
                  </span>
                )}
              />
              <Line
                type="monotone"
                dataKey="planned"
                stroke="#2563eb"
                strokeWidth={2}
                dot={{ r: 4, fill: '#fff', stroke: '#2563eb', strokeWidth: 2 }}
                connectNulls
                name="planned"
              />
              <Line
                type="monotone"
                dataKey="actual"
                stroke="#4a6353"
                strokeWidth={2.5}
                dot={{ r: 5, fill: '#4a6353' }}
                connectNulls
                name="actual"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            Loading chart…
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-text-muted">
        Planned uses baseline activity duration; actual uses the latest saved
        weekly progress percent.
      </p>
    </div>
  );
}
