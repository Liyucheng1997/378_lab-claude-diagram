import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { create } from 'zustand';
import type { ChatItem } from './ai/types';
import { fromModel, sortByDepth, toModel, type EdgeData, type ShapeData, type ShapeRFNode, type SmartRFEdge } from './lib/convert';
import { SHAPE_META } from './lib/shapes';
import { currentDocId, loadDoc, setCurrentDocId } from './lib/storage';
import { emptyDiagram, uid, type Diagram, type Direction, type ShapeType } from './lib/types';

interface Snap {
  nodes: ShapeRFNode[];
  edges: SmartRFEdge[];
  title: string;
  background: string;
  direction: Direction;
}

export interface EditorState {
  docId: string;
  title: string;
  background: string;
  direction: Direction;
  nodes: ShapeRFNode[];
  edges: SmartRFEdge[];
  past: Snap[];
  future: Snap[];
  chat: ChatItem[];
  apiHistory: BetaMessageParam[];
  editingEdge: string | null;
  /** 自增即触发画布 fitView */
  fitTick: number;
  busy: boolean;

  onNodesChange(changes: NodeChange<ShapeRFNode>[]): void;
  onEdgesChange(changes: EdgeChange<SmartRFEdge>[]): void;
  onConnect(c: Connection): void;
  snapshot(): void;
  undo(): void;
  redo(): void;
  getDiagram(): Diagram;
  setDiagram(d: Diagram, opts?: { fit?: boolean; record?: boolean }): void;
  updateNodeData(ids: string[], patch: (d: ShapeData) => Partial<ShapeData>): void;
  updateEdgeData(ids: string[], patch: (d: EdgeData) => Partial<EdgeData>): void;
  setNodes(fn: (nodes: ShapeRFNode[]) => ShapeRFNode[], record?: boolean): void;
  addNode(shape: ShapeType, pos: { x: number; y: number }, extra?: Partial<ShapeData>): string;
  deleteSelected(): void;
  copySelected(): void;
  paste(): void;
  duplicateSelected(): void;
  selectAll(): void;
  setTitle(t: string): void;
  setBackground(c: string): void;
  setEditingEdge(id: string | null): void;
  requestFit(): void;
  setChat(fn: (c: ChatItem[]) => ChatItem[]): void;
  setApiHistory(h: BetaMessageParam[]): void;
  setBusy(b: boolean): void;
  loadDocument(id: string | null): void;
  newDocument(): void;
}

let clipboard: { nodes: ShapeRFNode[]; edges: SmartRFEdge[] } | null = null;

const strip = (nodes: ShapeRFNode[]) => nodes.map(({ selected: _s, dragging: _d, ...n }) => n as ShapeRFNode);

function initialState() {
  const id = currentDocId();
  const rec = id ? loadDoc(id) : null;
  const d = rec?.diagram ?? emptyDiagram();
  const { nodes, edges } = fromModel(d);
  return {
    docId: rec?.id ?? uid('doc_'),
    title: d.title,
    background: d.background,
    direction: d.direction,
    nodes,
    edges,
    chat: rec?.chat ?? [],
    apiHistory: rec?.apiHistory ?? [],
  };
}

