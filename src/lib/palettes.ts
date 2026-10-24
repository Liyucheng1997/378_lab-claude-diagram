import type { Diagram } from './types';

// 一键配色：只改图表内容的颜色，不影响界面主题。
export interface Palette {
  id: string;
  name: string;
  fills: string[];
  strokes: string[];
  text: string;
  group: { fill: string; stroke: string; text: string };
  edge: string;
  background?: string;
}

export const PALETTES: Palette[] = [
  {
    id: 'apple',
    name: '清爽蓝',
    fills: ['#e8f2fd', '#e9f7ed', '#fff3e6', '#f3eefc', '#fdeceb'],
    strokes: ['#0071e3', '#248a3d', '#c93400', '#8944ab', '#d70015'],
    text: '#1d1d1f',
    group: { fill: '#f7f9fc', stroke: '#c9d4e3', text: '#3a3a3c' },
    edge: '#6e6e73',
  },
  {
    id: 'mono',
    name: '石墨',
    fills: ['#ffffff', '#f5f5f7', '#e8e8ed'],
    strokes: ['#1d1d1f', '#3a3a3c', '#6e6e73'],
    text: '#1d1d1f',
    group: { fill: '#fafafa', stroke: '#d2d2d7', text: '#1d1d1f' },
    edge: '#3a3a3c',
  },
  {
    id: 'bold',
    name: '实心',
    fills: ['#0071e3', '#248a3d', '#c93400', '#5e5ce6', '#1d1d1f'],
    strokes: ['#0071e3', '#248a3d', '#c93400', '#5e5ce6', '#1d1d1f'],
    text: '#ffffff',
    group: { fill: '#f5f5f7', stroke: '#d2d2d7', text: '#1d1d1f' },
    edge: '#6e6e73',
  },
  {
    id: 'forest',
    name: '森林',
    fills: ['#e8f5e9', '#f1f8e9', '#e0f2f1', '#fffde7'],
    strokes: ['#2e7d32', '#558b2f', '#00796b', '#9e9d24'],
    text: '#1b2e1d',
    group: { fill: '#f6faf6', stroke: '#c5dcc7', text: '#2e4b31' },
    edge: '#5f7a62',
  },
  {
    id: 'sunset',
    name: '日落',
    fills: ['#fff1e6', '#ffe8e8', '#fff8db', '#fcefff'],
    strokes: ['#e8590c', '#e03131', '#f08c00', '#ae3ec9'],
    text: '#3b2414',
    group: { fill: '#fffaf5', stroke: '#f1d3bd', text: '#6b3d1e' },
    edge: '#9a6b4f',
  },
  {
    id: 'muted',
    name: '莫兰迪',
    fills: ['#ece6dd', '#e1e8eb', '#e9e1ea', '#e4eadf'],
    strokes: ['#8d7b68', '#6c7a89', '#8a7090', '#74866b'],
    text: '#3d3a36',
    group: { fill: '#f8f6f3', stroke: '#d9d2c8', text: '#5c5650' },
    edge: '#8a847c',
  },
  {
    id: 'night',
    name: '暗夜',
    fills: ['#2c2c2e', '#2c2c2e', '#2c2c2e', '#2c2c2e'],
    strokes: ['#64d2ff', '#30d158', '#ffd60a', '#bf5af2'],
    text: '#f5f5f7',
    group: { fill: '#242426', stroke: '#48484a', text: '#d1d1d6' },
    edge: '#8e8e93',
    background: '#1c1c1e',
  },
];

/** 同一分组内的节点同色；顶层节点按图形类型分色 */
export function applyPalette(d: Diagram, p: Palette): Diagram {
  const keys: string[] = [];
  const idx = (k: string) => {
    let i = keys.indexOf(k);
    if (i < 0) i = keys.push(k) - 1;
    return i;
  };
  const nodes = d.nodes.map((n) => {
    if (n.shape === 'group')
      return { ...n, style: { ...n.style, fill: p.group.fill, stroke: p.group.stroke, textColor: p.group.text } };
    if (n.shape === 'text') return { ...n, style: { ...n.style, textColor: p.text } };
    const i = idx(n.parent ? 'g:' + n.parent : 's:' + n.shape) % p.fills.length;
    return { ...n, style: { ...n.style, fill: p.fills[i], stroke: p.strokes[i % p.strokes.length], textColor: p.text } };
  });
  const edges = d.edges.map((e) => ({ ...e, style: { ...e.style, color: p.edge } }));
  return { ...d, nodes, edges, background: p.background ?? (d.background === '#1c1c1e' ? '' : d.background) };
}
