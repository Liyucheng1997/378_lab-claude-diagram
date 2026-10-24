import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { CodeRefZ, type CodeRefInput } from '../code/tools';
import type { CodeRef } from '../code/types';
import { ICONS, ICON_NAMES } from '../lib/icons';
import { autoLayout } from '../lib/layout';
import { autoSize } from '../lib/shapes';
import { ARROWS, DIRECTIONS, LINE_TYPES, nodeStyle, SHAPES, VIEWS, type Diagram, type DiagramEdge, type DiagramNode } from '../lib/types';

// ---------- 参数结构（Zod 同时用于生成 JSON Schema 和校验模型输出） ----------

const NodeStyleZ = z
  .object({
    fill: z.string().describe('填充色，CSS 颜色如 "#e8f2fd"；"none" 表示透明'),
    stroke: z.string().describe('边框色；"none" 表示无边框'),
    textColor: z.string().describe('文字颜色'),
    fontSize: z.number().min(8).max(72).describe('字号，默认 14'),
    bold: z.boolean().describe('文字加粗'),
    strokeWidth: z.number().min(0).max(10).describe('边框粗细，默认 1.5'),
    dashed: z.boolean().describe('虚线边框'),
    depth: z.number().min(0).max(400).describe('3D 视图中的立体高度，省略或 0 为按图形自动（普通方块约 24）'),
  })
  .partial();

const EdgeStyleZ = z
  .object({
    color: z.string().describe('线条颜色'),
    width: z.number().min(0.5).max(10).describe('线宽，默认 1.5'),
    dashed: z.boolean().describe('虚线'),
    animated: z.boolean().describe('流动动画（表示数据流/异步调用）'),
    arrow: z.enum(ARROWS).describe('箭头位置，默认 end'),
    lineType: z.enum(LINE_TYPES).describe('线型：smoothstep 圆角折线(默认) / step 直角折线 / bezier 曲线 / straight 直线'),
  })
  .partial();

const ShapeZ = z.enum(SHAPES);

const NodeInZ = z.object({
  id: z.string().min(1).describe('唯一 id，建议用有意义的英文短名，如 "api_gateway"'),
  label: z.string().describe('显示文字，可用 \\n 换行；保持简短'),
  shape: ShapeZ.optional().describe('图形，默认 rounded'),
  icon: z.string().optional().describe('可选图标名（见系统说明里的图标列表）'),
  parent: z.string().optional().describe('所属分组节点（shape=group）的 id'),
  x: z.number().optional().describe('绝对坐标 x（左上角），仅手动布局时需要'),
  y: z.number().optional(),
  width: z.number().optional().describe('宽度，省略则按文字自动计算'),
  height: z.number().optional(),
  style: NodeStyleZ.optional(),
  ref: CodeRefZ.optional().describe('仅代码分析模式：该节点对应的代码位置，用户点击节点会跳转到这里'),
});

const EdgeInZ = z.object({
  id: z.string().optional().describe('连线 id，省略则自动生成'),
  source: z.string().describe('起点节点 id'),
  target: z.string().describe('终点节点 id'),
  label: z.string().optional().describe('连线文字，尽量 2–6 个字'),
  style: EdgeStyleZ.optional(),
});

export const CreateDiagramZ = z.object({
  title: z.string().optional().describe('图表标题'),
  layout: z.enum(['auto', 'manual']).optional().describe('auto(默认)=自动分层布局，坐标会被忽略；manual=使用你给出的 x/y/width/height'),
  direction: z.enum(DIRECTIONS).optional().describe('自动布局方向：DOWN 自上而下(默认) / RIGHT 自左向右 / UP / LEFT'),
  background: z.string().optional().describe('画布背景色，空字符串表示默认'),
  view: z.enum(VIEWS).optional().describe('2d 平面图 / 3d 等轴测立体图；省略则保持当前视图'),
  nodes: z.array(NodeInZ).min(1),
  edges: z.array(EdgeInZ).optional(),
});

const NodeUpdateZ = NodeInZ.partial()
  .extend({
    id: z.string().describe('要修改的节点 id'),
    parent: z.string().nullable().optional().describe('新的分组 id；null 表示移出分组'),
    style: NodeStyleZ.optional().describe('只需给出要改的样式字段，会与原样式合并'),
    ref: CodeRefZ.nullable().optional().describe('新的代码位置；null 表示移除'),
  });

