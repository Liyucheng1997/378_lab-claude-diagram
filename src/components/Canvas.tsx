import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  useViewport,
  type Edge,
  type Node,
} from '@xyflow/react';
import { Map as MapIcon, Maximize, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { openInEditor } from '../code/editor';
import { useCode } from '../code/store';
import type { ShapeRFNode, SmartRFEdge } from '../lib/convert';
import { loadSettings } from '../lib/storage';
import { nodeStyle, type ShapeType } from '../lib/types';
import { useEditor } from '../store';
import { CodePeek } from './CodePeek';
import { ShapeNode } from './ShapeNode';
import { SmartEdge } from './SmartEdge';
import { Toolbar } from './Toolbar';

const nodeTypes = { shape: ShapeNode };
const edgeTypes = { smart: SmartEdge };

export const DND_MIME = 'application/x-claude-diagram-shape';

// 顶部留出浮动工具栏、底部留出缩放控件的位置
const FIT_PADDING = { top: '76px', bottom: '60px', left: '48px', right: '48px' } as const;
const FIT = { padding: FIT_PADDING, duration: 300, maxZoom: 1.1 };

export function Canvas(props: { theme: 'light' | 'dark' }) {
  const s = useEditor();
  const rf = useReactFlow<ShapeRFNode, SmartRFEdge>();
  const [minimap, setMinimap] = useState(false);

  const rfRef = useRef(rf);
  rfRef.current = rf;
  useEffect(() => {
    if (!s.fitTick) return;
    const t = setTimeout(() => rfRef.current.fitView(FIT), 80);
    return () => clearTimeout(t);
  }, [s.fitTick]);

  /** 拖动结束时：节点中心落进哪个分组，就成为它的子节点；拖出分组则脱离 */
  const reparent = useCallback(
    (dragged: Node[]) => {
      const ids = new Set(dragged.map((n) => n.id));
      const internal = (id: string) => rf.getInternalNode(id);
      const groups = rf.getNodes().filter((n) => n.data.shape === 'group' && !ids.has(n.id));
      const changes = new Map<string, { parentId?: string; position: { x: number; y: number } }>();
      for (const d of dragged) {
        const node = rf.getNode(d.id);
        const inn = internal(d.id);
        if (!node || !inn || node.data.shape === 'group') continue;
        if (node.parentId && ids.has(node.parentId)) continue; // 随父分组一起移动
        const abs = inn.internals.positionAbsolute;
        const cx = abs.x + (inn.measured.width ?? 0) / 2;
        const cy = abs.y + (inn.measured.height ?? 0) / 2;
        let best: { id: string; area: number; x: number; y: number } | null = null;
        for (const g of groups) {
          const gi = internal(g.id);
          if (!gi) continue;
          const { x, y } = gi.internals.positionAbsolute;
          const w = gi.measured.width ?? 0;
          const h = gi.measured.height ?? 0;
          if (cx > x && cx < x + w && cy > y && cy < y + h && (!best || w * h < best.area)) best = { id: g.id, area: w * h, x, y };
        }
        if ((best?.id ?? undefined) === node.parentId) continue;
        changes.set(d.id, {
          parentId: best?.id,
          position: best ? { x: abs.x - best.x, y: abs.y - best.y } : { x: abs.x, y: abs.y },
        });
      }
      if (!changes.size) return;
      useEditor.getState().setNodes(
        (nodes) =>
          nodes.map((n) => {
            const c = changes.get(n.id);
            if (!c) return n;
            const { parentId: _p, ...rest } = n;
            return c.parentId ? { ...rest, parentId: c.parentId, position: c.position } : { ...rest, position: c.position };
          }),
        false,
      );
    },
    [rf],
  );

  /** 代码面板浮在画布右侧，若挡住了刚点击的节点就把画布向左平移 */
  const revealBesidePeek = (id: string) =>
    requestAnimationFrame(() => {
      const peek = document.querySelector('.code-peek')?.getBoundingClientRect();
      const el = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
      if (!peek || !el || el.right + 24 <= peek.left) return;
      const vp = rf.getViewport();
      rf.setViewport({ ...vp, x: vp.x - (el.right + 40 - peek.left) }, { duration: 300 });
    });

  const onDrop = (e: DragEvent) => {
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw) return;
    e.preventDefault();
    const { shape, icon, label } = JSON.parse(raw) as { shape: ShapeType; icon?: string; label?: string };
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const id = useEditor.getState().addNode(shape, pos, { ...(icon ? { icon } : {}), ...(label ? { label } : {}) });
    requestAnimationFrame(() => {
      const n = rf.getNode(id);
      if (n) reparent([n]);
    });
  };

  const bg = s.background || undefined;
  return (
    <div className="canvas-wrap card" style={bg ? { background: bg } : undefined}>
      <ReactFlow<ShapeRFNode, SmartRFEdge>
        nodes={s.nodes}
        edges={s.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={s.onNodesChange}
        onEdgesChange={s.onEdgesChange}
        onConnect={s.onConnect}
        onNodeDragStart={() => useEditor.getState().snapshot()}
        onSelectionDragStart={() => useEditor.getState().snapshot()}
        onNodeDragStop={(_, __, nodes) => reparent(nodes)}
        onSelectionDragStop={(_, nodes) => reparent(nodes)}
        onEdgeDoubleClick={(_, edge: Edge) => useEditor.getState().setEditingEdge(edge.id)}
        onNodeClick={(e, node) => {
          // 带代码位置的节点：单击查看代码，Alt+单击直接在编辑器中打开
          const ref = node.data.ref;
          if (!ref || e.shiftKey || e.ctrlKey || e.metaKey) return;
          const root = useEditor.getState().project?.rootPath;
          if (e.altKey && root) openInEditor(loadSettings().editor, root, ref.path, ref.line);
          else {
            useCode.getState().openPeek({ ref, label: node.data.label, nodeId: node.id });
            revealBesidePeek(node.id);
          }
        }}
        onPaneClick={() => useCode.getState().closePeek()}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DND_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={onDrop}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionRadius={36}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        selectionOnDrag
        panOnDrag={[1, 2]}
        panOnScroll
        zoomOnPinch
        selectionMode={SelectionMode.Partial}
        snapToGrid
        snapGrid={[10, 10]}
        minZoom={0.1}
        maxZoom={4}
        colorMode={props.theme}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1.1 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        {minimap && (
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => {
              const d = (n as ShapeRFNode).data;
              const st = nodeStyle(d.shape, d.style);
              return st.fill === 'none' ? 'transparent' : st.fill;
            }}
            nodeStrokeColor={(n) => nodeStyle((n as ShapeRFNode).data.shape, (n as ShapeRFNode).data.style).stroke}
            nodeStrokeWidth={2}
            className="minimap"
          />
        )}
      </ReactFlow>
      <Toolbar />
      <CodePeek />
      <ZoomControls minimap={minimap} onToggleMinimap={() => setMinimap(!minimap)} />
      {s.nodes.length === 0 && <EmptyHint />}
    </div>
  );
}

function ZoomControls(props: { minimap: boolean; onToggleMinimap(): void }) {
  const rf = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="zoom-controls">
      <button className="icon-btn" onClick={() => rf.zoomOut({ duration: 150 })} title="缩小" aria-label="缩小">
        <Minus size={15} />
      </button>
      <button className="zoom-value tabular" onClick={() => rf.zoomTo(1, { duration: 150 })} title="重置为 100%">
        {Math.round(zoom * 100)}%
      </button>
      <button className="icon-btn" onClick={() => rf.zoomIn({ duration: 150 })} title="放大" aria-label="放大">
        <Plus size={15} />
      </button>
      <span className="tb-sep" />
      <button className="icon-btn" onClick={() => rf.fitView(FIT)} title="适应画布" aria-label="适应画布">
        <Maximize size={14} />
      </button>
      <button className={'icon-btn' + (props.minimap ? ' on' : '')} onClick={props.onToggleMinimap} title="小地图" aria-label="小地图">
        <MapIcon size={14} />
      </button>
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="empty-hint">
      <div className="empty-title">从一句话开始</div>
      <div className="empty-sub">在右侧告诉 Claude 你想画什么，或从左侧拖入图形</div>
    </div>
  );
}
