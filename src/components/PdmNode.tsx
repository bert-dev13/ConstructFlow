'use client';

import type { PdmActivity } from '../types';
import { PDM_START_NODE_H, PDM_START_NODE_W, PDM_END_NODE_H, PDM_END_NODE_W } from '../lib/pdmLayout';

export const PDM_NODE_W = 128;
export const PDM_NODE_H = 96;
export const PDM_NODE_HALF_W = PDM_NODE_W / 2;
export const PDM_NODE_HALF_H = PDM_NODE_H / 2;

interface PdmNodeProps {
  activity: PdmActivity;
  x: number;
  y: number;
  onMainCriticalPath?: boolean;
}

export function PdmNode({ activity, x, y, onMainCriticalPath = false }: PdmNodeProps) {
  const w = PDM_NODE_W;
  const h = PDM_NODE_H;
  const row1 = 28;
  const row2 = 32;
  const displayName = activity.name?.trim() || `Activity ${activity.number}`;

  return (
    <g transform={`translate(${x - w / 2}, ${y - h / 2})`}>
      <title>
        {displayName}
        {activity.extendToEnd ? ' (until project end)' : ''}
      </title>
      <rect
        width={w}
        height={h}
        rx={4}
        fill={onMainCriticalPath ? '#fef2f2' : activity.extendToEnd ? '#f8faf8' : '#fff'}
        stroke={onMainCriticalPath ? '#dc2626' : activity.extendToEnd ? '#6b7c72' : '#4a6353'}
        strokeWidth={onMainCriticalPath ? 2.75 : 1.5}
        strokeDasharray={activity.extendToEnd && !onMainCriticalPath ? '4 3' : undefined}
      />

      {/* Top — ES / No. / EF */}
      <line x1={0} y1={row1} x2={w} y2={row1} stroke="#e0dfd8" />
      <line x1={w / 3} y1={0} x2={w / 3} y2={row1} stroke="#e0dfd8" />
      <line x1={(w * 2) / 3} y1={0} x2={(w * 2) / 3} y2={row1} stroke="#e0dfd8" />
      <text x={w / 6} y={10} textAnchor="middle" className="fill-text-muted text-[7px]">
        ES
      </text>
      <text x={w / 2} y={10} textAnchor="middle" className="fill-text-muted text-[7px]">
        No.
      </text>
      <text x={(w * 5) / 6} y={10} textAnchor="middle" className="fill-text-muted text-[7px]">
        EF
      </text>
      <text x={w / 6} y={22} textAnchor="middle" className="fill-text text-[10px] font-semibold">
        {activity.es == null ? '—' : activity.es}
      </text>
      <text x={w / 2} y={22} textAnchor="middle" className="fill-text text-[11px] font-bold">
        {activity.number}
      </text>
      <text x={(w * 5) / 6} y={22} textAnchor="middle" className="fill-text text-[10px] font-semibold">
        {activity.ef ?? '—'}
      </text>

      {/* Middle — Activity */}
      <line x1={0} y1={row1 + row2} x2={w} y2={row1 + row2} stroke="#e0dfd8" />
      <text
        x={w / 2}
        y={row1 + row2 / 2 + 4}
        textAnchor="middle"
        className="fill-text text-[9px] font-medium"
      >
        {displayName.length > 18 ? `${displayName.slice(0, 17)}…` : displayName}
      </text>

      {/* Bottom — LS / D / LF */}
      <line x1={w / 3} y1={row1 + row2} x2={w / 3} y2={h} stroke="#e0dfd8" />
      <line x1={(w * 2) / 3} y1={row1 + row2} x2={(w * 2) / 3} y2={h} stroke="#e0dfd8" />
      <text x={w / 6} y={row1 + row2 + 11} textAnchor="middle" className="fill-text-muted text-[7px]">
        LS
      </text>
      <text x={w / 2} y={row1 + row2 + 11} textAnchor="middle" className="fill-text-muted text-[7px]">
        D
      </text>
      <text x={(w * 5) / 6} y={row1 + row2 + 11} textAnchor="middle" className="fill-text-muted text-[7px]">
        LF
      </text>
      <text x={w / 6} y={h - 6} textAnchor="middle" className="fill-text text-[10px] font-semibold">
        {activity.ls == null ? '—' : activity.ls}
      </text>
      <text x={w / 2} y={h - 6} textAnchor="middle" className="fill-text text-[10px] font-semibold">
        {activity.duration}
      </text>
      <text x={(w * 5) / 6} y={h - 6} textAnchor="middle" className="fill-text text-[10px] font-semibold">
        {activity.lf ?? '—'}
      </text>
    </g>
  );
}

interface PdmStartNodeProps {
  x: number;
  y: number;
}

/** Project day 0 — first column before parallel start activities. */
export function PdmStartNode({ x, y }: PdmStartNodeProps) {
  const w = PDM_START_NODE_W;
  const h = PDM_START_NODE_H;
  return (
    <g transform={`translate(${x - w / 2}, ${y - h / 2})`}>
      <rect
        width={w}
        height={h}
        rx={4}
        fill="#fff"
        stroke="#2c2c2a"
        strokeWidth={2}
      />
      <text
        x={w / 2}
        y={h / 2 + 4}
        textAnchor="middle"
        className="fill-text text-[11px] font-semibold lowercase"
      >
        start
      </text>
    </g>
  );
}

/** Project finish — mirror of start (terminal activities → bus → end box). */
export function PdmEndNode({ x, y }: PdmStartNodeProps) {
  const w = PDM_END_NODE_W;
  const h = PDM_END_NODE_H;
  return (
    <g transform={`translate(${x - w / 2}, ${y - h / 2})`}>
      <rect
        width={w}
        height={h}
        rx={4}
        fill="#fff"
        stroke="#2c2c2a"
        strokeWidth={2}
      />
      <text
        x={w / 2}
        y={h / 2 + 4}
        textAnchor="middle"
        className="fill-text text-[11px] font-semibold lowercase"
      >
        end
      </text>
    </g>
  );
}