const EdgeUpdateZ = EdgeInZ.partial().extend({
  id: z.string().describe('要修改的连线 id'),
  style: EdgeStyleZ.optional().describe('只需给出要改的字段'),
});

export const EditDiagramZ = z.object({
  update_nodes: z.array(NodeUpdateZ).optional().describe('修改已有节点（只写要变的字段）'),
  update_edges: z.array(EdgeUpdateZ).optional().describe('修改已有连线'),
  add_nodes: z.array(NodeInZ).optional().describe('新增节点；不给坐标会自动放在相连节点旁边'),
  add_edges: z.array(EdgeInZ).optional().describe('新增连线'),
  delete_ids: z
    .array(z.string())
    .optional()
    .describe('要删除的节点或连线 id。删除节点会同时删除其连线；删除分组不会删除子节点（子节点移出分组），需要时请一并列出子节点'),
  restyle_all: z
    .object({
      nodes: NodeStyleZ.optional().describe('应用到所有普通节点'),
      groups: NodeStyleZ.optional().describe('应用到所有分组'),
      edges: EdgeStyleZ.optional().describe('应用到所有连线'),
    })
    .optional()
    .describe('批量统一样式（在单个修改之前执行）'),
  background: z.string().optional().describe('画布背景色'),
  view: z.enum(VIEWS).optional().describe('切换 2d 平面图 / 3d 等轴测立体图'),
  title: z.string().optional(),
  relayout: z.boolean().optional().describe('修改后是否整体重新自动布局（会覆盖现有位置）'),
  direction: z.enum(DIRECTIONS).optional().describe('重新布局时的方向'),
});

export type CreateDiagramInput = z.infer<typeof CreateDiagramZ>;
export type EditDiagramInput = z.infer<typeof EditDiagramZ>;

function jsonSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const s = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete s.$schema;
  return s as Anthropic.Tool.InputSchema;
}

export const TOOLS = [
  {
    name: 'create_diagram',
    description:
      '在画布上绘制一张全新的图表（会替换当前画布全部内容）。用于新建图表、或用户要求彻底重画/换一种图。默认自动布局，你只需给出节点、分组和连线。',
    input_schema: jsonSchema(CreateDiagramZ),
    eager_input_streaming: true,
  },
  {
    name: 'edit_diagram',
    description:
      '对当前画布做局部修改：改文字、改颜色、增删节点或连线、调整分组、移动位置等。未提及的元素保持不变（包括位置）。优先用它而不是重画。',
    input_schema: jsonSchema(EditDiagramZ),
    eager_input_streaming: true,
  },
] satisfies Anthropic.Beta.BetaTool[];

// ---------- 执行 ----------

/** 校验节点的代码位置（由调用方注入，依赖当前加载的项目） */
export type RefResolver = (r: CodeRefInput) => { ref?: CodeRef; warning?: string };

const keepRef: RefResolver = (r) => ({ ref: { path: r.path, line: r.line, endLine: r.end_line, symbol: r.symbol, note: r.note } });

function applyRef(r: CodeRefInput, resolve: RefResolver, warnings: string[]): CodeRef | undefined {
  const out = resolve(r);
  if (out.warning) warnings.push(out.warning);
  return out.ref;
}

export interface ToolOutcome {
  diagram: Diagram;
  summary: string;
  warnings: string[];
  fit: boolean;
}

function normIcon(icon: string | undefined, warnings: string[]) {
  if (!icon) return undefined;
  if (ICONS[icon]) return icon;
  warnings.push(`未知图标 "${icon}" 已忽略，可用：${ICON_NAMES.slice(0, 12).join(', ')} 等`);
  return undefined;
}

function buildNode(n: z.infer<typeof NodeInZ>, warnings: string[], resolve: RefResolver): DiagramNode & { _placed: boolean } {
  const shape = n.shape ?? 'rounded';
  const icon = normIcon(n.icon, warnings);
  const st = nodeStyle(shape, n.style);
  const [aw, ah] = autoSize(shape, n.label, st.fontSize, !!icon);
  return {
    id: n.id,
    label: n.label ?? '',
    shape,
    icon,
    parent: n.parent,
    x: n.x ?? 0,
    y: n.y ?? 0,
    width: n.width ?? aw,
    height: n.height ?? ah,
    style: { ...n.style },
    ...(n.ref ? { ref: applyRef(n.ref, resolve, warnings) } : {}),
    _placed: n.x !== undefined && n.y !== undefined,
  };
}

function strip(n: DiagramNode & { _placed?: boolean }): DiagramNode {
  const { _placed, ...rest } = n;
  void _placed;
  return rest;
}

