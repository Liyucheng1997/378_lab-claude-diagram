import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { depthOf } from './convert';
import { computeEdgePath, type Rect } from './geometry';
import { ICONS } from './icons';
import { isoToSVG } from './iso';
import { labelBox, shapePrimitives, textWidth, wrapText, type Primitive } from './shapes';
import { edgeStyle, nodeStyle, type Diagram, type DiagramEdge, type DiagramNode } from './types';

const FONT = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif";

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function diagramBounds(d: Diagram) {
  if (!d.nodes.length) return { x: 0, y: 0, width: 400, height: 300 };
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const n of d.nodes) {
    x1 = Math.min(x1, n.x);
    y1 = Math.min(y1, n.y);
    x2 = Math.max(x2, n.x + n.width);
    y2 = Math.max(y2, n.y + n.height + (n.shape === 'actor' ? 10 : 0));
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

// ---------- SVG（纯矢量，可直接在 Figma / Illustrator / 浏览器中打开） ----------

function primitiveSVG(p: Primitive, attrs: string): string {
  const a = p.noFill ? attrs.replace(/fill="[^"]*"/, 'fill="none"') : attrs;
  switch (p.tag) {
    case 'rect':
      return `<rect x="${fmt(p.x)}" y="${fmt(p.y)}" width="${fmt(p.width)}" height="${fmt(p.height)}" rx="${fmt(p.rx)}" ${a}/>`;
    case 'ellipse':
      return `<ellipse cx="${fmt(p.cx)}" cy="${fmt(p.cy)}" rx="${fmt(p.rx)}" ry="${fmt(p.ry)}" ${a}/>`;
    case 'path':
      return `<path d="${p.d}" ${a}/>`;
  }
}

function nodeSVG(n: DiagramNode): string {
  const st = nodeStyle(n.shape, n.style);
  const dash = st.dashed ? ' stroke-dasharray="6 4"' : '';
  const attrs = `fill="${st.fill}" stroke="${st.stroke}" stroke-width="${st.strokeWidth}" stroke-linejoin="round" stroke-linecap="round"${dash}`;
  const parts = shapePrimitives(n.shape, n.width, n.height).map((p) => primitiveSVG(p, attrs));

  const box = labelBox(n.shape, n.width, n.height);
  const fs = st.fontSize;
  const lh = fs * 1.35;
  const lines = n.label ? wrapText(n.label, Math.max(box.width, fs), fs) : [];
  const IconC = n.icon && n.shape !== 'group' ? ICONS[n.icon]?.icon : undefined;
  const iconSize = IconC ? Math.round(Math.min(28, Math.max(18, n.height * 0.32))) : 0;
  const gap = IconC && lines.length ? 6 : 0;
  const blockH = iconSize + gap + lines.length * lh;
  let top = box.valign === 'middle' ? box.y + (box.height - blockH) / 2 : box.y;
  if (IconC) {
    const ix = box.align === 'left' ? box.x : box.x + (box.width - iconSize) / 2;
    const svg = renderToStaticMarkup(createElement(IconC, { size: iconSize, color: st.textColor, strokeWidth: 1.75 }));
    parts.push(svg.replace('<svg ', `<svg x="${fmt(ix)}" y="${fmt(top)}" `));
    top += iconSize + gap;
  }
  if (lines.length) {
    const anchor = box.align === 'left' ? 'start' : 'middle';
    const tx = box.align === 'left' ? box.x : box.x + box.width / 2;
    const tspans = lines
      .map((l, i) => `<tspan x="${fmt(tx)}" y="${fmt(top + fs * 0.92 + i * lh)}">${esc(l) || ' '}</tspan>`)
      .join('');
    parts.push(
      `<text font-family="${FONT}" font-size="${fs}" fill="${st.textColor}" text-anchor="${anchor}"${st.bold ? ' font-weight="600"' : ''}>${tspans}</text>`,
    );
  }
  return `<g transform="translate(${fmt(n.x)} ${fmt(n.y)})">${parts.join('')}</g>`;
}

function markerId(color: string) {
  return 'arw-' + color.replace(/[^a-zA-Z0-9]/g, '');
}

function edgeSVG(e: DiagramEdge, rects: Map<string, Rect>, labels: string[]): string {
  const s = rects.get(e.source);
  const t = rects.get(e.target);
  if (!s || !t) return '';
  const st = edgeStyle(e.style);
  const { path, labelX, labelY } = computeEdgePath(s, t, st.lineType);
  const m = `url(#${markerId(st.color)})`;
  const start = st.arrow === 'start' || st.arrow === 'both' ? ` marker-start="${m}"` : '';
  const end = st.arrow === 'end' || st.arrow === 'both' ? ` marker-end="${m}"` : '';
  const dash = st.dashed || st.animated ? ' stroke-dasharray="6 4"' : '';
  if (e.label) {
    const fs = 12;
    const ls = e.label.split('\n');
    const w = Math.max(...ls.map((l) => textWidth(l, fs))) + 14;
    const h = ls.length * fs * 1.35 + 8;
    labels.push(
      `<g transform="translate(${fmt(labelX)} ${fmt(labelY)})"><rect x="${fmt(-w / 2)}" y="${fmt(-h / 2)}" width="${fmt(w)}" height="${fmt(h)}" rx="6" fill="#ffffff" stroke="${st.color}" stroke-opacity="0.25"/>` +
        `<text font-family="${FONT}" font-size="${fs}" fill="#3a3a3c" text-anchor="middle">${ls
          .map((l, i) => `<tspan x="0" y="${fmt(-h / 2 + 4 + fs * 0.92 + i * fs * 1.35)}">${esc(l)}</tspan>`)
          .join('')}</text></g>`,
    );
  }
  return `<path d="${path}" fill="none" stroke="${st.color}" stroke-width="${st.width}" stroke-linejoin="round"${dash}${start}${end}/>`;
}

export function diagramToSVG(d: Diagram, opts: { background?: string | null; padding?: number } = {}) {
  // 3D 视图导出所见即所得的立体图
  if (d.view === '3d') return isoToSVG(d, opts);
  const pad = opts.padding ?? 32;
  const b = diagramBounds(d);
  const width = Math.ceil(b.width + pad * 2);
  const height = Math.ceil(b.height + pad * 2);
  const rects = new Map<string, Rect>(d.nodes.map((n) => [n.id, { x: n.x, y: n.y, width: n.width, height: n.height }]));
  const depth = depthOf(d.nodes);
  const byDepth = (a: DiagramNode, c: DiagramNode) => depth.get(a.id)! - depth.get(c.id)!;
  const groups = d.nodes.filter((n) => n.shape === 'group').sort(byDepth);
  const others = d.nodes.filter((n) => n.shape !== 'group').sort(byDepth);
  const colors = [...new Set(d.edges.map((e) => edgeStyle(e.style).color))];
  const defs = colors
    .map(
      (c) =>
        `<marker id="${markerId(c)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`,
    )
    .join('');
  const labels: string[] = [];
  const edges = d.edges.map((e) => edgeSVG(e, rects, labels)).join('');
  const bg = opts.background === null ? '' : opts.background ?? (d.background || '#ffffff');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs>${defs}</defs>` +
    (bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : '') +
    `<g transform="translate(${fmt(pad - b.x)} ${fmt(pad - b.y)})">` +
    groups.map(nodeSVG).join('') +
    edges +
    others.map(nodeSVG).join('') +
    labels.join('') +
    `</g></svg>`;
  return { svg, width, height };
}

// ---------- 位图 / PDF ----------

export async function diagramToCanvas(d: Diagram, scale: number, background: string | null) {
  const { svg, width, height } = diagramToSVG(d, { background });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return { canvas, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function diagramToBlob(d: Diagram, type: 'image/png' | 'image/jpeg', scale = 2, transparent = false) {
  const bg = transparent ? null : d.background || '#ffffff';
  const { canvas } = await diagramToCanvas(d, scale, bg);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('生成图片失败'))), type, 0.95),
  );
}

export async function diagramToPDF(d: Diagram): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const { canvas, width, height } = await diagramToCanvas(d, 2.5, d.background || '#ffffff');
  const pdf = new jsPDF({ orientation: width > height ? 'landscape' : 'portrait', unit: 'px', format: [width, height], hotfixes: ['px_scaling'], compress: true });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, width, height, undefined, 'FAST');
  pdf.setProperties({ title: d.title });
  return pdf.output('blob');
}

// ---------- draw.io (.drawio) ----------

const DRAWIO_SHAPE: Record<string, string> = {
  rect: 'rounded=0;',
  rounded: 'rounded=1;arcSize=18;',
  ellipse: 'ellipse;',
  circle: 'ellipse;aspect=fixed;',
  diamond: 'rhombus;',
  parallelogram: 'shape=parallelogram;perimeter=parallelogramPerimeter;fixedSize=1;',
  hexagon: 'shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;',
  cylinder: 'shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=12;',
  document: 'shape=document;boundedLbl=1;size=0.15;',
  cloud: 'ellipse;shape=cloud;',
  triangle: 'triangle;direction=north;',
  actor: 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;outlineConnect=0;',
  note: 'shape=note;size=16;',
  text: 'text;align=center;verticalAlign=middle;',
  group: 'rounded=1;arcSize=4;container=1;collapsible=0;verticalAlign=top;align=left;spacingLeft=14;spacingTop=6;',
};

const htmlLabel = (s: string) => esc(s).replace(/\n/g, '<br>');

export function diagramToDrawio(d: Diagram): string {
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const cid = (id: string) => 'c_' + id.replace(/[^A-Za-z0-9_-]/g, '_');
  const depth = depthOf(d.nodes);
  const cells: string[] = [];
  for (const n of [...d.nodes].sort((a, b) => depth.get(a.id)! - depth.get(b.id)!)) {
    const st = nodeStyle(n.shape, n.style);
    const style =
      DRAWIO_SHAPE[n.shape] +
      `whiteSpace=wrap;html=1;fillColor=${st.fill};strokeColor=${st.stroke};fontColor=${st.textColor};fontSize=${st.fontSize};strokeWidth=${st.strokeWidth};` +
      (st.dashed ? 'dashed=1;' : '') +
      (st.bold ? 'fontStyle=1;' : '');
    const parent = n.parent ? byId.get(n.parent) : undefined;
    const x = n.x - (parent?.x ?? 0);
    const y = n.y - (parent?.y ?? 0);
    cells.push(
      `<mxCell id="${cid(n.id)}" value="${esc(htmlLabel(n.label))}" style="${esc(style)}" vertex="1" parent="${parent ? cid(parent.id) : '1'}">` +
        `<mxGeometry x="${fmt(x)}" y="${fmt(y)}" width="${fmt(n.width)}" height="${fmt(n.height)}" as="geometry"/></mxCell>`,
    );
  }
  for (const e of d.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    const st = edgeStyle(e.style);
    const line =
      st.lineType === 'straight'
        ? ''
        : st.lineType === 'bezier'
          ? 'edgeStyle=orthogonalEdgeStyle;curved=1;'
          : st.lineType === 'step'
            ? 'edgeStyle=orthogonalEdgeStyle;rounded=0;'
            : 'edgeStyle=orthogonalEdgeStyle;rounded=1;';
    const endA = st.arrow === 'end' || st.arrow === 'both' ? 'classic' : 'none';
    const startA = st.arrow === 'start' || st.arrow === 'both' ? 'classic' : 'none';
    const style =
      line +
      `html=1;orthogonalLoop=1;jettySize=auto;strokeColor=${st.color};strokeWidth=${st.width};endArrow=${endA};startArrow=${startA};endFill=1;startFill=1;fontSize=12;labelBackgroundColor=#ffffff;` +
      (st.dashed || st.animated ? 'dashed=1;' : '') +
      (st.animated ? 'flowAnimation=1;' : '');
    cells.push(
      `<mxCell id="${cid(e.id)}" value="${esc(htmlLabel(e.label ?? ''))}" style="${esc(style)}" edge="1" parent="1" source="${cid(e.source)}" target="${cid(e.target)}">` +
        `<mxGeometry relative="1" as="geometry"/></mxCell>`,
    );
  }
  const bg = d.background ? ` background="${esc(d.background)}"` : '';
  return (
    `<mxfile host="ClaudeDiagram" type="device"><diagram id="page-1" name="${esc(d.title)}">` +
    `<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0"${bg}>` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>`
  );
}

// ---------- Mermaid ----------

export function diagramToMermaid(d: Diagram): string {
  const dir = { DOWN: 'TD', RIGHT: 'LR', UP: 'BT', LEFT: 'RL' }[d.direction] ?? 'TD';
  const ids = new Map(d.nodes.map((n, i) => [n.id, 'n' + (i + 1)]));
  const q = (s: string) => '"' + s.replace(/"/g, '#quot;').replace(/\n/g, '<br/>') + '"';
  const shape = (n: DiagramNode) => {
    const l = q(n.label || ' ');
    switch (n.shape) {
      case 'rounded': return `(${l})`;
      case 'ellipse': return `([${l}])`;
      case 'circle': return `((${l}))`;
      case 'diamond': return `{${l}}`;
      case 'parallelogram': return `[/${l}/]`;
      case 'hexagon': return `{{${l}}}`;
      case 'cylinder': return `[(${l})]`;
      case 'cloud': return `>${l}]`;
      case 'triangle': return `[/${l}\\]`;
      default: return `[${l}]`;
    }
  };
  const out: string[] = [`flowchart ${dir}`];
  const kids = new Map<string | undefined, DiagramNode[]>();
  for (const n of d.nodes) {
    const k = n.parent && ids.has(n.parent) ? n.parent : undefined;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k)!.push(n);
  }
  const emit = (parent: string | undefined, indent: string) => {
    for (const n of kids.get(parent) ?? []) {
      if (n.shape === 'group') {
        out.push(`${indent}subgraph ${ids.get(n.id)}[${q(n.label || ' ')}]`);
        emit(n.id, indent + '  ');
        out.push(`${indent}end`);
      } else out.push(`${indent}${ids.get(n.id)}${shape(n)}`);
    }
  };
  emit(undefined, '  ');
  for (const e of d.edges) {
    const s = ids.get(e.source), t = ids.get(e.target);
    if (!s || !t) continue;
    const st = edgeStyle(e.style);
    const dashed = st.dashed || st.animated;
    const arrow =
      st.arrow === 'none' ? (dashed ? '-.-' : '---') : st.arrow === 'both' ? (dashed ? '<-.->' : '<-->') : dashed ? '-.->' : '-->';
    const [a, b] = st.arrow === 'start' ? [t, s] : [s, t];
    out.push(`  ${a} ${arrow}${e.label ? `|${q(e.label)}|` : ''} ${b}`);
  }
  for (const n of d.nodes) {
    if (n.shape === 'group' || n.shape === 'text') continue;
    const st = nodeStyle(n.shape, n.style);
    out.push(`  style ${ids.get(n.id)} fill:${st.fill},stroke:${st.stroke},color:${st.textColor}`);
  }
  return out.join('\n');
}

// ---------- JSON ----------

export function diagramToJSON(d: Diagram): string {
  return JSON.stringify({ format: 'claude-diagram', version: 1, diagram: d }, null, 2);
}

// ---------- 下载 ----------

export function safeFileName(s: string) {
  return (s || '未命名图表').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(text: string, filename: string, mime: string) {
  downloadBlob(new Blob([text], { type: mime + ';charset=utf-8' }), filename);
}
