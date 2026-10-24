import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { depthOf } from './convert';
import { ICONS } from './icons';
import { textWidth, wrapText } from './shapes';
import { edgeStyle, nodeStyle, type Diagram, type DiagramEdge, type DiagramNode } from './types';

// 3D（等轴测 2.5D）渲染：沿用 2D 的平面坐标作为"地面"，按图形挤出成立体并投影成 SVG。
// 画布交互与导出共用这一份几何。坐标约定：世界 (x, y) = 2D 坐标，z 向上；
// 先绕原点按 90° 步进旋转（R 空间），再做等轴测投影。

export type Rot = 0 | 1 | 2 | 3;
type P2 = [number, number];
type P3 = [number, number, number];

const C = Math.cos(Math.PI / 6);
const S = 0.5;
/** 等轴测下球体的屏幕半径系数 */
const SPHERE_K = Math.sqrt(1.5);
const FONT = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif";

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number) => String(Math.round(n * 10) / 10);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function rotate(x: number, y: number, rot: Rot): P2 {
  switch (rot) {
    case 1:
      return [-y, x];
    case 2:
      return [-x, -y];
    case 3:
      return [y, -x];
    default:
      return [x, y];
  }
}

function unrotate(x: number, y: number, rot: Rot): P2 {
  switch (rot) {
    case 1:
      return [y, -x];
    case 2:
      return [-x, -y];
    case 3:
      return [-y, x];
    default:
      return [x, y];
  }
}

export function project(x: number, y: number, z: number, rot: Rot): P2 {
  const [rx, ry] = rotate(x, y, rot);
  return [(rx - ry) * C, (rx + ry) * S - z];
}

/** 屏幕位移 → 地面（z 不变）上的世界位移；线性映射，也可用于绝对坐标（z=0） */
export function unproject(sx: number, sy: number, rot: Rot): P2 {
  const rx = (sx / C + sy / S) / 2;
  const ry = (sy / S - sx / C) / 2;
  return unrotate(rx, ry, rot);
}

const depthKey = (x: number, y: number, rot: Rot) => {
  const [rx, ry] = rotate(x, y, rot);
  return rx + ry;
};

// ---------- 颜色 ----------

function rgb(c: string): [number, number, number] | null {
  const s = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  if (s === 'white') return [255, 255, 255];
  if (s === 'black') return [0, 0, 0];
  return null;
}

function mix(c: string, to: [number, number, number], t: number): string {
  const a = rgb(c) ?? [255, 255, 255];
  const v = a.map((x, i) => Math.round(x + (to[i] - x) * t));
  return '#' + v.map((x) => clamp(x, 0, 255).toString(16).padStart(2, '0')).join('');
}
const shade = (c: string, t: number) => mix(c, [0, 0, 0], t);
const tint = (c: string, t: number) => mix(c, [255, 255, 255], t);
const isNone = (c: string) => !c || c === 'none' || c === 'transparent';

// ---------- 轮廓（世界坐标多边形） ----------

function rectPoly(x: number, y: number, w: number, h: number): P2[] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

function roundRectPoly(x: number, y: number, w: number, h: number, r: number): P2[] {
  r = Math.min(r, w / 2, h / 2);
  if (r < 1) return rectPoly(x, y, w, h);
  const out: P2[] = [];
  const corners: [number, number, number][] = [
    [x + w - r, y + r, -90],
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, 90],
    [x + r, y + r, 180],
  ];
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= 4; i++) {
      const a = ((a0 + (i * 90) / 4) * Math.PI) / 180;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  return out;
}

function ellipsePoly(cx: number, cy: number, rx: number, ry: number, n = 40): P2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as P2;
  });
}

const CLOUD =
  'M 25 92 C 8 92 0 76 8 64 C 0 50 10 32 26 36 C 28 16 50 6 62 20 C 72 6 94 12 92 34 C 102 40 102 62 90 70 C 96 86 80 96 68 90 C 60 98 38 100 25 92 Z';

function cloudPoly(x: number, y: number, w: number, h: number): P2[] {
  const nums = CLOUD.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const pts: P2[] = [];
  let px = nums[0];
  let py = nums[1];
  for (let i = 2; i + 5 < nums.length; i += 6) {
    const [c1x, c1y, c2x, c2y, ex, ey] = nums.slice(i, i + 6);
    for (let k = 1; k <= 6; k++) {
      const t = k / 6;
      const u = 1 - t;
      pts.push([
        u * u * u * px + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
        u * u * u * py + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
      ]);
    }
    px = ex;
    py = ey;
  }
  return pts.map(([a, b]) => [x + (a * w) / 100, y + (b * h) / 100]);
}

function shapePoly(n: DiagramNode): P2[] {
  const { x, y, width: w, height: h } = n;
  switch (n.shape) {
    case 'rect':
      return rectPoly(x, y, w, h);
    case 'rounded':
      return roundRectPoly(x, y, w, h, Math.min(14, h / 3.2));
    case 'group':
      return roundRectPoly(x, y, w, h, 16);
    case 'note':
      return [
        [x, y],
        [x + w - 14, y],
        [x + w, y + 14],
        [x + w, y + h],
        [x, y + h],
      ];
    case 'ellipse':
      return ellipsePoly(x + w / 2, y + h / 2, w / 2, h / 2);
    case 'diamond': {
      // 平面上的正方形在等轴测下正好呈菱形，判断节点保持菱形外观
      const a = Math.min(w, h) * 0.8;
      return rectPoly(x + (w - a) / 2, y + (h - a) / 2, a, a);
    }
    case 'cylinder': {
      const r = Math.min(w, h) / 2;
      return ellipsePoly(x + w / 2, y + h / 2, r, r);
    }
    case 'parallelogram': {
      const s = Math.min(w * 0.18, h * 0.6);
      return [
        [x + s, y],
        [x + w, y],
        [x + w - s, y + h],
        [x, y + h],
      ];
    }
    case 'hexagon': {
      const s = Math.min(w * 0.2, h * 0.5);
      return [
        [x + s, y],
        [x + w - s, y],
        [x + w, y + h / 2],
        [x + w - s, y + h],
        [x + s, y + h],
        [x, y + h / 2],
      ];
    }
    case 'document': {
      const wv = Math.min(h * 0.12, 12);
      const pts: P2[] = [
        [x, y],
        [x + w, y],
      ];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        pts.push([x + w * (1 - t), y + h - wv - 0.8 * wv * Math.sin(2 * Math.PI * t)]);
      }
      return pts;
    }
    case 'cloud':
      return cloudPoly(x, y, w, h);
    default:
      return rectPoly(x, y, w, h);
  }
}

/** 各图形的默认立体高度 */
function defaultDepth(n: DiagramNode): number {
  switch (n.shape) {
    case 'group':
      return 10;
    case 'note':
      return 6;
    case 'text':
      return 0;
    case 'cylinder':
      return clamp(n.height * 0.8, 40, 120);
    case 'cloud':
      return 26;
    case 'document':
      return 14;
    default:
      return 24;
  }
}

// ---------- 画笔 ----------

interface Paint {
  fill: string;
  stroke: string;
  sw?: number;
  dashed?: boolean;
}

class Pen {
  out: string[] = [];
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  constructor(
    public rot: Rot,
    private ids: { n: number; p: string },
  ) {}