function buildEdges(list: z.infer<typeof EdgeInZ>[], nodeIds: Set<string>, existing: Set<string>, warnings: string[]): DiagramEdge[] {
  const out: DiagramEdge[] = [];
  for (const e of list) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      warnings.push(`连线 ${e.source} → ${e.target} 的端点不存在，已跳过`);
      continue;
    }
    let id = e.id ?? `e_${e.source}_${e.target}`;
    while (existing.has(id)) id = id + '_' + Math.random().toString(36).slice(2, 4);
    existing.add(id);
    out.push({ id, source: e.source, target: e.target, label: e.label, style: { ...e.style } });
  }
  return out;
}

/** 分组只扩不缩：保证子节点都在分组内部 */
function fitGroups(nodes: DiagramNode[]): DiagramNode[] {
  const byId = new Map(nodes.map((n) => [n.id, { ...n }]));
  // 由深到浅处理，使嵌套分组也能被撑开
  const depth = (n: DiagramNode, g = 0): number => (n.parent && byId.has(n.parent) && g < 50 ? depth(byId.get(n.parent)!, g + 1) + 1 : 0);
  const groups = [...byId.values()].filter((n) => n.shape === 'group').sort((a, b) => depth(b) - depth(a));
  for (const g of groups) {
    const kids = [...byId.values()].filter((n) => n.parent === g.id);
    if (!kids.length) continue;
    const x1 = Math.min(...kids.map((k) => k.x)) - 28;
    const y1 = Math.min(...kids.map((k) => k.y)) - 52;
    const x2 = Math.max(...kids.map((k) => k.x + k.width)) + 28;
    const y2 = Math.max(...kids.map((k) => k.y + k.height)) + 28;
    const nx = Math.min(g.x, x1);
    const ny = Math.min(g.y, y1);
    g.width = Math.max(g.x + g.width, x2) - nx;
    g.height = Math.max(g.y + g.height, y2) - ny;
    g.x = nx;
    g.y = ny;
  }
  return nodes.map((n) => byId.get(n.id)!);
}

function overlaps(a: DiagramNode, list: DiagramNode[]) {
  return list.some(
    (b) => b.id !== a.id && b.shape !== 'group' && a.x < b.x + b.width + 20 && a.x + a.width + 20 > b.x && a.y < b.y + b.height + 20 && a.y + a.height + 20 > b.y,
  );
}

/** 给没有坐标的新节点找个位置：放在与之相连的节点旁边 */
function placeNear(n: DiagramNode, all: DiagramNode[], edges: DiagramEdge[], d: Diagram) {
  const byId = new Map(all.map((x) => [x.id, x]));
  // 有分组的新节点直接排在同组兄弟节点下方；否则贴着相连的节点放
  const link = n.parent
    ? undefined
    : edges.find((e) => (e.target === n.id && byId.has(e.source)) || (e.source === n.id && byId.has(e.target)));
  const anchorId = link ? (link.target === n.id ? link.source : link.target) : undefined;
  const anchor = anchorId ? byId.get(anchorId) : undefined;
  const after = !link || link.target === n.id; // 新节点在下游
  const horizontal = d.direction === 'RIGHT' || d.direction === 'LEFT';
  if (anchor) {
    if (horizontal) {
      n.x = after ? anchor.x + anchor.width + 80 : anchor.x - n.width - 80;
      n.y = anchor.y + (anchor.height - n.height) / 2;
    } else {
      n.x = anchor.x + (anchor.width - n.width) / 2;
      n.y = after ? anchor.y + anchor.height + 70 : anchor.y - n.height - 70;
    }
  } else {
    const parent = n.parent ? byId.get(n.parent) : undefined;
    const pool = parent ? all.filter((x) => x.parent === parent.id) : all;
    if (pool.length) {
      n.x = Math.min(...pool.map((x) => x.x));
      n.y = Math.max(...pool.map((x) => x.y + x.height)) + 60;
    } else if (parent) {
      n.x = parent.x + 28;
      n.y = parent.y + 52;
    } else {
      n.x = 40;
      n.y = 40;
    }
  }
  for (let i = 0; i < 40 && overlaps(n, all); i++) {
    if (horizontal) n.y += n.height + 30;
    else n.x += n.width + 40;
  }
}

