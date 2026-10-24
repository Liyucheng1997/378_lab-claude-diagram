import type { ShapeType } from './types';

// 每种图形描述成若干 SVG 基本元素，画布渲染与 SVG 导出共用同一份几何。
export type Primitive =
  | { tag: 'rect'; x: number; y: number; width: number; height: number; rx: number; noFill?: boolean }
  | { tag: 'ellipse'; cx: number; cy: number; rx: number; ry: number; noFill?: boolean }
  | { tag: 'path'; d: string; noFill?: boolean };

export interface ShapeMeta {
  type: ShapeType;
  name: string;
  /** 新建时的默认尺寸 */
  size: [number, number];
}

export const SHAPE_CATALOG: ShapeMeta[] = [
  { type: 'rounded', name: '圆角矩形', size: [160, 64] },
  { type: 'rect', name: '矩形', size: [160, 64] },
  { type: 'ellipse', name: '椭圆', size: [150, 72] },
  { type: 'circle', name: '圆形', size: [88, 88] },
  { type: 'diamond', name: '判断', size: [150, 96] },
  { type: 'parallelogram', name: '输入输出', size: [170, 64] },
  { type: 'hexagon', name: '六边形', size: [160, 72] },
  { type: 'cylinder', name: '数据库', size: [120, 90] },
  { type: 'document', name: '文档', size: [150, 80] },
  { type: 'cloud', name: '云', size: [170, 100] },
  { type: 'triangle', name: '三角形', size: [110, 90] },
  { type: 'actor', name: '用户', size: [70, 104] },
  { type: 'note', name: '便签', size: [160, 90] },
  { type: 'text', name: '文本', size: [140, 40] },
  { type: 'group', name: '分组容器', size: [360, 240] },
];

export const SHAPE_META: Record<ShapeType, ShapeMeta> = Object.fromEntries(
  SHAPE_CATALOG.map((s) => [s.type, s]),
) as Record<ShapeType, ShapeMeta>;

const f = (n: number) => Math.round(n * 100) / 100;

/** 把 0–100 归一化坐标的路径缩放到 w×h */
function scalePath(d: string, w: number, h: number): string {
  return d.replace(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g, (_, x, y) => `${f((+x * w) / 100)} ${f((+y * h) / 100)}`);
}

const CLOUD =
  'M 25 92 C 8 92 0 76 8 64 C 0 50 10 32 26 36 C 28 16 50 6 62 20 C 72 6 94 12 92 34 C 102 40 102 62 90 70 C 96 86 80 96 68 90 C 60 98 38 100 25 92 Z';

export function shapePrimitives(shape: ShapeType, w: number, h: number): Primitive[] {
  switch (shape) {
    case 'rect':
      return [{ tag: 'rect', x: 0, y: 0, width: w, height: h, rx: 2 }];
    case 'rounded':
      return [{ tag: 'rect', x: 0, y: 0, width: w, height: h, rx: Math.min(14, h / 3.2) }];
    case 'group':
      return [{ tag: 'rect', x: 0, y: 0, width: w, height: h, rx: 16 }];
    case 'ellipse':
      return [{ tag: 'ellipse', cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2 }];
    case 'circle': {
      const r = Math.min(w, h) / 2;
      return [{ tag: 'ellipse', cx: w / 2, cy: h / 2, rx: r, ry: r }];
    }
    case 'diamond':
      return [{ tag: 'path', d: `M ${f(w / 2)} 0 L ${w} ${f(h / 2)} L ${f(w / 2)} ${h} L 0 ${f(h / 2)} Z` }];
    case 'parallelogram': {
      const s = Math.min(w * 0.18, h * 0.6);
      return [{ tag: 'path', d: `M ${f(s)} 0 L ${w} 0 L ${f(w - s)} ${h} L 0 ${h} Z` }];
    }
    case 'hexagon': {
      const s = Math.min(w * 0.2, h * 0.5);
      return [
        {
          tag: 'path',
          d: `M ${f(s)} 0 L ${f(w - s)} 0 L ${w} ${f(h / 2)} L ${f(w - s)} ${h} L ${f(s)} ${h} L 0 ${f(h / 2)} Z`,
        },
      ];
    }
    case 'cylinder': {
      const ry = Math.min(h * 0.14, 14);
      return [
        { tag: 'path', d: `M 0 ${f(ry)} V ${f(h - ry)} A ${f(w / 2)} ${f(ry)} 0 0 0 ${w} ${f(h - ry)} V ${f(ry)} Z` },
        { tag: 'ellipse', cx: w / 2, cy: ry, rx: w / 2, ry },
      ];
    }
    case 'document': {
      const wv = Math.min(h * 0.12, 12);
      return [
        {
          tag: 'path',
          d: `M 0 0 H ${w} V ${f(h - wv)} Q ${f(w * 0.75)} ${f(h - wv * 2.6)} ${f(w / 2)} ${f(h - wv)} T 0 ${f(h - wv)} Z`,
        },
      ];
    }
    case 'cloud':
      return [{ tag: 'path', d: scalePath(CLOUD, w, h) }];
    case 'triangle':
      return [{ tag: 'path', d: `M ${f(w / 2)} 0 L ${w} ${h} L 0 ${h} Z` }];
    case 'note': {
      const c = Math.min(16, w * 0.2, h * 0.3);
      return [
        { tag: 'path', d: `M 0 0 H ${f(w - c)} L ${w} ${f(c)} V ${h} H 0 Z` },
        { tag: 'path', d: `M ${f(w - c)} 0 V ${f(c)} H ${w}`, noFill: true },
      ];
    }
    case 'actor': {
      // 小人占上方 72%，下方留给文字
      const fh = h * 0.72;
      const r = Math.min(w * 0.22, fh * 0.16);
      const cx = w / 2;
      const neck = r * 2 + 1;
      const hip = fh * 0.66;
      const arm = fh * 0.38;
      return [
        { tag: 'ellipse', cx, cy: r + 1, rx: r, ry: r },
        {
          tag: 'path',
          noFill: true,
          d: `M ${f(cx)} ${f(neck)} V ${f(hip)} M ${f(cx - w * 0.36)} ${f(arm)} H ${f(cx + w * 0.36)} M ${f(cx)} ${f(hip)} L ${f(cx - w * 0.3)} ${f(fh)} M ${f(cx)} ${f(hip)} L ${f(cx + w * 0.3)} ${f(fh)}`,
        },
      ];
    }
    case 'text':
      return [];
  }
}