  uid(prefix: string) {
    return `${this.ids.p}${prefix}${++this.ids.n}`;
  }
  grow(x: number, y: number) {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
  }
  /** 世界坐标 → 屏幕 */
  P(x: number, y: number, z: number): P2 {
    const p = project(x, y, z, this.rot);
    this.grow(p[0], p[1]);
    return p;
  }
  /** R 空间坐标 → 屏幕 */
  Q(rx: number, ry: number, z: number): P2 {
    const p: P2 = [(rx - ry) * C, (rx + ry) * S - z];
    this.grow(p[0], p[1]);
    return p;
  }
  pts(list: P2[]) {
    return list.map(([a, b]) => `${f(a)},${f(b)}`).join(' ');
  }
  poly(list: P2[], fill: string, stroke = 'none', sw = 1, extra = '') {
    this.out.push(
      `<polygon points="${this.pts(list)}" fill="${fill}" stroke="${stroke}" stroke-width="${f(sw)}" stroke-linejoin="round"${extra}/>`,
    );
  }
  line(a: P2, b: P2, stroke: string, sw = 1, extra = '') {
    this.out.push(`<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${stroke}" stroke-width="${f(sw)}" stroke-linecap="round"${extra}/>`);
  }
  /** 世界法向量是否朝向观察者 */
  visible(nx: number, ny: number) {
    const [a, b] = rotate(nx, ny, this.rot);
    return a + b > 1e-6;
  }

