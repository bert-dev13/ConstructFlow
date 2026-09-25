'use client';

import type { CSSProperties } from 'react';
import type { PdmActivity } from '../types';
import { PDM_START_NODE_H, PDM_START_NODE_W, PDM_END_NODE_H, PDM_END_NODE_W } from '../lib/pdmLayout';

/** Keep in sync with `PDM_ACTIVITY_HALF_W` in pdmLayout.ts */
export const PDM_NODE_W = 152;
export const PDM_NODE_H = 114;
export const PDM_NODE_HALF_W = PDM_NODE_W / 2;
export const PDM_NODE_HALF_H = PDM_NODE_H / 2;

const FILL_TEXT = '#0f1c2e';
const FILL_MUTED = '#5a6b7d';

function fitCellText(value: string, maxChars: number): string {
  const text = value.trim() || '—';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

/** Split a long activity name into up to two centered lines. */
function wrapName(name: string, maxPerLine = 16): [string, string | null] {
  const text = name.trim() || 'Untitled';
  if (text.length <= maxPerLine) return [text, null];
  const words = text.split(/\s+/);
  if (words.length === 1) {
    return [fitCellText(text, maxPerLine), null];
  }
  let line1 = '';
  let i = 0;
  while (i < words.length) {
    const next = line1 ? `${line1} ${words[i]}` : words[i]!;
    if (next.length > maxPerLine && line1) break;
    line1 = next;
    i += 1;
  }
  const rest = words.slice(i).join(' ');
  if (!rest) return [line1, null];
  return [line1, fitCellText(rest, maxPerLine)];
}

interface PdmNodeProps {
  activity: PdmActivity;
  x: number;
  y: number;
  onMainCriticalPath?: boolean;
  style?: CSSProperties;
}

export function PdmNode({ activity, x, y, onMainCriticalPath = false, style }: PdmNodeProps) {
  const w = PDM_NODE_W;
  const h = PDM_NODE_H;
  // Taller top/bottom rows so labels never collide with values (also survives SVG preview/print).
  const row1 = 34;
  const row2 = 40;
  const displayName = activity.name?.trim() || `Activity ${activity.number}`;
  const [nameLine1, nameLine2] = wrapName(displayName, 17);
  const rawNo = String(activity.number ?? '');
  const itemNo = fitCellText(rawNo, 9);
  const noFontSize = rawNo.length > 7 ? 7.5 : rawNo.length > 5 ? 8.5 : 10;
  const clipId = `pdm-clip-${activity.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <g className="pdm-node-in" style={style} transform={`translate(${x - w / 2}, ${y - h / 2})`}>
      <title>
        {activity.number} — {displayName}
        {activity.extendToEnd ? ' (until project end)' : ''}
        {`\nES ${activity.es ?? '—'} · EF ${activity.ef ?? '—'} · LS ${activity.ls ?? '—'} · LF ${activity.lf ?? '—'} · D ${activity.duration}`}
      </title>
      <defs>
        <clipPath id={clipId}>
          <rect x={2} y={2} width={w - 4} height={h - 4} rx={4} />
        </clipPath>
      </defs>
      <rect x={1.5} y={2.5} width={w} height={h} rx={5} fill="rgba(15, 28, 46, 0.06)" />
      <rect
        width={w}
        height={h}
        rx={5}
        fill={onMainCriticalPath ? '#fef2f2' : activity.extendToEnd ? '#f8faf8' : '#fff'}
        stroke={onMainCriticalPath ? '#dc2626' : activity.extendToEnd ? '#6b7c72' : '#0b3a5c'}
        strokeWidth={onMainCriticalPath ? 2.5 : 1.5}
        strokeDasharray={activity.extendToEnd && !onMainCriticalPath ? '4 3' : undefined}
      />

      <g clipPath={`url(#${clipId})`}>
        {/* Top — ES / No. / EF */}
        <line x1={0} y1={row1} x2={w} y2={row1} stroke="#e0dfd8" />
        <line x1={w / 3} y1={0} x2={w / 3} y2={row1} stroke="#e0dfd8" />
        <line x1={(w * 2) / 3} y1={0} x2={(w * 2) / 3} y2={row1} stroke="#e0dfd8" />
        <text
          x={w / 6}
          y={12}
          textAnchor="middle"
          fill={FILL_MUTED}
          fontSize={7}
          fontFamily="system-ui, sans-serif"
        >
          ES
        </text>
        <text
          x={w / 2}
          y={12}
          textAnchor="middle"
          fill={FILL_MUTED}
          fontSize={7}
          fontFamily="system-ui, sans-serif"
        >
          No.
        </text>
        <text
          x={(w * 5) / 6}
          y={12}
          textAnchor="middle"
          fill={FILL_MUTED}
          fontSize={7}
          fontFamily="system-ui, sans-serif"
        >
          EF
        </text>
        <text
          x={w / 6}
          y={26}
          textAnchor="middle"
          fill={FILL_TEXT}
          fontSize={10}
          fontWeight={600}
          fontFamily="system-ui, sans-serif"
        >
          {activity.es == null ? '—' : activity.es}
        </text>
        <text
          x={w / 2}
          y={26}
          textAnchor="middle"
          fill={FILL_TEXT}
          fontSize={noFontSize}
          fontWeight={700}
          fontFamily="system-ui, sans-serif"
        >
          {itemNo}
        </text>
        <text
          x={(w * 5) / 6}
          y={26}
          textAnchor="middle"
          fill={FILL_TEXT}
          fontSize={10}
          fontWeight={600}
          fontFamily="system-ui, sans-serif"
        >
          {activity.ef ?? '—'}
        </text>

        {/* Middle — Activity name (up to 2 lines) */}
        <line x1={0} y1={row1 + row2} x2={w} y2={row1 + row2} stroke="#e0dfd8" />
        {nameLine2 ? (
          <>
            <text
              x={w / 2}
              y={row1 + row2 / 2 - 2}
              textAnchor="middle"
              fill={FILL_TEXT}
              fontSize={8}
              fontWeight={500}
              fontFamily="system-ui, sans-serif"
            >
              {nameLine1}
            </text>
            <text
              x={w / 2}
              y={row1 + row2 / 2 + 10}
              textAnchor="middle"
              fill={FILL_TEXT}
              fontSize={8}
              fontWeight={500}
              fontFamily="system-ui, sans-serif"
            >
              {nameLine2}
            </text>
          </>
        ) : (
          <text
            x={w / 2}
            y={row1 + row2 / 2 + 4}
            textAnchor="middle"
            fill={FILL_TEXT}
            fontSize={9}
            fontWeight={500}
            fontFamily="system-ui, sans-serif"
          >
            {nameLine1}
          </text>
        )}

        {/* Bottom — LS / D / LF */}
        <line x1={w / 3} y1={row1 + row2} x2={w / 3} y2={h} stroke="#e0dfd8" />
        <line x1={(w * 2) / 3} y1={row1 + row2} x2={(w * 2) / 3} y2={h} stroke="#e0dfd8" />
        <text
          x={w / 6}
          y={row1 + row2 + 12}
          textAnchor="middle"
          fill={FILL_MUTED}
          fontSize={7}
          fontFamily="system-ui, sans-serif"
        >
          LS
        </text>
        <text
          x={w / 2}
          y={row1 + row2 + 12}
          textAnchor="middle"
          fill={FILL_MUTED}
          fontSize={7}
          fontFamily="system-ui, sans-serif"
        >
          D
        </text>
        <text
          x={(w * 5) / 6}
          y={row1 + row2 + 12}
          textAnchor="middle"
          fill={FILL_MUTED}
          fontSize={7}
          fontFamily="system-ui, sans-serif"
        >
          LF
        </text>
        <text
          x={w / 6}
          y={h - 8}
          textAnchor="middle"
          fill={FILL_TEXT}
          fontSize={10}
          fontWeight={600}
          fontFamily="system-ui, sans-serif"
        >
          {activity.ls == null ? '—' : activity.ls}
        </text>
        <text
          x={w / 2}
          y={h - 8}
          textAnchor="middle"
          fill={FILL_TEXT}
          fontSize={10}
          fontWeight={600}
          fontFamily="system-ui, sans-serif"
        >
          {activity.duration}
        </text>
        <text
          x={(w * 5) / 6}
          y={h - 8}
          textAnchor="middle"
          fill={FILL_TEXT}
          fontSize={10}
          fontWeight={600}
          fontFamily="system-ui, sans-serif"
        >
          {activity.lf ?? '—'}
        </text>
      </g>
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
    <g className="pdm-node-in" transform={`translate(${x - w / 2}, ${y - h / 2})`}>
      <rect x={1.5} y={2} width={w} height={h} rx={6} fill="rgba(15, 28, 46, 0.06)" />
      <rect width={w} height={h} rx={6} fill="#fff" stroke="#0b3a5c" strokeWidth={2} />
      <text
        x={w / 2}
        y={h / 2 + 4}
        textAnchor="middle"
        fill={FILL_TEXT}
        fontSize={11}
        fontWeight={600}
        fontFamily="system-ui, sans-serif"
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
    <g className="pdm-node-in" transform={`translate(${x - w / 2}, ${y - h / 2})`}>
      <rect x={1.5} y={2} width={w} height={h} rx={6} fill="rgba(15, 28, 46, 0.06)" />
      <rect width={w} height={h} rx={6} fill="#fff" stroke="#0b3a5c" strokeWidth={2} />
      <text
        x={w / 2}
        y={h / 2 + 4}
        textAnchor="middle"
        fill={FILL_TEXT}
        fontSize={11}
        fontWeight={600}
        fontFamily="system-ui, sans-serif"
      >
        end
      </text>
    </g>
  );
}
