import type { ELK, ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import { sanitizeParents } from './convert';
import type { Diagram, DiagramNode, Direction } from './types';

// ELK 体积较大，第一次布局时再加载
let elkPromise: Promise<ELK> | null = null;
const getElk = () => (elkPromise ??= import('elkjs/lib/elk.bundled.js').then((m) => new m.default()));

const GROUP_PADDING = '[top=52,left=28,bottom=28,right=28]';

/** 用 ELK 分层布局重新排版整张图（支持嵌套分组） */
export async function autoLayout(d: Diagram, direction: Direction = d.direction): Promise<Diagram> {
  const nodes = sanitizeParents(d.nodes);
  if (nodes.length === 0) return { ...d, direction };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string | undefined, DiagramNode[]>();
  for (const n of nodes) {
    const key = n.parent && byId.has(n.parent) ? n.parent : undefined;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(n);
  }

  const ancestors = (id: string): string[] => {
    const out: string[] = [];
    let cur = byId.get(id)?.parent;
    while (cur && byId.has(cur) && out.length < 50) {
      out.unshift(cur);
      cur = byId.get(cur)!.parent;
    }
    return out; // 从最外层到直接父级
  };

  const elkEdges = new Map<string | undefined, ElkExtendedEdge[]>();
  for (const e of d.edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    const a = ancestors(e.source);
    const b = ancestors(e.target);
    // 父子之间的连线不参与布局
    if (a.includes(e.target) || b.includes(e.source)) continue;
    let lca: string | undefined;
    for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) lca = a[i];
    if (!elkEdges.has(lca)) elkEdges.set(lca, []);
    elkEdges.get(lca)!.push({ id: e.id, sources: [e.source], targets: [e.target] });
  }

  const build = (n: DiagramNode): ElkNode => {
    const kids = children.get(n.id);
    if (n.shape === 'group' && kids?.length) {
      return {
        id: n.id,
        layoutOptions: { 'elk.padding': GROUP_PADDING },
        children: kids.map(build),
        edges: elkEdges.get(n.id) ?? [],
      };
    }
    return { id: n.id, width: n.width, height: n.height };
  };

  const graph: ElkNode = {
    id: '__root__',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '64',
      'elk.spacing.nodeNode': '44',
      'elk.layered.spacing.edgeNodeBetweenLayers': '28',
      'elk.spacing.componentComponent': '72',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=40,left=40,bottom=40,right=40]',
    },
    children: (children.get(undefined) ?? []).map(build),
    edges: elkEdges.get(undefined) ?? [],
  };

  try {
    const res = await (await getElk()).layout(graph);
    const placed = new Map<string, { x: number; y: number; width?: number; height?: number }>();
    const walk = (n: ElkNode, ox: number, oy: number) => {
      for (const c of n.children ?? []) {
        const x = ox + (c.x ?? 0);
        const y = oy + (c.y ?? 0);
        placed.set(c.id, { x, y, width: c.width, height: c.height });
        walk(c, x, y);
      }
    };
    walk(res, 0, 0);
    const out = nodes.map((n) => {
      const p = placed.get(n.id);
      if (!p) return n;
      const isGroupWithKids = n.shape === 'group' && (children.get(n.id)?.length ?? 0) > 0;
      return {
        ...n,
        x: Math.round(p.x),
        y: Math.round(p.y),
        width: isGroupWithKids && p.width ? Math.round(p.width) : n.width,
        height: isGroupWithKids && p.height ? Math.round(p.height) : n.height,
      };
    });
    return { ...d, direction, nodes: out };
  } catch (err) {
    console.warn('ELK 布局失败，改用网格排列', err);
    return { ...d, direction, nodes: gridLayout(nodes) };
  }
}

function gridLayout(nodes: DiagramNode[]): DiagramNode[] {
  const cols = Math.ceil(Math.sqrt(nodes.length));
  return nodes.map((n, i) => ({ ...n, parent: undefined, x: 40 + (i % cols) * 220, y: 40 + Math.floor(i / cols) * 140 }));
}