export async function runCreate(input: CreateDiagramInput, current: Diagram, resolve: RefResolver = keepRef): Promise<ToolOutcome> {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const built = input.nodes.map((n) => {
    const b = buildNode(n, warnings, resolve);
    if (seen.has(b.id)) {
      warnings.push(`节点 id "${b.id}" 重复，已重命名`);
      b.id = b.id + '_' + Math.random().toString(36).slice(2, 5);
    }
    seen.add(b.id);
    return b;
  });
  const ids = new Set(built.map((n) => n.id));
  for (const n of built) {
    if (n.parent && !ids.has(n.parent)) {
      warnings.push(`节点 ${n.id} 的分组 ${n.parent} 不存在`);
      n.parent = undefined;
    }
  }
  const edges = buildEdges(input.edges ?? [], ids, new Set(), warnings);
  let d: Diagram = {
    title: input.title ?? current.title,
    background: input.background ?? current.background,
    direction: input.direction ?? 'DOWN',
    view: input.view ?? current.view,
    rotation: current.rotation,
    nodes: built.map(strip),
    edges,
  };
  const manual = input.layout === 'manual' && built.every((n) => n._placed);
  if (input.layout === 'manual' && !manual) warnings.push('部分节点缺少坐标，已改用自动布局');
  d = manual ? { ...d, nodes: fitGroups(d.nodes) } : await autoLayout(d, d.direction);
  return {
    diagram: d,
    summary: `已绘制「${d.title}」：${d.nodes.length} 个节点，${d.edges.length} 条连线（${manual ? '手动布局' : '自动布局 ' + d.direction}）。`,
    warnings,
    fit: true,
  };
}

