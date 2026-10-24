import { getBezierPath, getSmoothStepPath, getStraightPath, Position } from '@xyflow/react';
import type { LineType } from './types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// "浮动连线"：根据两节点的相对位置自动选择连接边，节点怎么拖连线都贴合边框。
export function computeEdgePath(src: Rect, tgt: Rect, lineType: LineType) {
  const sc = { x: src.x + src.width / 2, y: src.y + src.height / 2 };
  const tc = { x: tgt.x + tgt.width / 2, y: tgt.y + tgt.height / 2 };
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;
  const gapX = Math.abs(dx) - (src.width + tgt.width) / 2;
  const gapY = Math.abs(dy) - (src.height + tgt.height) / 2;
  const horizontal = gapX > gapY;

  let sp: Position, tp: Position;
  if (horizontal) {
    sp = dx >= 0 ? Position.Right : Position.Left;
    tp = dx >= 0 ? Position.Left : Position.Right;
  } else {
    sp = dy >= 0 ? Position.Bottom : Position.Top;
    tp = dy >= 0 ? Position.Top : Position.Bottom;
  }
  const s = anchor(src, sp);
  const t = anchor(tgt, tp);
  const args = { sourceX: s.x, sourceY: s.y, sourcePosition: sp, targetX: t.x, targetY: t.y, targetPosition: tp };

  let res: [string, number, number, ...unknown[]];
  switch (lineType) {
    case 'bezier':
      res = getBezierPath(args);
      break;
    case 'straight':
      res = getStraightPath({ sourceX: s.x, sourceY: s.y, targetX: t.x, targetY: t.y });
      break;
    case 'step':
      res = getSmoothStepPath({ ...args, borderRadius: 0 });
      break;
    default:
      res = getSmoothStepPath({ ...args, borderRadius: 10 });
  }
  return { path: res[0], labelX: res[1], labelY: res[2] };
}

function anchor(r: Rect, p: Position) {
  switch (p) {
    case Position.Left:
      return { x: r.x, y: r.y + r.height / 2 };
    case Position.Right:
      return { x: r.x + r.width, y: r.y + r.height / 2 };
    case Position.Top:
      return { x: r.x + r.width / 2, y: r.y };
    default:
      return { x: r.x + r.width / 2, y: r.y + r.height };
  }
}