export const useEditor = create<EditorState>((set, get) => ({
  ...initialState(),
  past: [],
  future: [],
  editingEdge: null,
  fitTick: 0,
  busy: false,

  onNodesChange(changes) {
    if (changes.some((c) => c.type === 'remove')) get().snapshot();
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },
  onEdgesChange(changes) {
    if (changes.some((c) => c.type === 'remove')) get().snapshot();
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },
  onConnect(c) {
    if (!c.source || !c.target || c.source === c.target) return;
    get().snapshot();
    const edge: SmartRFEdge = { id: uid('e_'), type: 'smart', source: c.source, target: c.target, data: { style: {} } };
    set({ edges: addEdge(edge, get().edges) as SmartRFEdge[] });
  },

  snapshot() {
    const s = get();
    const snap: Snap = { nodes: strip(s.nodes), edges: s.edges, title: s.title, background: s.background, direction: s.direction };
    set({ past: [...s.past.slice(-99), snap], future: [] });
  },
  undo() {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    const cur: Snap = { nodes: strip(s.nodes), edges: s.edges, title: s.title, background: s.background, direction: s.direction };
    set({ ...prev, past: s.past.slice(0, -1), future: [cur, ...s.future] });
  },
  redo() {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    const cur: Snap = { nodes: strip(s.nodes), edges: s.edges, title: s.title, background: s.background, direction: s.direction };
    set({ ...next, past: [...s.past, cur], future: s.future.slice(1) });
  },

  getDiagram() {
    const s = get();
    return toModel(s.nodes, s.edges, { title: s.title, background: s.background, direction: s.direction });
  },
  setDiagram(d, opts = {}) {
    if (opts.record !== false) get().snapshot();
    const { nodes, edges } = fromModel(d);
    set({ nodes, edges, title: d.title, background: d.background, direction: d.direction });
    if (opts.fit) get().requestFit();
  },

  updateNodeData(ids, patch) {
    if (!ids.length) return;
    get().snapshot();
    const set_ = new Set(ids);
    set({
      nodes: get().nodes.map((n) => (set_.has(n.id) ? { ...n, data: { ...n.data, ...patch(n.data) } } : n)),
    });
  },
  updateEdgeData(ids, patch) {
    if (!ids.length) return;
    get().snapshot();
    const set_ = new Set(ids);
    set({
      edges: get().edges.map((e) => {
        if (!set_.has(e.id)) return e;
        const data = { style: {}, ...e.data };
        return { ...e, data: { ...data, ...patch(data) } };
      }),
    });
  },
  setNodes(fn, record = true) {
    if (record) get().snapshot();
    set({ nodes: sortByDepth(fn(get().nodes)) });
  },

  addNode(shape, pos, extra) {
    get().snapshot();
    const [w, h] = SHAPE_META[shape].size;
    const id = uid('n_');
    const node: ShapeRFNode = {
      id,
      type: 'shape',
      position: { x: Math.round(pos.x - w / 2), y: Math.round(pos.y - h / 2) },
      width: w,
      height: h,
      selected: true,
      data: { label: SHAPE_META[shape].name, shape, style: {}, ...extra },
    };
    set({ nodes: [...get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node] });
    return id;
  },

  deleteSelected() {
    const s = get();
    const ids = new Set(s.nodes.filter((n) => n.selected).map((n) => n.id));
    const eids = new Set(s.edges.filter((e) => e.selected).map((e) => e.id));
    if (!ids.size && !eids.size) return;
    s.snapshot();
    // 删除分组时其子节点一并删除（与 draw.io 一致）
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of s.nodes) if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) (ids.add(n.id), (grew = true));
    }
    set({
      nodes: s.nodes.filter((n) => !ids.has(n.id)),
      edges: s.edges.filter((e) => !eids.has(e.id) && !ids.has(e.source) && !ids.has(e.target)),
    });
  },

  copySelected() {
    const s = get();
    const nodes = s.nodes.filter((n) => n.selected);
    if (!nodes.length) return;
    const ids = new Set(nodes.map((n) => n.id));
    clipboard = { nodes, edges: s.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  },
  paste() {
    if (!clipboard) return;
    const s = get();
    s.snapshot();
    const map = new Map<string, string>();
    clipboard.nodes.forEach((n) => map.set(n.id, uid('n_')));
    const nodes = clipboard.nodes.map((n) => {
      const inside = n.parentId && map.has(n.parentId);
      const node: ShapeRFNode = {
        ...n,
        id: map.get(n.id)!,
        selected: true,
        position: inside ? n.position : { x: n.position.x + 30, y: n.position.y + 30 },
        data: { ...n.data, style: { ...n.data.style } },
      };
      if (inside) node.parentId = map.get(n.parentId!)!;
      return node;
    });
    const edges = clipboard.edges.map((e) => ({ ...e, id: uid('e_'), source: map.get(e.source)!, target: map.get(e.target)!, selected: false }));
    clipboard = { nodes: nodes.map((n) => ({ ...n, selected: false })), edges };
    set({
      nodes: sortByDepth([...s.nodes.map((n) => ({ ...n, selected: false })), ...nodes]),
      edges: [...s.edges, ...edges],
    });
  },
  duplicateSelected() {
    get().copySelected();
    get().paste();
  },
  selectAll() {
    set({ nodes: get().nodes.map((n) => ({ ...n, selected: true })), edges: get().edges.map((e) => ({ ...e, selected: true })) });
  },

  setTitle(t) {
    set({ title: t });
  },
  setBackground(c) {
    get().snapshot();
    set({ background: c });
  },
  setEditingEdge(id) {
    set({ editingEdge: id });
  },
  requestFit() {
    set({ fitTick: get().fitTick + 1 });
  },
  setChat(fn) {
    set({ chat: fn(get().chat) });
  },
  setApiHistory(h) {
    set({ apiHistory: h });
  },
  setBusy(b) {
    set({ busy: b });
  },

  loadDocument(id) {
    const rec = id ? loadDoc(id) : null;
    const d = rec?.diagram ?? emptyDiagram();
    const { nodes, edges } = fromModel(d);
    const docId = rec?.id ?? uid('doc_');
    setCurrentDocId(docId);
    set({
      docId,
      nodes,
      edges,
      title: d.title,
      background: d.background,
      direction: d.direction,
      chat: rec?.chat ?? [],
      apiHistory: rec?.apiHistory ?? [],
      past: [],
      future: [],
      editingEdge: null,
    });
    get().requestFit();
  },
  newDocument() {
    get().loadDocument(null);
  },
}));
