import { emptyDiagram, SHAPES, type Diagram, type DiagramEdge, type DiagramNode, type ShapeType } from './types';

export async function importFile(file: File): Promise<Diagram> {
  const text = await file.text();
  const name = file.name.replace(/\.(json|drawio|xml|dio)$/i, '');
  if (/^\s*[{[]/.test(text)) return importJSON(text, name);
  if (/<mxfile|<mxGraphModel/.test(text)) return importDrawio(text, name);
  throw new Error('无法识别的文件格式，支持 .json 与 .drawio');
}

export function importJSON(text: string, fallbackTitle = '导入的图表'): Diagram {
  const raw = JSON.parse(text);
  const d = raw?.format === 'claude-diagram' ? raw.diagram : raw;
  if (!d || !Array.isArray(d.nodes)) throw new Error('JSON 中没有找到 nodes 数组');
  const base = emptyDiagram(d.title || fallbackTitle);
  const nodes: DiagramNode[] = d.nodes.map((n: Partial<DiagramNode>, i: number) => ({
    id: String(n.id ?? 'n' + i),
    label: String(n.label ?? ''),
    shape: (SHAPES as readonly string[]).includes(n.shape as string) ? (n.shape as ShapeType) : 'rounded',
    icon: n.icon,
    parent: n.parent,
    x: Number(n.x) || 0,
    y: Number(n.y) || 0,
    width: Number(n.width) || 160,
    height: Number(n.height) || 64,
    style: n.style ?? {},
    ...(n.ref && typeof n.ref.path === 'string' ? { ref: n.ref } : {}),
  }));
  const edges: DiagramEdge[] = (d.edges ?? []).map((e: Partial<DiagramEdge>, i: number) => ({
    id: String(e.id ?? 'e' + i),
    source: String(e.source),
    target: String(e.target),
    label: e.label,
    style: e.style ?? {},
  }));
  return { ...base, background: d.background ?? '', direction: d.direction ?? 'DOWN', nodes, edges };
}

// ---------- draw.io ----------

async function inflateDiagram(data: string): Promise<string> {
  const bin = Uint8Array.from(atob(data.trim()), (c) => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const text = await new Response(stream).text();
  return decodeURIComponent(text);
}

function parseStyle(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(';')) {
    if (!part) continue;
    const i = part.indexOf('=');
    if (i < 0) out[part] = '1';
    else out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

function htmlToText(v: string): string {
  if (!/[<&]/.test(v)) return v;
  const div = document.createElement('div');
  div.innerHTML = v.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n');
  return (div.textContent ?? '').replace(/\n+$/g, '');
}

function shapeFromStyle(st: Record<string, string>, isContainer: boolean): ShapeType {
  const shape = st.shape ?? '';
  if (st.text || shape === 'text') return 'text';
  if (st.swimlane || shape === 'swimlane' || st.container === '1' || isContainer) return 'group';
  if (shape === 'cloud') return 'cloud';
  if (st.ellipse || shape === 'ellipse') return st.aspect === 'fixed' ? 'circle' : 'ellipse';
  if (st.rhombus || shape === 'rhombus') return 'diamond';
  if (st.triangle || shape === 'triangle') return 'triangle';
  if (shape.startsWith('cylinder') || shape === 'datastore') return 'cylinder';
  if (shape === 'document') return 'document';
  if (shape === 'parallelogram') return 'parallelogram';
  if (shape === 'hexagon') return 'hexagon';
  if (shape === 'umlActor' || shape.includes('actor')) return 'actor';
  if (shape === 'note') return 'note';
  return st.rounded === '1' ? 'rounded' : 'rect';
}

const color = (v: string | undefined) => (v && v !== 'default' ? v : undefined);

export async function importDrawio(xml: string, fallbackTitle = '导入的图表'): Promise<Diagram> {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  let model = doc.querySelector('mxGraphModel');
  const diagramEl = doc.querySelector('diagram');
  if (!model && diagramEl?.textContent?.trim()) {
    const inner = await inflateDiagram(diagramEl.textContent);
    model = new DOMParser().parseFromString(inner, 'text/xml').querySelector('mxGraphModel');
  }
  if (!model) throw new Error('draw.io 文件中没有找到图表数据');

  const cells = [...model.querySelectorAll('mxCell')];
  const parentOf = new Map(cells.map((c) => [c.getAttribute('id')!, c.getAttribute('parent') ?? '']));
  const vertexIds = new Set(cells.filter((c) => c.getAttribute('vertex') === '1').map((c) => c.getAttribute('id')!));
  const hasChildren = new Set(cells.map((c) => c.getAttribute('parent')).filter((p): p is string => !!p && vertexIds.has(p)));

  const rel = new Map<string, DiagramNode>();
  for (const c of cells) {
    if (c.getAttribute('vertex') !== '1') continue;
    const id = c.getAttribute('id')!;
    const st = parseStyle(c.getAttribute('style') ?? '');
    const g = c.querySelector('mxGeometry');
    const shape = shapeFromStyle(st, hasChildren.has(id));
    const parent = parentOf.get(id);
    rel.set(id, {
      id,
      label: htmlToText(c.getAttribute('value') ?? ''),
      shape,
      parent: parent && vertexIds.has(parent) ? parent : undefined,
      x: Number(g?.getAttribute('x')) || 0,
      y: Number(g?.getAttribute('y')) || 0,
      width: Number(g?.getAttribute('width')) || 120,
      height: Number(g?.getAttribute('height')) || 60,
      style: {
        fill: st.fillColor === 'none' ? 'none' : color(st.fillColor),
        stroke: st.strokeColor === 'none' ? 'none' : color(st.strokeColor),
        textColor: color(st.fontColor),
        fontSize: st.fontSize ? Number(st.fontSize) : undefined,
        bold: st.fontStyle ? (Number(st.fontStyle) & 1) === 1 : undefined,
        strokeWidth: st.strokeWidth ? Number(st.strokeWidth) : undefined,
        dashed: st.dashed === '1' || undefined,
      },
    });
  }
  // draw.io 子节点坐标相对父节点，转成绝对坐标
  const abs = (n: DiagramNode, guard = 0): { x: number; y: number } => {
    const p = n.parent ? rel.get(n.parent) : undefined;
    if (!p || guard > 50) return { x: n.x, y: n.y };
    const pa = abs(p, guard + 1);
    return { x: pa.x + n.x, y: pa.y + n.y };
  };
  const nodes = [...rel.values()].map((n) => ({ ...n, ...abs(n) }));

  const edges: DiagramEdge[] = [];
  for (const c of cells) {
    if (c.getAttribute('edge') !== '1') continue;
    const s = c.getAttribute('source');
    const t = c.getAttribute('target');
    if (!s || !t || !rel.has(s) || !rel.has(t)) continue;
    const st = parseStyle(c.getAttribute('style') ?? '');
    const endA = st.endArrow !== 'none';
    const startA = !!st.startArrow && st.startArrow !== 'none';
    edges.push({
      id: c.getAttribute('id')!,
      source: s,
      target: t,
      label: htmlToText(c.getAttribute('value') ?? '') || undefined,
      style: {
        color: color(st.strokeColor),
        width: st.strokeWidth ? Number(st.strokeWidth) : undefined,
        dashed: st.dashed === '1' || undefined,
        arrow: endA && startA ? 'both' : endA ? 'end' : startA ? 'start' : 'none',
        lineType: st.curved === '1' ? 'bezier' : st.edgeStyle ? (st.rounded === '0' ? 'step' : 'smoothstep') : 'straight',
      },
    });
  }
  return {
    ...emptyDiagram(diagramEl?.getAttribute('name') || fallbackTitle),
    background: model.getAttribute('background') && model.getAttribute('background') !== 'none' ? model.getAttribute('background')! : '',
    nodes,
    edges,
  };
}
