import type { Edge, Node } from '@xyflow/react';
import type { CodeRef } from '../code/types';
import type { Diagram, DiagramEdge, DiagramNode, EdgeStyle, NodeStyle, ShapeType } from './types';

export type ShapeData = { label: string; shape: ShapeType; icon?: string; style: NodeStyle; ref?: CodeRef };
export type ShapeRFNode = Node<ShapeData, 'shape'>;
export type EdgeData = { label?: string; style: EdgeStyle };
export type SmartRFEdge = Edge<EdgeData, 'smart'>;

const round = (n: number) => Math.round(n);

/** 计算每个节点的绝对坐标（React Flow 的子节点坐标相对父节点） */
export function absolutePositions(nodes: ShapeRFNode[]): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, { x: number; y: number }>();
  const get = (n: ShapeRFNode, guard = 0): { x: number; y: number } => {
    const hit = memo.get(n.id);
    if (hit) return hit;
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const base = parent && guard < 50 ? get(parent, guard + 1) : { x: 0, y: 0 };
    const p = { x: base.x + n.position.x, y: base.y + n.position.y };
    memo.set(n.id, p);
    return p;
  };
  nodes.forEach((n) => get(n));
  return memo;
}

export function nodeSize(n: ShapeRFNode): { width: number; height: number } {
  return {
    width: n.width ?? n.measured?.width ?? 160,
    height: n.height ?? n.measured?.height ?? 64,
  };
}

export function toModel(
  nodes: ShapeRFNode[],
  edges: SmartRFEdge[],
  meta: Pick<Diagram, 'title' | 'background' | 'direction' | 'view' | 'rotation'>,
): Diagram {
  const abs = absolutePositions(nodes);
  const ids = new Set(nodes.map((n) => n.id));
  const dn: DiagramNode[] = nodes.map((n) => {
    const p = abs.get(n.id)!;
    const { width, height } = nodeSize(n);
    const out: DiagramNode = {
      id: n.id,
      label: n.data.label,
      shape: n.data.shape,
      x: round(p.x),
      y: round(p.y),
      width: round(width),
      height: round(height),
      style: { ...n.data.style },
    };
    if (n.data.icon) out.icon = n.data.icon;
    if (n.data.ref) out.ref = { ...n.data.ref };
    if (n.parentId && ids.has(n.parentId)) out.parent = n.parentId;
    return out;
  });
  const de: DiagramEdge[] = edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => {
      const out: DiagramEdge = { id: e.id, source: e.source, target: e.target, style: { ...e.data?.style } };
      if (e.data?.label) out.label = e.data.label;
      return out;
    });
  return { ...meta, nodes: dn, edges: de };
}

/** 父节点合法性修正：父节点必须存在、必须是容器，不能成环 */
export function sanitizeParents(nodes: DiagramNode[]): DiagramNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.map((n) => {
    if (!n.parent) return n;
    const seen = new Set([n.id]);
    let cur = byId.get(n.parent);
    let ok = !!cur && cur.shape === 'group' && n.parent !== n.id;
    while (ok && cur?.parent) {
      if (seen.has(cur.id)) ok = false;
      seen.add(cur.id);
      cur = byId.get(cur.parent);
      if (!cur) ok = false;
    }
    return ok ? n : { ...n, parent: undefined };
  });
}

export function depthOf(nodes: { id: string; parent?: string; parentId?: string }[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, number>();
  const get = (id: string, guard = 0): number => {
    if (memo.has(id)) return memo.get(id)!;
    const n = byId.get(id);
    const p = n?.parent ?? n?.parentId;
    const d = p && byId.has(p) && guard < 50 ? get(p, guard + 1) + 1 : 0;
    memo.set(id, d);
    return d;
  };
  nodes.forEach((n) => get(n.id));
  return memo;
}

/** React Flow 要求父节点排在子节点前面 */
export function sortByDepth<T extends { id: string; parent?: string; parentId?: string }>(nodes: T[]): T[] {
  const depth = depthOf(nodes);
  return nodes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => depth.get(a.n.id)! - depth.get(b.n.id)! || a.i - b.i)
    .map((x) => x.n);
}

export function fromModel(d: Diagram): { nodes: ShapeRFNode[]; edges: SmartRFEdge[] } {
  const clean = sortByDepth(sanitizeParents(d.nodes));
  const byId = new Map(clean.map((n) => [n.id, n]));
  const nodes: ShapeRFNode[] = clean.map((n) => {
    const parent = n.parent ? byId.get(n.parent) : undefined;
    const rf: ShapeRFNode = {
      id: n.id,
      type: 'shape',
      position: { x: n.x - (parent?.x ?? 0), y: n.y - (parent?.y ?? 0) },
      width: n.width,
      height: n.height,
      data: { label: n.label, shape: n.shape, icon: n.icon, style: { ...n.style }, ...(n.ref ? { ref: { ...n.ref } } : {}) },
    };
    if (parent) rf.parentId = parent.id;
    return rf;
  });
  const edges: SmartRFEdge[] = d.edges
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .map((e) => ({
      id: e.id,
      type: 'smart',
      source: e.source,
      target: e.target,
      data: { label: e.label, style: { ...e.style } },
    }));
  return { nodes, edges };
}
