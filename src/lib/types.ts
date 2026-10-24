// 图表的"文档模型"：坐标一律为画布绝对坐标（左上角为原点）。
// React Flow 的节点状态与它互相转换（见 convert.ts），AI 工具与导入导出都只认这个模型。

export const SHAPES = [
  'rect',
  'rounded',
  'ellipse',
  'circle',
  'diamond',
  'parallelogram',
  'hexagon',
  'cylinder',
  'document',
  'cloud',
  'triangle',
  'actor',
  'note',
  'text',
  'group',
] as const;
export type ShapeType = (typeof SHAPES)[number];

export const ARROWS = ['end', 'start', 'both', 'none'] as const;
export type ArrowType = (typeof ARROWS)[number];

export const LINE_TYPES = ['smoothstep', 'step', 'bezier', 'straight'] as const;
export type LineType = (typeof LINE_TYPES)[number];

export const DIRECTIONS = ['DOWN', 'RIGHT', 'UP', 'LEFT'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export interface NodeStyle {
  fill?: string;
  stroke?: string;
  textColor?: string;
  fontSize?: number;
  bold?: boolean;
  strokeWidth?: number;
  dashed?: boolean;
}

export interface EdgeStyle {
  color?: string;
  width?: number;
  dashed?: boolean;
  animated?: boolean;
  arrow?: ArrowType;
  lineType?: LineType;
}

export interface DiagramNode {
  id: string;
  label: string;
  shape: ShapeType;
  icon?: string;
  parent?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: NodeStyle;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  style: EdgeStyle;
}

export interface Diagram {
  title: string;
  /** 空字符串 = 跟随界面主题（导出时按白色处理） */
  background: string;
  direction: Direction;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export const DEFAULT_NODE_STYLE: Required<NodeStyle> = {
  fill: '#ffffff',
  stroke: '#6e6e73',
  textColor: '#1d1d1f',
  fontSize: 14,
  bold: false,
  strokeWidth: 1.5,
  dashed: false,
};

export const DEFAULT_GROUP_STYLE: Required<NodeStyle> = {
  fill: '#f5f7fa',
  stroke: '#c7ccd4',
  textColor: '#3a3a3c',
  fontSize: 13,
  bold: true,
  strokeWidth: 1.25,
  dashed: false,
};

export const DEFAULT_TEXT_STYLE: Required<NodeStyle> = {
  ...DEFAULT_NODE_STYLE,
  fill: 'none',
  stroke: 'none',
  strokeWidth: 0,
};

export const DEFAULT_EDGE_STYLE: Required<EdgeStyle> = {
  color: '#6e6e73',
  width: 1.5,
  dashed: false,
  animated: false,
  arrow: 'end',
  lineType: 'smoothstep',
};

export function nodeStyle(shape: ShapeType, style: NodeStyle | undefined): Required<NodeStyle> {
  const base = shape === 'group' ? DEFAULT_GROUP_STYLE : shape === 'text' ? DEFAULT_TEXT_STYLE : DEFAULT_NODE_STYLE;
  return { ...base, ...stripUndefined(style) };
}

export function edgeStyle(style: EdgeStyle | undefined): Required<EdgeStyle> {
  return { ...DEFAULT_EDGE_STYLE, ...stripUndefined(style) };
}

export function stripUndefined<T extends object>(o: T | undefined): Partial<T> {
  const out: Partial<T> = {};
  if (!o) return out;
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
  return out;
}

export function emptyDiagram(title = '未命名图表'): Diagram {
  return { title, background: '', direction: 'DOWN', nodes: [], edges: [] };
}

export function uid(prefix = 'n'): string {
  return prefix + Math.random().toString(36).slice(2, 8);
}
