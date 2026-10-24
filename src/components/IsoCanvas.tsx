import { Maximize, Minus, Plus, RotateCcw, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { openInEditor } from '../code/editor';
import { useCode } from '../code/store';
import { toModel } from '../lib/convert';
import { buildIsoScene, unproject, type Rot } from '../lib/iso';
import { loadSettings } from '../lib/storage';
import type { ShapeType } from '../lib/types';
import { useEditor } from '../store';
import { DND_MIME } from './Canvas';

// 3D（等轴测）画布：平移、缩放、选择、拖动节点、旋转视角；连线、改字等结构编辑在 2D 里完成。

interface View {
  x: number;
  y: number;
  k: number;
}

const PAD = { top: 76, bottom: 60, left: 48, right: 48 };

export function IsoCanvas(props: { theme: 'light' | 'dark' }) {
  const nodes = useEditor((s) => s.nodes);
  const edges = useEditor((s) => s.edges);
  const title = useEditor((s) => s.title);
  const background = useEditor((s) => s.background);
  const direction = useEditor((s) => s.direction);
  const rotation = useEditor((s) => s.rotation) as Rot;
  const fitTick = useEditor((s) => s.fitTick);
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const dark = props.theme === 'dark' && !background;
  const paper = background || (dark ? '#1c1c1e' : '#ffffff');
  const ink = dark ? '#f5f5f7' : '#1d1d1f';
  const selected = useMemo(() => new Set(nodes.filter((n) => n.selected).map((n) => n.id)), [nodes]);
  const diagram = useMemo(
    () => toModel(nodes, edges, { title, background, direction, view: '3d', rotation }),
    [nodes, edges, title, background, direction, rotation],
  );
  const scene = useMemo(() => buildIsoScene(diagram, { rot: rotation, ink, paper, selected, idPrefix: 'cv' }), [diagram, rotation, ink, paper, selected]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const b = sceneRef.current.bounds;
    const cw = el.clientWidth - PAD.left - PAD.right;
    const ch = el.clientHeight - PAD.top - PAD.bottom;
    if (cw <= 0 || ch <= 0) return;
    const k = Math.min(1.1, cw / Math.max(b.width, 1), ch / Math.max(b.height, 1));
    setView({
      k,
      x: PAD.left + cw / 2 - (b.x + b.width / 2) * k,
      y: PAD.top + ch / 2 - (b.y + b.height / 2) * k,
    });
  }, []);

  // 进入 3D、旋转视角或请求适配时重新居中
  useLayoutEffect(fit, [fit, fitTick, rotation]);

  // 侧栏展开 / 收起导致画布尺寸变化时，保持画面中心不动
  useEffect(() => {
    const el = wrap.current!;
    let w = el.clientWidth;
    let h = el.clientHeight;
    const ro = new ResizeObserver(() => {
      const dw = el.clientWidth - w;
      const dh = el.clientHeight - h;
      w = el.clientWidth;
      h = el.clientHeight;
      if (dw || dh) setView((v) => ({ ...v, x: v.x + dw / 2, y: v.y + dh / 2 }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomAt = (factor: number, px?: number, py?: number) => {
    const el = wrap.current!;
    const v = viewRef.current;
    const cx = px ?? el.clientWidth / 2;
    const cy = py ?? el.clientHeight / 2;
    const k = Math.min(4, Math.max(0.1, v.k * factor));
    setView({ k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k });
  };

  // 滚轮平移、Ctrl/捏合缩放（与 2D 画布一致）；需要非被动监听才能阻止页面滚动
  useEffect(() => {
    const el = wrap.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Delete 删除选中元素（React Flow 未挂载时由这里处理）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') useEditor.getState().deleteSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const select = (ids: Set<string>) =>
    useEditor.getState().setNodes((ns) => ns.map((n) => (n.selected === ids.has(n.id) ? n : { ...n, selected: ids.has(n.id) })), false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    // 浮在画布上的控件自己处理点击，不能被指针捕获吞掉
    if ((e.target as Element).closest('button, .zoom-controls')) return;
    const el = wrap.current!;
    el.setPointerCapture(e.pointerId);
    const target = (e.target as Element).closest('[data-node]') as HTMLElement | null;
    const id = e.button === 0 ? target?.dataset.node : undefined;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const st = useEditor.getState;

    if (!id) {
      // 空白处拖动平移；单击清空选择
      const v0 = viewRef.current;
      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
        moved = true;
        setView({ ...v0, x: v0.x + ev.clientX - x0, y: v0.y + ev.clientY - y0 });
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        if (!moved) {
          select(new Set());
          useCode.getState().closePeek();
        }
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      return;
    }

    const multi = e.shiftKey || e.ctrlKey || e.metaKey;
    const cur = new Set(st().nodes.filter((n) => n.selected).map((n) => n.id));
    let sel = cur;
    if (multi) {
      sel = new Set(cur);
      if (sel.has(id)) sel.delete(id);
      else sel.add(id);
      select(sel);
    } else if (!cur.has(id)) {
      sel = new Set([id]);
      select(sel);
    }

    // 只移动"最外层"的选中节点，子节点随父分组移动
    const all = st().nodes;
    const byId = new Map(all.map((n) => [n.id, n]));
    const hasSelectedAncestor = (nid: string) => {
      let p = byId.get(nid)?.parentId;
      for (let g = 0; p && g < 50; g++) {
        if (sel.has(p)) return true;
        p = byId.get(p)?.parentId;
      }
      return false;
    };
    const movers = [...sel].filter((nid) => !hasSelectedAncestor(nid));
    const start = new Map(movers.map((nid) => [nid, { ...byId.get(nid)!.position }]));
    const rot = st().rotation as Rot;

    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      if (!moved) st().snapshot();
      moved = true;
      const k = viewRef.current.k;
      const [dx, dy] = unproject((ev.clientX - x0) / k, (ev.clientY - y0) / k, rot);
      st().setNodes(
        (ns) =>
          ns.map((n) => {
            const p = start.get(n.id);
            return p ? { ...n, position: { x: Math.round((p.x + dx) / 10) * 10, y: Math.round((p.y + dy) / 10) * 10 } } : n;
          }),
        false,
      );
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (moved || multi) return;
      // 单击带代码位置的节点：与 2D 一致，查看代码 / Alt 在编辑器中打开
      const n = st().nodes.find((x) => x.id === id);
      const ref = n?.data.ref;
      if (!n || !ref) return;
      const root = st().project?.rootPath;
      if (ev.altKey && root) openInEditor(loadSettings().editor, root, ref.path, ref.line);
      else useCode.getState().openPeek({ ref, label: n.data.label, nodeId: n.id });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const onDrop = (e: DragEvent) => {
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw) return;
    e.preventDefault();
    const { shape, icon, label } = JSON.parse(raw) as { shape: ShapeType; icon?: string; label?: string };
    const r = wrap.current!.getBoundingClientRect();
    const v = viewRef.current;
    const [x, y] = unproject((e.clientX - r.left - v.x) / v.k, (e.clientY - r.top - v.y) / v.k, rotation);
    useEditor.getState().addNode(shape, { x, y }, { ...(icon ? { icon } : {}), ...(label ? { label } : {}) });
  };

  return (
    <div
      ref={wrap}
      className="iso-canvas"
      onPointerDown={onPointerDown}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={onDrop}
    >
      <svg className="iso-svg" width="100%" height="100%">
        <defs dangerouslySetInnerHTML={{ __html: scene.defs }} />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {scene.layers.map((l, i) =>
            l.id ? (
              <g
                key={l.id}
                data-node={l.id}
                className={'iso-node' + (selected.has(l.id) ? ' selected' : '')}
                dangerouslySetInnerHTML={{ __html: l.svg }}
              />
            ) : (
              <g key={'_' + l.kind + i} className={'iso-' + l.kind} dangerouslySetInnerHTML={{ __html: l.svg }} />
            ),
          )}
        </g>
      </svg>
      <div className="zoom-controls">
        <button className="icon-btn" onClick={() => zoomAt(1 / 1.2)} title="缩小" aria-label="缩小">
          <Minus size={15} />
        </button>
        <button className="zoom-value tabular" onClick={() => zoomAt(1 / view.k)} title="重置为 100%">
          {Math.round(view.k * 100)}%
        </button>
        <button className="icon-btn" onClick={() => zoomAt(1.2)} title="放大" aria-label="放大">
          <Plus size={15} />
        </button>
        <span className="tb-sep" />
        <button className="icon-btn" onClick={fit} title="适应画布" aria-label="适应画布">
          <Maximize size={14} />
        </button>
        <button className="icon-btn" onClick={() => useEditor.getState().rotate(-1)} title="向左旋转视角" aria-label="向左旋转视角">
          <RotateCcw size={14} />
        </button>
        <button className="icon-btn" onClick={() => useEditor.getState().rotate(1)} title="向右旋转视角" aria-label="向右旋转视角">
          <RotateCw size={14} />
        </button>
      </div>
      <div className="iso-hint">3D 视图 · 拖动节点移动，滚轮平移，Ctrl+滚轮缩放 · 连线与改字请切回 2D</div>
    </div>
  );
}