export async function runEdit(input: EditDiagramInput, current: Diagram, resolve: RefResolver = keepRef): Promise<ToolOutcome> {
  const warnings: string[] = [];
  let nodes = current.nodes.map((n) => ({ ...n, style: { ...n.style } }));
  let edges = current.edges.map((e) => ({ ...e, style: { ...e.style } }));
  const stats = { upd: 0, add: 0, del: 0 };

  // 1. 删除
  const del = new Set(input.delete_ids ?? []);
  for (const id of del) if (!nodes.some((n) => n.id === id) && !edges.some((e) => e.id === id)) warnings.push(`要删除的 ${id} 不存在`);
  if (del.size) {
    const before = nodes.length + edges.length;
    const removed = new Map(nodes.filter((n) => del.has(n.id)).map((n) => [n.id, n]));
    nodes = nodes
      .filter((n) => !del.has(n.id))
      .map((n) => {
        let p = n.parent;
        while (p && removed.has(p)) p = removed.get(p)!.parent;
        return { ...n, parent: p };
      });
    edges = edges.filter((e) => !del.has(e.id) && !removed.has(e.source) && !removed.has(e.target));
    stats.del = before - nodes.length - edges.length;
  }

  // 2. 批量样式
  const rs = input.restyle_all;
  if (rs) {
    nodes = nodes.map((n) => {
      const s = n.shape === 'group' ? rs.groups : n.shape === 'text' ? undefined : rs.nodes;
      return s ? { ...n, style: { ...n.style, ...s } } : n;
    });
    if (rs.edges) edges = edges.map((e) => ({ ...e, style: { ...e.style, ...rs.edges } }));
  }

  // 3. 修改节点
  for (const u of input.update_nodes ?? []) {
    const n = nodes.find((x) => x.id === u.id);
    if (!n) {
      warnings.push(`节点 ${u.id} 不存在，未修改`);
      continue;
    }
    stats.upd++;
    if (u.label !== undefined) n.label = u.label;
    if (u.shape !== undefined) n.shape = u.shape;
    if (u.icon !== undefined) n.icon = u.icon === '' ? undefined : normIcon(u.icon, warnings);
    if (u.parent !== undefined) {
      if (u.parent === null) n.parent = undefined;
      else if (nodes.some((g) => g.id === u.parent && g.shape === 'group')) n.parent = u.parent;
      else warnings.push(`分组 ${u.parent} 不存在`);
    }
    // 移动分组时子节点跟随
    if (u.x !== undefined || u.y !== undefined) {
      const dx = (u.x ?? n.x) - n.x;
      const dy = (u.y ?? n.y) - n.y;
      n.x += dx;
      n.y += dy;
      if (n.shape === 'group') {
        const move = (pid: string, g = 0) => {
          for (const c of nodes) if (c.parent === pid && g < 50) { c.x += dx; c.y += dy; move(c.id, g + 1); }
        };
        move(n.id);
      }
    }
    if (u.width !== undefined) n.width = u.width;
    if (u.height !== undefined) n.height = u.height;
    if (u.style) n.style = { ...n.style, ...u.style };
    if (u.ref === null) delete n.ref;
    else if (u.ref) n.ref = applyRef(u.ref, resolve, warnings);
  }

  // 4. 修改连线
  const nodeIds = () => new Set(nodes.map((n) => n.id));
  for (const u of input.update_edges ?? []) {
    const e = edges.find((x) => x.id === u.id);
    if (!e) {
      warnings.push(`连线 ${u.id} 不存在，未修改`);
      continue;
    }
    stats.upd++;
    const ids = nodeIds();
    if (u.source !== undefined) ids.has(u.source) ? (e.source = u.source) : warnings.push(`节点 ${u.source} 不存在`);
    if (u.target !== undefined) ids.has(u.target) ? (e.target = u.target) : warnings.push(`节点 ${u.target} 不存在`);
    if (u.label !== undefined) e.label = u.label || undefined;
    if (u.style) e.style = { ...e.style, ...u.style };
  }

  // 5. 新增节点与连线
  const added = (input.add_nodes ?? []).map((n) => {
    const b = buildNode(n, warnings, resolve);
    if (nodes.some((x) => x.id === b.id)) {
      const old = b.id;
      b.id = b.id + '_' + Math.random().toString(36).slice(2, 5);
      warnings.push(`节点 id "${old}" 已存在，新节点改名为 "${b.id}"`);
    }
    return b;
  });
  const allIds = new Set([...nodes.map((n) => n.id), ...added.map((n) => n.id)]);
  for (const n of added) {
    if (n.parent && !(nodes.some((g) => g.id === n.parent && g.shape === 'group') || added.some((g) => g.id === n.parent && g.shape === 'group'))) {
      warnings.push(`节点 ${n.id} 的分组 ${n.parent} 不存在`);
      n.parent = undefined;
    }
  }
  const newEdges = buildEdges(input.add_edges ?? [], allIds, new Set(edges.map((e) => e.id)), warnings);
  stats.add = added.length + newEdges.length;
  edges = [...edges, ...newEdges];

  const unplaced = added.filter((n) => !n._placed);
  const relayout = input.relayout ?? (unplaced.length >= 4 && unplaced.length >= nodes.length / 2);
  const direction = input.direction ?? current.direction;
  let d: Diagram = {
    title: input.title ?? current.title,
    background: input.background ?? current.background,
    direction,
    view: input.view ?? current.view,
    rotation: current.rotation,
    nodes,
    edges,
  };
  // 先放下有坐标的新节点，再给其余新节点依次找位置
  for (const n of added) if (n._placed) d.nodes.push(strip(n));
  for (const n of unplaced) {
    if (!relayout) placeNear(n, d.nodes, edges, d);
    d.nodes.push(strip(n));
  }
  d = relayout ? await autoLayout(d, direction) : { ...d, nodes: fitGroups(d.nodes) };

  const parts = [];
  if (stats.upd) parts.push(`修改 ${stats.upd} 处`);
  if (stats.add) parts.push(`新增 ${stats.add} 个元素`);
  if (stats.del) parts.push(`删除 ${stats.del} 个元素`);
  if (rs) parts.push('批量更新了样式');
  if (input.background !== undefined) parts.push('更新了背景');
  if (input.view && input.view !== current.view) parts.push(input.view === '3d' ? '切换为 3D 视图' : '切换为 2D 视图');
  if (relayout) parts.push('重新自动布局');
  return {
    diagram: d,
    summary: `已更新图表：${parts.join('，') || '无变化'}。当前共 ${d.nodes.length} 个节点，${d.edges.length} 条连线。`,
    warnings,
    fit: relayout || added.length > 0,
  };
}

/** 发给模型的画布快照：紧凑 JSON，省略默认值 */
export function diagramForPrompt(d: Diagram): string {
  return JSON.stringify({
    title: d.title,
    direction: d.direction,
    view: d.view === '3d' ? '3d' : undefined,
    background: d.background || undefined,
    nodes: d.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      shape: n.shape,
      icon: n.icon,
      parent: n.parent,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      style: Object.keys(n.style).length ? n.style : undefined,
      ref: n.ref ? { path: n.ref.path, line: n.ref.line, symbol: n.ref.symbol } : undefined,
    })),
    edges: d.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      style: Object.keys(e.style).length ? e.style : undefined,
    })),
  });
}