  /** 把多边形挤出成柱体：可见侧面按朝向明暗着色，顶面原色，再描出轮廓 */
  prism(poly: P2[], z0: number, h: number, p: Paint) {
    const pts = poly.map(([x, y]) => rotate(x, y, this.rot));
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (area < 0) pts.reverse();
    const n = pts.length;
    const z1 = z0 + h;
    const sw = p.sw ?? 1;
    const dash = p.dashed ? ' stroke-dasharray="6 4"' : '';
    const transparent = isNone(p.fill);
    const noStroke = isNone(p.stroke);

    const vis: boolean[] = [];
    const faces: { i: number; key: number; nx: number; ny: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = dy / len;
      const ny = -dx / len;
      const v = h > 0 && nx + ny > 1e-6;
      vis.push(v);
      if (v) faces.push({ i, key: a[0] + a[1] + b[0] + b[1], nx, ny });
    }
    faces.sort((a, b) => a.key - b.key);
    if (!transparent)
      for (const fc of faces) {
        const a = pts[fc.i];
        const b = pts[(fc.i + 1) % n];
        const col = shade(p.fill, 0.08 + 0.1 * fc.nx * fc.nx + 0.3 * fc.ny * fc.ny);
        this.poly([this.Q(a[0], a[1], z0), this.Q(b[0], b[1], z0), this.Q(b[0], b[1], z1), this.Q(a[0], a[1], z1)], col, col, 0.6);
      }
    this.poly(
      pts.map(([a, b]) => this.Q(a, b, z1)),
      transparent ? 'none' : p.fill,
      noStroke ? 'none' : p.stroke,
      sw,
      dash,
    );
    if (noStroke || h <= 0) return;
    // 轮廓：可见侧面的底边 + 轮廓线 / 棱角处的竖线
    let d = '';
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (vis[i]) {
        const [x1, y1] = this.Q(a[0], a[1], z0);
        const [x2, y2] = this.Q(b[0], b[1], z0);
        d += `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
      }
      const prev = (i - 1 + n) % n;
      const pa = pts[prev];
      const e1x = a[0] - pa[0];
      const e1y = a[1] - pa[1];
      const e2x = b[0] - a[0];
      const e2y = b[1] - a[1];
      const cos = (e1x * e2x + e1y * e2y) / ((Math.hypot(e1x, e1y) || 1) * (Math.hypot(e2x, e2y) || 1));
      const silhouette = vis[prev] !== vis[i];
      if (silhouette || (vis[prev] && vis[i] && cos < 0.9)) {
        const [x1, y1] = this.Q(a[0], a[1], z0);
        const [, y2] = this.Q(a[0], a[1], z1);
        d += `M${f(x1)} ${f(y1)}L${f(x1)} ${f(y2)}`;
      }
    }
    if (d) this.out.push(`<path d="${d}" fill="none" stroke="${p.stroke}" stroke-width="${f(sw * 0.85)}" stroke-linecap="round"${dash}/>`);
  }

  box(x: number, y: number, z: number, w: number, d: number, h: number, p: Paint) {
    this.prism(rectPoly(x, y, w, d), z, h, p);
  }
  rbox(x: number, y: number, z: number, w: number, d: number, h: number, r: number, p: Paint) {
    this.prism(roundRectPoly(x, y, w, d, r), z, h, p);
  }
  cyl(cx: number, cy: number, z: number, rx: number, ry: number, h: number, p: Paint) {
    this.prism(ellipsePoly(cx, cy, rx, ry, 36), z, h, p);
  }

  sphere(cx: number, cy: number, z: number, r: number, fill: string, stroke: string) {
    const [sx, sy] = this.P(cx, cy, z + r);
    const R = r * SPHERE_K;
    this.grow(sx - R, sy - R);
    this.grow(sx + R, sy + R);
    const id = this.uid('isg');
    this.out.push(
      `<defs><radialGradient id="${id}" cx="38%" cy="32%" r="72%"><stop offset="0" stop-color="${tint(fill, 0.55)}"/><stop offset="0.55" stop-color="${fill}"/><stop offset="1" stop-color="${shade(fill, 0.32)}"/></radialGradient></defs>` +
        `<circle cx="${f(sx)}" cy="${f(sy)}" r="${f(R)}" fill="url(#${id})"${isNone(stroke) ? '' : ` stroke="${stroke}" stroke-width="1"`}/>`,
    );
  }

  /** 地面上的柔和投影 */
  shadow(poly: P2[], z: number) {
    const pts = poly.map(([x, y]) => {
      const [a, b] = this.P(x, y, z);
      return [a + 5, b + 7] as P2;
    });
    this.poly(pts, '#000', 'none', 0, ' fill-opacity="0.12" filter="url(#iso-soft)"');
  }

  /** 平铺在水平面上的内容（R 空间的 x / y 轴），返回 SVG transform */
  planeMatrix(rx: number, ry: number, z: number) {
    const [ox, oy] = this.Q(rx, ry, z);
    return `matrix(${C.toFixed(4)} ${S} ${(-C).toFixed(4)} ${S} ${f(ox)} ${f(oy)})`;
  }

  /** 把图标"印"在 z 高度的水平面上，中心为世界坐标 (cx, cy) */
  decal(icon: string, cx: number, cy: number, z: number, size: number, color: string) {
    const I = ICONS[icon]?.icon;
    if (!I) return;
    const [rx, ry] = rotate(cx, cy, this.rot);
    const svg = renderToStaticMarkup(createElement(I, { size, color, strokeWidth: 1.8 }));
    this.out.push(`<g transform="${this.planeMatrix(rx - size / 2, ry - size / 2, z)}">${svg}</g>`);
  }

  /** 水平面上的折线（世界坐标） */
  floorPath(pts: P2[], z: number, stroke: string, sw = 1, extra = '') {
    const s = pts.map(([x, y]) => this.P(x, y, z));
    this.out.push(`<polyline points="${this.pts(s)}" fill="none" stroke="${stroke}" stroke-width="${f(sw)}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`);
  }

  /** 竖直面上的横线：沿 box 的可见侧面画一圈 */
  faceBands(x: number, y: number, w: number, d: number, zs: number[], stroke: string, sw = 1) {
    const faces: [P2, P2, number, number][] = [
      [[x, y], [x + w, y], 0, -1],
      [[x + w, y], [x + w, y + d], 1, 0],
      [[x + w, y + d], [x, y + d], 0, 1],
      [[x, y + d], [x, y], -1, 0],
    ];
    for (const [a, b, nx, ny] of faces) {
      if (!this.visible(nx, ny)) continue;
      for (const z of zs) this.line(this.P(a[0], a[1], z), this.P(b[0], b[1], z), stroke, sw);
    }
  }

  /** 最朝向观察者的竖直面：返回面上一点的映射函数 (u∈[0,1] 沿面, z) */
  frontFace(x: number, y: number, w: number, d: number) {
    const faces: [P2, P2, number, number][] = [
      [[x, y], [x + w, y], 0, -1],
      [[x + w, y], [x + w, y + d], 1, 0],
      [[x + w, y + d], [x, y + d], 0, 1],
      [[x, y + d], [x, y], -1, 0],
    ];
    let best = faces[0];
    let score = -Infinity;
    for (const fc of faces) {
      const [a, b] = rotate(fc[2], fc[3], this.rot);
      // 偏向左侧面（屏幕上更宽的那面），视觉更稳定
      const s = a + b + b * 0.01;
      if (s > score) (score = s), (best = fc);
    }
    const [a, b] = best;
    // 让 u 从屏幕左到右
    const left = this.P(a[0], a[1], 0)[0] <= this.P(b[0], b[1], 0)[0];
    const [p0, p1] = left ? [a, b] : [b, a];
    return (u: number, z: number) => this.P(p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u, z);
  }
}

// ---------- 3D 素材 ----------

interface AssetCtx {
  pen: Pen;
  /** 节点中心（世界坐标） */
  cx: number;
  cy: number;
  z: number;
  /** 素材基准尺寸 */
  s: number;
  /** 高度缩放（style.depth） */
  k: number;
  fill?: string;
  stroke?: string;
  accent: string;
}

type Asset = { name: string; draw(c: AssetCtx): P2[] };

const SCREEN = '#1c2633';
const GLOW = '#3d8bfd';
const LED = '#30d158';

/** 以 (cx, cy) 为中心的 w×d 矩形左上角 */
const at = (c: AssetCtx, w: number, d: number): [number, number] => [c.cx - w / 2, c.cy - d / 2];

function figure(pen: Pen, x: number, y: number, z: number, s: number, body: string, stroke: string) {
  const r = s * 0.16;
  pen.cyl(x, y, z, r, r, s * 0.42, { fill: body, stroke: shade(body, 0.35), sw: 0.8 });
  pen.sphere(x, y, z + s * 0.42 + 2, s * 0.13, '#f3cfae', stroke);
}

const ASSET_LIST: Record<string, Asset> = {
  server: {
    name: '服务器',
    draw(c) {
      const w = c.s * 0.6;
      const H = c.s * 1.15 * c.k;
      const [x, y] = at(c, w, w);
      const body = c.fill ?? '#dfe5ec';
      const stroke = c.stroke ?? '#596878';
      c.pen.box(x, y, c.z, w, w, H, { fill: body, stroke, sw: 1 });
      const bays = 4;
      c.pen.faceBands(x, y, w, w, Array.from({ length: bays - 1 }, (_, i) => c.z + (H * (i + 1)) / bays), shade(body, 0.35), 0.8);
      const face = c.pen.frontFace(x, y, w, w);
      for (let i = 0; i < bays; i++) {
        const zz = c.z + (H * (i + 0.5)) / bays;
        c.pen.line(face(0.14, zz), face(0.56, zz), shade(body, 0.45), 2.2);
        const [lx, ly] = face(0.8, zz);
        c.pen.out.push(`<circle cx="${f(lx)}" cy="${f(ly)}" r="1.8" fill="${i === 1 ? c.accent : LED}"/>`);
      }
      return rectPoly(x, y, w, w);
    },
  },
  database: {
    name: '数据库',
    draw(c) {
      const r = c.s * 0.36;
      const fill = c.fill ?? '#d6e6fb';
      const stroke = c.stroke ?? '#2f6fbd';
      const disc = (c.s * 0.26 * c.k) | 0;
      for (let i = 0; i < 3; i++) c.pen.cyl(c.cx, c.cy, c.z + i * (disc + 4), r, r, disc, { fill: i === 2 ? tint(fill, 0.2) : fill, stroke, sw: 1 });
      return ellipsePoly(c.cx, c.cy, r, r, 24);
    },
  },
  storage: {
    name: '存储',
    draw(c) {
      const w = c.s * 0.95;
      const d = c.s * 0.55;
      const [x, y] = at(c, w, d);
      const fill = c.fill ?? '#e4e8ee';
      const stroke = c.stroke ?? '#5d6b7a';
      const h = c.s * 0.2 * c.k;
      for (let i = 0; i < 2; i++) {
        const z = c.z + i * (h + 3);
        c.pen.box(x, y, z, w, d, h, { fill, stroke, sw: 1 });
        const face = c.pen.frontFace(x, y, w, d);
        c.pen.line(face(0.1, z + h / 2), face(0.6, z + h / 2), shade(fill, 0.4), 2);
        const [lx, ly] = face(0.85, z + h / 2);
        c.pen.out.push(`<circle cx="${f(lx)}" cy="${f(ly)}" r="1.7" fill="${LED}"/>`);
      }
      return rectPoly(x, y, w, d);
    },
  },
  cloud: {
    name: '云',
    draw(c) {
      const w = c.s * 1.3;
      const d = c.s * 0.85;
      const [x, y] = at(c, w, d);
      const poly = cloudPoly(x, y, w, d);
      c.pen.prism(poly, c.z, 24 * c.k, { fill: c.fill ?? '#eaf3fd', stroke: c.stroke ?? '#6f9fd8', sw: 1.1 });
      return poly;
    },
  },
  user: {
    name: '用户',
    draw(c) {
      figure(c.pen, c.cx, c.cy, c.z, c.s * c.k, c.fill ?? '#4f8ef7', c.stroke ?? '#2d5fa8');
      return ellipsePoly(c.cx, c.cy, c.s * 0.18, c.s * 0.18, 16);
    },
  },
  users: {
    name: '用户组',
    draw(c) {
      const o = c.s * 0.26;
      const spots: P2[] = [
        [c.cx - o, c.cy - o * 0.4],
        [c.cx + o * 0.4, c.cy - o],
        [c.cx + o * 0.3, c.cy + o * 0.5],
      ];
      spots.sort((a, b) => depthKey(a[0], a[1], c.pen.rot) - depthKey(b[0], b[1], c.pen.rot));
      const cols = [c.fill ?? '#4f8ef7', '#34c759', '#ff9f0a'];
      spots.forEach(([x, y], i) => figure(c.pen, x, y, c.z, c.s * 0.85 * c.k, cols[i % 3], c.stroke ?? '#2d5fa8'));
      return ellipsePoly(c.cx, c.cy, c.s * 0.45, c.s * 0.45, 20);
    },
  },
  monitor: {
    name: '显示器',
    draw(c) {
      const w = c.s * 0.95;
      const fill = c.fill ?? '#e9ecf0';
      const stroke = c.stroke ?? '#5b6573';
      const [bx, by] = at(c, c.s * 0.34, c.s * 0.24);
      c.pen.box(bx, by, c.z, c.s * 0.34, c.s * 0.24, 3, { fill, stroke, sw: 0.8 });
      c.pen.box(c.cx - 3, c.cy - 3, c.z + 3, 6, 6, c.s * 0.2, { fill: shade(fill, 0.1), stroke, sw: 0.8 });
      const H = c.s * 0.6 * c.k;
      const z = c.z + 3 + c.s * 0.2;
      const [x, y] = at(c, w, 6);
      c.pen.box(x, y, z, w, 6, H, { fill, stroke, sw: 1 });
      screenOn(c.pen, x, y, w, 6, z, H);
      return rectPoly(x, by, w, c.s * 0.24);
    },
  },
  laptop: {
    name: '电脑',
    draw(c) {
      const w = c.s * 1.0;
      const d = c.s * 0.62;
      const [x, y] = at(c, w, d);
      const fill = c.fill ?? '#d9dde3';
      const stroke = c.stroke ?? '#5b6573';
      c.pen.rbox(x, y, c.z, w, d, 4, 4, { fill, stroke, sw: 1 });
      // 键盘区
      const kb = [x + w * 0.1, y + d * 0.42, w * 0.8, d * 0.42] as const;
      c.pen.poly(rectPoly(...kb).map(([a, b]) => c.pen.P(a, b, c.z + 4)), shade(fill, 0.18));
      const H = c.s * 0.58 * c.k;
      c.pen.box(x, y, c.z + 4, w, 4, H, { fill, stroke, sw: 1 });
      screenOn(c.pen, x, y, w, 4, c.z + 4, H);
      return rectPoly(x, y, w, d);
    },
  },
  smartphone: {
    name: '手机',
    draw(c) {
      const w = c.s * 0.48;
      const d = c.s * 0.86;
      const [x, y] = at(c, w, d);
      c.pen.rbox(x, y, c.z, w, d, 6 * c.k, 7, { fill: c.fill ?? '#2b2f36', stroke: c.stroke ?? '#15181c', sw: 1 });
      const inset = roundRectPoly(x + 3, y + 5, w - 6, d - 10, 4).map(([a, b]) => c.pen.P(a, b, c.z + 6 * c.k));
      const id = c.pen.uid('isc');
      c.pen.out.push(
        `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6aa8ff"/><stop offset="1" stop-color="#2b5cc8"/></linearGradient></defs>`,
      );
      c.pen.poly(inset, `url(#${id})`);
      return rectPoly(x, y, w, d);
    },
  },
  globe: {
    name: '网络/网站',
    draw(c) {
      const r = c.s * 0.38 * c.k;
      const fill = c.fill ?? '#5aaef5';
      c.pen.sphere(c.cx, c.cy, c.z, r, fill, c.stroke ?? '#1f6fb8');
      const ring = ellipsePoly(c.cx, c.cy, r, r, 32).map(([a, b]) => c.pen.P(a, b, c.z + r));
      c.pen.poly(ring, 'none', '#ffffff', 1, ' stroke-opacity="0.7"');
      const [sx, sy] = c.pen.P(c.cx, c.cy, c.z + r);
      const R = r * SPHERE_K;
      c.pen.out.push(`<ellipse cx="${f(sx)}" cy="${f(sy)}" rx="${f(R * 0.42)}" ry="${f(R)}" fill="none" stroke="#ffffff" stroke-opacity="0.7"/>`);
      c.pen.line([sx, sy - R], [sx, sy + R], '#ffffff', 1, ' stroke-opacity="0.55"');
      return ellipsePoly(c.cx, c.cy, r, r, 24);
    },
  },
  package: {
    name: '包',
    draw(c) {
      const w = c.s * 0.62;
      const [x, y] = at(c, w, w);
      const H = c.s * 0.5 * c.k;
      const fill = c.fill ?? '#e5bf86';
      c.pen.box(x, y, c.z, w, w, H, { fill, stroke: c.stroke ?? '#9a6c33', sw: 1 });
      const tape = shade(fill, 0.22);
      c.pen.poly(rectPoly(x + w * 0.42, y, w * 0.16, w).map(([a, b]) => c.pen.P(a, b, c.z + H)), tape);
      return rectPoly(x, y, w, w);
    },
  },
  container: {
    name: '容器',
    draw(c) {
      const w = c.s * 1.15;
      const d = c.s * 0.48;
      const [x, y] = at(c, w, d);
      const H = c.s * 0.44 * c.k;
      const fill = c.fill ?? '#3f86d4';
      c.pen.box(x, y, c.z, w, d, H, { fill, stroke: c.stroke ?? '#1f4f86', sw: 1 });
      const face = c.pen.frontFace(x, y, w, d);
      for (let i = 1; i < 10; i++) c.pen.line(face(i / 10, c.z + 3), face(i / 10, c.z + H - 3), shade(fill, 0.35), 1);
      return rectPoly(x, y, w, d);
    },
  },
  cpu: {
    name: '计算',
    draw(c) {
      const w = c.s * 0.6;
      const [x, y] = at(c, w, w);
      const fill = c.fill ?? '#3a404a';
      const pin = '#c9a24a';
      const n = 4;
      for (let i = 0; i < n; i++) {
        const t = x + (w * (i + 0.5)) / n - 2;
        const u = y + (w * (i + 0.5)) / n - 2;
        c.pen.box(t, y - 6, c.z, 4, 6, 2, { fill: pin, stroke: 'none' });
        c.pen.box(t, y + w, c.z, 4, 6, 2, { fill: pin, stroke: 'none' });
        c.pen.box(x - 6, u, c.z, 6, 4, 2, { fill: pin, stroke: 'none' });
        c.pen.box(x + w, u, c.z, 6, 4, 2, { fill: pin, stroke: 'none' });
      }
      const H = 8 * c.k;
      c.pen.box(x, y, c.z, w, w, H, { fill, stroke: c.stroke ?? '#1d2026', sw: 1 });
      c.pen.poly(rectPoly(x + w * 0.25, y + w * 0.25, w * 0.5, w * 0.5).map(([a, b]) => c.pen.P(a, b, c.z + H)), tint(fill, 0.25));
      return rectPoly(x - 6, y - 6, w + 12, w + 12);
    },
  },
  router: {
    name: '路由器',
    draw(c) {
      const w = c.s * 0.9;
      const d = c.s * 0.48;
      const [x, y] = at(c, w, d);
      const H = c.s * 0.16 * c.k;
      const fill = c.fill ?? '#eef0f3';
      const stroke = c.stroke ?? '#5b6573';
      for (const ax of [x + w * 0.15, x + w * 0.85]) c.pen.cyl(ax, y + d * 0.2, c.z + H, 2, 2, c.s * 0.4, { fill: '#4a525c', stroke: 'none' });
      c.pen.rbox(x, y, c.z, w, d, H, 4, { fill, stroke, sw: 1 });
      const face = c.pen.frontFace(x, y, w, d);
      for (let i = 0; i < 4; i++) {
        const [lx, ly] = face(0.2 + i * 0.12, c.z + H / 2);
        c.pen.out.push(`<circle cx="${f(lx)}" cy="${f(ly)}" r="1.6" fill="${i < 3 ? LED : c.accent}"/>`);
      }
      return rectPoly(x, y, w, d);
    },
  },
  network: {
    name: '网络',
    draw(c) {
      const w = c.s * 1.1;
      const d = c.s * 0.45;
      const [x, y] = at(c, w, d);
      const H = c.s * 0.16 * c.k;
      const fill = c.fill ?? '#e3e7ec';
      c.pen.box(x, y, c.z, w, d, H, { fill, stroke: c.stroke ?? '#56616e', sw: 1 });
      const face = c.pen.frontFace(x, y, w, d);
      for (let i = 0; i < 8; i++) {
        const u = 0.08 + i * 0.1;
        const a = face(u, c.z + H * 0.3);
        const b = face(u + 0.06, c.z + H * 0.3);
        const e = face(u + 0.06, c.z + H * 0.72);
        const g = face(u, c.z + H * 0.72);
        c.pen.poly([a, b, e, g], '#2f353d');
      }
      return rectPoly(x, y, w, d);
    },
  },
  message: {
    name: '消息队列',
    draw(c) {
      const w = c.s * 0.85;
      const d = c.s * 0.52;
      const [x, y] = at(c, w, d);
      const fill = c.fill ?? '#ffd27a';
      const h = 7 * c.k;
      for (let i = 0; i < 3; i++)
        c.pen.rbox(x, y, c.z + i * (h + 4), w, d, h, 4, { fill: i === 2 ? fill : shade(fill, 0.06 * (2 - i)), stroke: c.stroke ?? '#b07d16', sw: 1 });
      return rectPoly(x, y, w, d);
    },
  },
  mail: {
    name: '邮件',
    draw(c) {
      const w = c.s * 0.9;
      const d = c.s * 0.58;
      const [x, y] = at(c, w, d);
      const H = 6 * c.k;
      const fill = c.fill ?? '#ffffff';
      const stroke = c.stroke ?? '#8a94a3';
      c.pen.box(x, y, c.z, w, d, H, { fill, stroke, sw: 1 });
      c.pen.floorPath(
        [
          [x, y],
          [x + w / 2, y + d * 0.55],
          [x + w, y],
        ],
        c.z + H,
        stroke,
        1.1,
      );
      return rectPoly(x, y, w, d);
    },
  },
  file: {
    name: '文件',
    draw(c) {
      const w = c.s * 0.62;
      const d = c.s * 0.82;
      const [x, y] = at(c, w, d);
      const fill = c.fill ?? '#ffffff';
      const stroke = c.stroke ?? '#8a94a3';
      for (let i = 0; i < 3; i++) c.pen.box(x - i * 3, y + i * 3, c.z + (2 - i) * 3, w, d, 3, { fill: shade(fill, 0.04 * i), stroke, sw: 0.8 });
      const z = c.z + 9;
      for (let i = 0; i < 4; i++) {
        const ly = y + d * (0.2 + i * 0.16);
        c.pen.floorPath(
          [
            [x + w * 0.15, ly],
            [x + w * (i === 3 ? 0.55 : 0.85), ly],
          ],
          z,
          '#b7c0cc',
          1.4,
        );
      }
      return rectPoly(x - 6, y, w + 6, d + 6);
    },
  },
  folder: {
    name: '文件夹',
    draw(c) {
      const w = c.s * 0.9;
      const d = c.s * 0.62;
      const [x, y] = at(c, w, d);
      const H = c.s * 0.24 * c.k;
      const fill = c.fill ?? '#f6c950';
      const stroke = c.stroke ?? '#b8861a';
      c.pen.box(x, y, c.z, w, d * 0.4, H + 5, { fill: shade(fill, 0.08), stroke, sw: 1 });
      c.pen.box(x, y, c.z, w, d, H, { fill, stroke, sw: 1 });
      return rectPoly(x, y, w, d);
    },
  },
  building: {
    name: '机构',
    draw(c) {
      const w = c.s * 0.58;
      const [x, y] = at(c, w, w);
      const H = c.s * 1.25 * c.k;
      const fill = c.fill ?? '#c9d6e6';
      c.pen.box(x, y, c.z, w, w, H, { fill, stroke: c.stroke ?? '#4d6380', sw: 1 });
      windows(c.pen, x, y, w, w, c.z, H, '#7fa7d6');
      return rectPoly(x, y, w, w);
    },
  },
  factory: {
    name: '工厂',
    draw(c) {
      const w = c.s * 1.0;
      const d = c.s * 0.6;
      const [x, y] = at(c, w, d);
      const H = c.s * 0.38 * c.k;
      const fill = c.fill ?? '#d8cfc4';
      const stroke = c.stroke ?? '#6e5b47';
      c.pen.cyl(x + w * 0.8, y + d * 0.3, c.z, 6, 6, H * 2.1, { fill: '#a89482', stroke, sw: 0.8 });
      c.pen.box(x, y, c.z, w, d, H, { fill, stroke, sw: 1 });
      windows(c.pen, x, y, w, d, c.z, H, '#8a7a6a');
      return rectPoly(x, y, w, d);
    },
  },
  store: {
    name: '商店',
    draw(c) {
      const w = c.s * 0.9;
      const d = c.s * 0.6;
      const [x, y] = at(c, w, d);
      const H = c.s * 0.45 * c.k;
      const fill = c.fill ?? '#fbe3d0';
      c.pen.box(x, y, c.z, w, d, H, { fill, stroke: c.stroke ?? '#a0613a', sw: 1 });
      c.pen.box(x - 3, y - 3, c.z + H, w + 6, d + 6, 5, { fill: c.accent, stroke: shade(c.accent, 0.3), sw: 1 });
      return rectPoly(x, y, w, d);
    },
  },
  home: {
    name: '主页',
    draw(c) {
      const w = c.s * 0.7;
      const d = c.s * 0.6;
      const [x, y] = at(c, w, d);
      const H = c.s * 0.42 * c.k;
      const wall = c.fill ?? '#f4ede2';
      const roof = c.accent;
      const stroke = c.stroke ?? '#7a5b3a';
      c.pen.box(x, y, c.z, w, d, H, { fill: wall, stroke, sw: 1 });
      // 双坡屋顶：屋脊沿世界 x 方向
      const zt = c.z + H;
      const zr = zt + d * 0.45;
      const e = 4;
      const ym = y + d / 2;
      const faces: { pts: P3[]; col: string }[] = [
        { pts: [[x - e, y - e, zt], [x + w + e, y - e, zt], [x + w + e, ym, zr], [x - e, ym, zr]], col: shade(roof, 0.12) },
        { pts: [[x - e, y + d + e, zt], [x + w + e, y + d + e, zt], [x + w + e, ym, zr], [x - e, ym, zr]], col: roof },
        { pts: [[x, y, zt], [x, y + d, zt], [x, ym, zr]], col: shade(wall, 0.2) },
        { pts: [[x + w, y, zt], [x + w, y + d, zt], [x + w, ym, zr]], col: shade(wall, 0.1) },
      ];
      const key = (p: P3[]) => p.reduce((a, q) => a + depthKey(q[0], q[1], c.pen.rot) + q[2] * 0.01, 0) / p.length;
      faces.sort((a, b) => key(a.pts) - key(b.pts));
      for (const fc of faces) c.pen.poly(fc.pts.map(([a, b, z]) => c.pen.P(a, b, z)), fc.col, stroke, 1);
      return rectPoly(x, y, w, d);
    },
  },
  layers: {
    name: '分层',
    draw(c) {
      const fill = c.fill ?? '#cfe1fb';
      const stroke = c.stroke ?? '#3b6fb6';
      for (let i = 0; i < 3; i++) {
        const w = c.s * (0.95 - i * 0.12);
        const [x, y] = at(c, w, w * 0.8);
        c.pen.rbox(x, y, c.z + i * 12 * c.k, w, w * 0.8, 5, 5, { fill: tint(fill, i * 0.2), stroke, sw: 1 });
      }
      return rectPoly(c.cx - c.s * 0.475, c.cy - c.s * 0.38, c.s * 0.95, c.s * 0.76);
    },
  },
};

ASSET_LIST.inbox = { ...ASSET_LIST.message, name: '队列/收件' };
ASSET_LIST.wifi = { ...ASSET_LIST.router, name: '无线' };
ASSET_LIST.box = { ...ASSET_LIST.package, name: '模块' };

/** 有专门 3D 模型的图标（其余图标在 3D 中显示为印有图标的立体方块） */
export const ISO_ASSETS = Object.keys(ASSET_LIST);

function screenOn(pen: Pen, x: number, y: number, w: number, d: number, z: number, H: number) {
  // 屏幕画在 box 的前后两个大面中可见的那个
  for (const [yy, ny] of [
    [y, -1],
    [y + d, 1],
  ] as const) {
    if (!pen.visible(0, ny)) continue;
    const pts: P2[] = [
      pen.P(x + w * 0.05, yy, z + H * 0.08),
      pen.P(x + w * 0.95, yy, z + H * 0.08),
      pen.P(x + w * 0.95, yy, z + H * 0.92),
      pen.P(x + w * 0.05, yy, z + H * 0.92),
    ];
    const id = pen.uid('isc');
    pen.out.push(
      `<defs><linearGradient id="${id}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${SCREEN}"/><stop offset="1" stop-color="${GLOW}"/></linearGradient></defs>`,
    );
    pen.poly(pts, `url(#${id})`);
  }
}

function windows(pen: Pen, x: number, y: number, w: number, d: number, z: number, H: number, col: string) {
  const rows = Math.max(1, Math.floor(H / 22));
  const faces: [P2, P2, number, number][] = [
    [[x, y], [x + w, y], 0, -1],
    [[x + w, y], [x + w, y + d], 1, 0],
    [[x + w, y + d], [x, y + d], 0, 1],
    [[x, y + d], [x, y], -1, 0],
  ];
  for (const [a, b, nx, ny] of faces) {
    if (!pen.visible(nx, ny)) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cols = Math.max(1, Math.floor(len / 18));
    const pt = (u: number, zz: number) => pen.P(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, zz);
    for (let r = 0; r < rows; r++)
      for (let k = 0; k < cols; k++) {
        const u0 = (k + 0.25) / cols;
        const u1 = (k + 0.75) / cols;
        const z0 = z + (H * (r + 0.3)) / rows;
        const z1 = z + (H * (r + 0.75)) / rows;
        pen.poly([pt(u0, z0), pt(u1, z0), pt(u1, z1), pt(u0, z1)], col);
      }
  }
}

// ---------- 场景 ----------

export interface IsoLayer {
  /** 节点图层的 id；连线、文字图层为 null */
  id: string | null;
  kind: 'group' | 'edge' | 'node' | 'labels';
  svg: string;
}

export interface IsoScene {
  defs: string;
  layers: IsoLayer[];
  bounds: { x: number; y: number; width: number; height: number };
}

export interface IsoOptions {
  rot: Rot;
  /** 地面文字颜色 / 文字描边（与背景同色） */
  ink: string;
  paper: string;
  selected?: Set<string>;
  /** 渐变等 id 的前缀：同一页面里有多个场景时避免冲突 */
  idPrefix?: string;
}

interface Label {
  x: number;
  y: number;
  lines: string[];
  fs: number;
  color: string;
  bold: boolean;
  halo: string;
  /** 文字块的垂直对齐：顶部或居中 */
  valign: 'top' | 'middle';
}

/** 节点立体高度：style.depth 优先 */
export function nodeDepth(n: DiagramNode) {
  return n.style.depth && n.style.depth > 0 ? n.style.depth : defaultDepth(n);
}

export function buildIsoScene(d: Diagram, o: IsoOptions): IsoScene {
  const ids = { n: 0, p: o.idPrefix ?? 'iso' };
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const nest = depthOf(d.nodes);
  const all = new Pen(o.rot, ids);

  // 节点所在平面高度：叠加所有祖先分组的平台厚度
  const baseMemo = new Map<string, number>();
  const baseZ = (n: DiagramNode, g = 0): number => {
    if (baseMemo.has(n.id)) return baseMemo.get(n.id)!;
    const p = n.parent ? byId.get(n.parent) : undefined;
    const z = p && g < 50 ? baseZ(p, g + 1) + nodeDepth(p) : 0;
    baseMemo.set(n.id, z);
    return z;
  };

  const key = (n: DiagramNode) => depthKey(n.x + n.width / 2, n.y + n.height / 2, o.rot);
  const groups = d.nodes.filter((n) => n.shape === 'group').sort((a, b) => nest.get(a.id)! - nest.get(b.id)! || key(a) - key(b));
  const others = d.nodes.filter((n) => n.shape !== 'group').sort((a, b) => key(a) - key(b));

  const layers: IsoLayer[] = [];
  const labels: Label[] = [];
  /** 分组标题：平铺在平台上，但放在最上层绘制，避免被立在前面的物体挡住 */
  const titles: string[] = [];
  const merge = (p: Pen) => {
    if (!isFinite(p.minX)) return; // 空图层
    all.grow(p.minX, p.minY);
    all.grow(p.maxX, p.maxY);
  };

  for (const n of groups) {
    const pen = new Pen(o.rot, ids);
    drawGroup(pen, n, baseZ(n), o, titles);
    merge(pen);
    layers.push({ id: n.id, kind: 'group', svg: pen.out.join('') });
  }

  const ep = new Pen(o.rot, ids);
  const rects = new Map(d.nodes.map((n) => [n.id, n]));
  for (const e of d.edges) drawEdge(ep, e, rects, baseZ, labels, o);
  merge(ep);
  layers.push({ id: null, kind: 'edge', svg: ep.out.join('') });

  for (const n of others) {
    const pen = new Pen(o.rot, ids);
    drawNode(pen, n, baseZ(n), labels, o);
    merge(pen);
    layers.push({ id: n.id, kind: 'node', svg: pen.out.join('') });
  }

  // 文字放在最上层，保证始终可读
  const lp = new Pen(o.rot, ids);
  lp.out.push(...titles);
  for (const l of labels) {
    const lh = l.fs * 1.32;
    const top = l.valign === 'middle' ? l.y - (l.lines.length * lh) / 2 : l.y;
    const w = Math.max(...l.lines.map((s) => textWidth(s, l.fs)));
    lp.grow(l.x - w / 2, top);
    lp.grow(l.x + w / 2, top + l.lines.length * lh);
    const tspans = l.lines.map((s, i) => `<tspan x="${f(l.x)}" y="${f(top + l.fs * 0.95 + i * lh)}">${esc(s) || ' '}</tspan>`).join('');
    lp.out.push(
      `<text font-family="${FONT}" font-size="${l.fs}" fill="${l.color}" text-anchor="middle"${l.bold ? ' font-weight="600"' : ''} stroke="${l.halo}" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${tspans}</text>`,
    );
  }
  merge(lp);
  layers.push({ id: null, kind: 'labels', svg: lp.out.join('') });

  const defs = `<filter id="iso-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter>`;
  const empty = !isFinite(all.minX);
  return {
    defs,
    layers,
    bounds: empty ? { x: 0, y: 0, width: 400, height: 300 } : { x: all.minX, y: all.minY, width: all.maxX - all.minX, height: all.maxY - all.minY },
  };
}

function selection(pen: Pen, poly: P2[], z: number, o: IsoOptions, id: string) {
  // 透明的命中区域（整个节点的占地），选中时显示为蓝色虚线
  const pts = poly.map(([x, y]) => pen.P(x, y, z));
  const sel = o.selected?.has(id);
  pen.poly(pts, sel ? 'rgba(0,113,227,0.08)' : 'transparent', sel ? '#0071e3' : 'none', 1.6, sel ? ' stroke-dasharray="5 4"' : '');
}

function drawGroup(pen: Pen, n: DiagramNode, z: number, o: IsoOptions, titles: string[]) {
  const st = nodeStyle(n.shape, n.style);
  const h = nodeDepth(n);
  const poly = shapePoly(n);
  pen.shadow(poly, z);
  selection(pen, poly, z, o, n.id);
  pen.prism(poly, z, h, { fill: st.fill, stroke: st.stroke, sw: st.strokeWidth, dashed: st.dashed });
  if (o.selected?.has(n.id)) pen.poly(poly.map(([x, y]) => pen.P(x, y, z + h)), 'none', '#0071e3', 2);
  if (!n.label) return;
  // 标题"印"在平台表面、2D 里标题所在的顶部留白带上（自动布局在这里留了 52px，不会被子节点挡住）。
  // 文字沿世界 x 轴排布，按旋转选择正反方向，保证在屏幕上从左往右读且不镜像。
  const fs = Math.round(st.fontSize * 1.5);
  const vec = (vx: number, vy: number): P2 => {
    const [a, b] = rotate(vx, vy, o.rot);
    return [(a - b) * C, (a + b) * S];
  };
  const ux = vec(1, 0)[0] > 0 ? 1 : -1;
  const bu = vec(ux, 0);
  const vy0 = vec(0, 1);
  const vy = bu[0] * vy0[1] - bu[1] * vy0[0] > 0 ? 1 : -1;
  const bv = vec(0, vy);
  const ox = ux > 0 ? n.x + 18 : n.x + n.width - 18;
  const oy = vy > 0 ? n.y + 14 + fs : n.y + 14;
  const [sx, sy] = pen.P(ox, oy, z + h);
  const label = esc(n.label.split('\n')[0]);
  titles.push(
    `<g transform="matrix(${[...bu, ...bv].map((v) => v.toFixed(4)).join(' ')} ${f(sx)} ${f(sy)})"><text font-family="${FONT}" font-size="${fs}" font-weight="${st.bold ? 700 : 600}" fill="${st.textColor}" stroke="${isNone(st.fill) ? o.paper : st.fill}" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${label}</text></g>`,
  );
}

function drawNode(pen: Pen, n: DiagramNode, z: number, labels: Label[], o: IsoOptions) {
  const st = nodeStyle(n.shape, n.style);
  const h = nodeDepth(n);
  const cx = n.x + n.width / 2;
  const cy = n.y + n.height / 2;
  const fs = st.fontSize;
  const below = (foot: P2[]) => {
    // 标签放在物体正前方的地面上
    const pts = foot.map(([x, y]) => pen.P(x, y, z));
    const y = Math.max(...pts.map((p) => p[1]));
    const [sx] = pen.P(cx, cy, z);
    if (n.label)
      labels.push({ x: sx, y: y + 6, lines: wrapText(n.label, Math.max(n.width, 90), fs), fs, color: o.ink, bold: st.bold, halo: o.paper, valign: 'top' });
  };
  const sel = o.selected?.has(n.id);

  if (n.shape === 'text') {
    selection(pen, rectPoly(n.x, n.y, n.width, n.height), z, o, n.id);
    const [sx, sy] = pen.P(cx, cy, z);
    if (n.label) labels.push({ x: sx, y: sy, lines: wrapText(n.label, n.width, fs), fs, color: st.textColor === '#1d1d1f' ? o.ink : st.textColor, bold: st.bold, halo: o.paper, valign: 'middle' });
    return;
  }

  // 图标节点：有专门的 3D 模型就用模型，否则做成印有图标的立体方块
  if (n.icon && (n.shape === 'rounded' || n.shape === 'rect')) {
    const s = clamp(Math.min(n.width, n.height) * 1.15, 56, 120);
    const k = n.style.depth && n.style.depth > 0 ? n.style.depth / 24 : 1;
    const asset = ASSET_LIST[n.icon];
    const custom = n.style.fill !== undefined;
    const ctx: AssetCtx = {
      pen,
      cx,
      cy,
      z,
      s,
      k,
      fill: custom && !isNone(st.fill) && st.fill !== '#ffffff' ? st.fill : undefined,
      stroke: n.style.stroke,
      accent: n.style.stroke && !isNone(n.style.stroke) ? n.style.stroke : '#ff6b3d',
    };
    let foot: P2[];
    if (asset) {
      // 先在草稿上算出模型占地，用来画投影；再正式画模型
      foot = asset.draw({ ...ctx, pen: new Pen(pen.rot, { n: 0, p: 'tmp' }) });
      pen.shadow(foot, z);
      selection(pen, rectPoly(n.x, n.y, n.width, n.height), z, o, n.id);
      asset.draw(ctx);
    } else {
      const w = s * 0.72;
      foot = roundRectPoly(cx - w / 2, cy - w / 2, w, w, 10);
      pen.shadow(foot, z);
      selection(pen, rectPoly(n.x, n.y, n.width, n.height), z, o, n.id);
      const fill = isNone(st.fill) ? '#ffffff' : st.fill;
      const th = 18 * k;
      pen.prism(foot, z, th, { fill, stroke: st.stroke, sw: st.strokeWidth, dashed: st.dashed });
      pen.decal(n.icon, cx, cy, z + th, w * 0.55, st.textColor);
    }
    below(foot);
    return;
  }

  const poly = shapePoly(n);
  if (n.shape === 'circle') {
    const r = Math.min(n.width, n.height) / 2;
    const foot = ellipsePoly(cx, cy, r, r, 24);
    pen.shadow(foot, z);
    selection(pen, rectPoly(n.x, n.y, n.width, n.height), z, o, n.id);
    pen.sphere(cx, cy, z, r * 0.85, isNone(st.fill) ? '#ffffff' : st.fill, st.stroke);
    const [sx, sy] = pen.P(cx, cy, z + r * 0.85);
    if (n.label) labels.push({ x: sx, y: sy, lines: wrapText(n.label, r * 1.6, fs), fs, color: st.textColor, bold: st.bold, halo: st.fill, valign: 'middle' });
    return;
  }

  if (n.shape === 'actor') {
    const s = clamp(Math.min(n.width, n.height * 0.7), 40, 110) * 1.2;
    const foot = ellipsePoly(cx, n.y + n.height * 0.4, s * 0.2, s * 0.2, 16);
    pen.shadow(foot, z);
    selection(pen, rectPoly(n.x, n.y, n.width, n.height), z, o, n.id);
    figure(pen, cx, n.y + n.height * 0.4, z, s, isNone(st.fill) || st.fill === '#ffffff' ? '#4f8ef7' : st.fill, st.stroke);
    below(foot);
    return;
  }

  if (n.shape === 'triangle') {
    // 三角形做成四棱锥
    const foot = rectPoly(n.x + n.width * 0.1, n.y + n.height * 0.1, n.width * 0.8, n.height * 0.8);
    pen.shadow(foot, z);
    selection(pen, rectPoly(n.x, n.y, n.width, n.height), z, o, n.id);
    const apex: P3 = [cx, cy, z + Math.min(n.width, n.height) * 0.75 * (h / 24)];
    const faces = foot.map((a, i) => {
      const b = foot[(i + 1) % 4];
      const nx = b[1] - a[1];
      const ny = -(b[0] - a[0]);
      return { a, b, nx, ny };
    });
    const fill = isNone(st.fill) ? '#ffffff' : st.fill;
    for (const fc of faces) {
      if (!pen.visible(fc.nx, fc.ny)) continue;
      const [rnx, rny] = rotate(fc.nx, fc.ny, pen.rot);
      const len = Math.hypot(rnx, rny) || 1;
      pen.poly([pen.P(fc.a[0], fc.a[1], z), pen.P(fc.b[0], fc.b[1], z), pen.P(apex[0], apex[1], apex[2])], shade(fill, 0.05 + 0.25 * (rny / len) ** 2), st.stroke, st.strokeWidth);
    }
    below(foot);
    return;
  }

  // 普通图形：按轮廓挤出，文字立在顶面中央
  pen.shadow(poly, z);
  selection(pen, poly, z, o, n.id);
  pen.prism(poly, z, h, { fill: st.fill, stroke: st.stroke, sw: st.strokeWidth, dashed: st.dashed });
  if (sel) pen.poly(poly.map(([x, y]) => pen.P(x, y, z + h)), 'none', '#0071e3', 2);
  if (n.shape === 'note') pen.floorPath([[n.x + n.width - 14, n.y], [n.x + n.width - 14, n.y + 14], [n.x + n.width, n.y + 14]], z + h, st.stroke, 1);
  const [sx, sy] = pen.P(cx, cy, z + h);
  if (n.label) {
    const halo = isNone(st.fill) ? o.paper : st.fill;
    labels.push({ x: sx, y: sy, lines: wrapText(n.label, n.width * 0.92, fs), fs, color: st.textColor, bold: st.bold, halo, valign: 'middle' });
  }
}

// ---------- 连线：贴着地面走直角折线，箭头平铺在地面上 ----------

function boundary(n: DiagramNode, tx: number, ty: number): P2 {
  const cx = n.x + n.width / 2;
  const cy = n.y + n.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const sx = dx ? n.width / 2 / Math.abs(dx) : Infinity;
  const sy = dy ? n.height / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

function route(s: DiagramNode, t: DiagramNode, straight: boolean): P2[] {
  const scx = s.x + s.width / 2;
  const scy = s.y + s.height / 2;
  const tcx = t.x + t.width / 2;
  const tcy = t.y + t.height / 2;
  if (straight) return [boundary(s, tcx, tcy), boundary(t, scx, scy)];
  const dx = tcx - scx;
  const dy = tcy - scy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const x1 = dx > 0 ? s.x + s.width : s.x;
    const x2 = dx > 0 ? t.x : t.x + t.width;
    // 竖直方向有重叠时走一条直线
    const lo = Math.max(s.y, t.y);
    const hi = Math.min(s.y + s.height, t.y + t.height);
    if (hi - lo > 8) {
      const y = (lo + hi) / 2;
      return [
        [x1, y],
        [x2, y],
      ];
    }
    const xm = (x1 + x2) / 2;
    return [
      [x1, scy],
      [xm, scy],
      [xm, tcy],
      [x2, tcy],
    ];
  }
  const y1 = dy > 0 ? s.y + s.height : s.y;
  const y2 = dy > 0 ? t.y : t.y + t.height;
  const lo = Math.max(s.x, t.x);
  const hi = Math.min(s.x + s.width, t.x + t.width);
  if (hi - lo > 8) {
    const x = (lo + hi) / 2;
    return [
      [x, y1],
      [x, y2],
    ];
  }
  const ym = (y1 + y2) / 2;
  return [
    [scx, y1],
    [scx, ym],
    [tcx, ym],
    [tcx, y2],
  ];
}

function drawEdge(pen: Pen, e: DiagramEdge, rects: Map<string, DiagramNode>, baseZ: (n: DiagramNode) => number, labels: Label[], o: IsoOptions) {
  const s = rects.get(e.source);
  const t = rects.get(e.target);
  if (!s || !t || s === t) return;
  const st = edgeStyle(e.style);
  const pts = route(s, t, st.lineType === 'straight');
  const zs = baseZ(s) + 0.5;
  const zt = baseZ(t) + 0.5;
  const zOf = (i: number) => (i < pts.length / 2 ? zs : zt);
  const scr = pts.map(([x, y], i) => pen.P(x, y, zOf(i)));
  const dash = st.dashed || st.animated ? ' stroke-dasharray="6 4"' : '';
  const cls = st.animated ? ' class="edge-flow"' : '';
  pen.out.push(
    `<polyline points="${pen.pts(scr)}" fill="none" stroke="${st.color}" stroke-width="${f(st.width + 0.4)}" stroke-linejoin="round" stroke-linecap="round"${dash}${cls}/>`,
  );
  const arrow = (tip: P2, from: P2, z: number) => {
    const dx = tip[0] - from[0];
    const dy = tip[1] - from[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const L = 11 + st.width * 1.5;
    const W = 6 + st.width;
    const b1: P2 = [tip[0] - ux * L - uy * W, tip[1] - uy * L + ux * W];
    const b2: P2 = [tip[0] - ux * L + uy * W, tip[1] - uy * L - ux * W];
    pen.poly([pen.P(tip[0], tip[1], z), pen.P(b1[0], b1[1], z), pen.P(b2[0], b2[1], z)], st.color, st.color, 1);
  };
  const last = pts.length - 1;
  if (st.arrow === 'end' || st.arrow === 'both') arrow(pts[last], pts[last - 1], zt);
  if (st.arrow === 'start' || st.arrow === 'both') arrow(pts[0], pts[1], zs);
  if (e.label) {
    const i = Math.floor((scr.length - 1) / 2);
    const a = scr[i];
    const b = scr[i + 1] ?? a;
    const x = (a[0] + b[0]) / 2;
    const y = (a[1] + b[1]) / 2;
    const fs = 12;
    const lines = e.label.split('\n');
    const w = Math.max(...lines.map((l) => textWidth(l, fs))) + 14;
    const hh = lines.length * fs * 1.32 + 6;
    pen.out.push(`<rect x="${f(x - w / 2)}" y="${f(y - hh / 2)}" width="${f(w)}" height="${f(hh)}" rx="6" fill="${o.paper}" stroke="${st.color}" stroke-opacity="0.3"/>`);
    labels.push({ x, y, lines, fs, color: o.ink, bold: false, halo: o.paper, valign: 'middle' });
  }
}

// ---------- 导出 ----------

export function isoToSVG(d: Diagram, opts: { background?: string | null; padding?: number; rot?: Rot } = {}) {
  const pad = opts.padding ?? 40;
  const bg = opts.background === null ? '' : opts.background ?? (d.background || '#ffffff');
  const scene = buildIsoScene(d, { rot: opts.rot ?? ((d.rotation ?? 0) as Rot), ink: '#1d1d1f', paper: bg || '#ffffff' });
  const b = scene.bounds;
  const width = Math.ceil(b.width + pad * 2);
  const height = Math.ceil(b.height + pad * 2);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs>${scene.defs}</defs>` +
    (bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : '') +
    `<g transform="translate(${f(pad - b.x)} ${f(pad - b.y)})">${scene.layers.map((l) => l.svg).join('')}</g></svg>`;
  return { svg, width, height };
}

/** 图形库里的 3D 素材预览 */
export function assetPreviewSVG(icon: string, size = 44): string {
  const n: DiagramNode = { id: 'p', label: '', shape: 'rounded', icon, x: 0, y: 0, width: 80, height: 80, style: {} };
  const scene = buildIsoScene({ title: '', background: '', direction: 'DOWN', nodes: [n], edges: [] }, { rot: 0, ink: '#000', paper: '#fff', idPrefix: `pv-${icon}-` });
  const b = scene.bounds;
  const m = Math.max(b.width, b.height) + 6;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${f(b.x + b.width / 2 - m / 2)} ${f(b.y + b.height / 2 - m / 2)} ${f(m)} ${f(m)}">` +
    `<defs>${scene.defs}</defs>${scene.layers.map((l) => l.svg).join('')}</svg>`
  );
}