/** 文字区域（相对节点左上角），用于居中排版与导出 */
export function labelBox(shape: ShapeType, w: number, h: number) {
  switch (shape) {
    case 'actor':
      return { x: -20, y: h * 0.74, width: w + 40, height: h * 0.26, align: 'center' as const, valign: 'top' as const };
    case 'group':
      return { x: 14, y: 10, width: w - 28, height: 24, align: 'left' as const, valign: 'top' as const };
    case 'diamond':
      return { x: w * 0.18, y: h * 0.18, width: w * 0.64, height: h * 0.64, align: 'center' as const, valign: 'middle' as const };
    case 'cylinder': {
      const ry = Math.min(h * 0.14, 14);
      return { x: 8, y: ry * 2, width: w - 16, height: h - ry * 3, align: 'center' as const, valign: 'middle' as const };
    }
    case 'document':
      return { x: 8, y: 4, width: w - 16, height: h - 18, align: 'center' as const, valign: 'middle' as const };
    case 'triangle':
      return { x: w * 0.2, y: h * 0.4, width: w * 0.6, height: h * 0.56, align: 'center' as const, valign: 'middle' as const };
    case 'hexagon':
    case 'parallelogram':
      return { x: w * 0.14, y: 4, width: w * 0.72, height: h - 8, align: 'center' as const, valign: 'middle' as const };
    case 'cloud':
      return { x: w * 0.14, y: h * 0.22, width: w * 0.72, height: h * 0.62, align: 'center' as const, valign: 'middle' as const };
    default:
      return { x: 8, y: 4, width: w - 16, height: h - 8, align: 'center' as const, valign: 'middle' as const };
  }
}

/** 粗略估算文字宽度：中日韩字符按 1em，其余按 0.58em */
export function textWidth(s: string, fontSize: number): number {
  let w = 0;
  for (const ch of s) w += /[⺀-￿]/.test(ch) ? fontSize : fontSize * 0.58;
  return w;
}

/** 按宽度折行（保留显式换行），导出 SVG 时使用 */
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (line && textWidth(line + ch, fontSize) > maxWidth) {
        // 尽量在空格处断开英文单词
        const sp = line.lastIndexOf(' ');
        if (ch !== ' ' && sp > 0 && /[A-Za-z0-9]/.test(ch)) {
          out.push(line.slice(0, sp));
          line = line.slice(sp + 1) + ch;
        } else {
          out.push(line);
          line = ch === ' ' ? '' : ch;
        }
      } else line += ch;
    }
    out.push(line);
  }
  return out;
}

/** 根据文字估算一个合适的节点尺寸（AI 没给尺寸时使用） */
export function autoSize(shape: ShapeType, label: string, fontSize: number, hasIcon: boolean): [number, number] {
  const [dw, dh] = SHAPE_META[shape].size;
  if (shape === 'group' || shape === 'actor' || shape === 'circle') return [dw, dh];
  const lines = label.split('\n');
  const longest = Math.max(0, ...lines.map((l) => textWidth(l, fontSize)));
  const inner = Math.min(Math.max(longest, 60), 240);
  const wrapped = lines.reduce((n, l) => n + Math.max(1, Math.ceil(textWidth(l, fontSize) / 240)), 0);
  let w = inner + 44;
  let h = Math.max(dh, wrapped * fontSize * 1.4 + 30 + (hasIcon ? 30 : 0));
  if (shape === 'diamond') {
    w = Math.max(dw, inner * 1.55 + 30);
    h = Math.max(dh, h * 1.5);
  } else if (shape === 'ellipse' || shape === 'cloud') {
    w = Math.max(dw, w * 1.25);
    h = Math.max(dh, h * 1.15);
  } else if (shape === 'hexagon' || shape === 'parallelogram') {
    w = Math.max(dw, w * 1.2);
  } else if (shape === 'text') {
    w = Math.max(60, longest + 16);
    h = Math.max(28, wrapped * fontSize * 1.4 + 10);
  } else {
    w = Math.max(dw * 0.75, w);
  }
  return [Math.round(w / 10) * 10, Math.round(h / 10) * 10];
}
