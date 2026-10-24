import { useReactFlow } from '@xyflow/react';
import { Search } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { ICONS } from '../lib/icons';
import { SHAPE_CATALOG, shapePrimitives } from '../lib/shapes';
import { nodeStyle, type ShapeType } from '../lib/types';
import { useEditor } from '../store';
import { DND_MIME } from './Canvas';
import { ShapeSVG } from './ShapeNode';

function Preview({ shape }: { shape: ShapeType }) {
  const w = 40;
  const h = shape === 'circle' ? 30 : shape === 'actor' ? 34 : 26;
  const st = nodeStyle(shape, {});
  if (shape === 'text') return <span className="sp-text">Aa</span>;
  return (
    <svg width={w + 4} height={h + 4} viewBox={`-2 -2 ${w + 4} ${h + 4}`} overflow="visible">
      <ShapeSVG
        prims={shapePrimitives(shape, shape === 'circle' ? h : w, h)}
        fill={shape === 'group' ? 'var(--primary-soft)' : 'var(--panel)'}
        stroke="var(--text-2)"
        strokeWidth={1.3}
        dashed={st.dashed}
      />
    </svg>
  );
}

export function ShapePanel() {
  const rf = useReactFlow();
  const [q, setQ] = useState('');

  const addAtCenter = (shape: ShapeType, extra?: { icon?: string; label?: string }) => {
    const el = document.querySelector('.canvas-wrap')!.getBoundingClientRect();
    const pos = rf.screenToFlowPosition({ x: el.left + el.width / 2, y: el.top + el.height / 2 });
    const jitter = () => (Math.random() - 0.5) * 60;
    useEditor.getState().addNode(shape, { x: pos.x + jitter(), y: pos.y + jitter() }, extra);
  };
  const drag = (e: DragEvent, payload: object) => {
    e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const kw = q.trim().toLowerCase();
  const shapes = SHAPE_CATALOG.filter((s) => !kw || s.name.includes(kw) || s.type.includes(kw));
  const icons = Object.entries(ICONS).filter(([k, v]) => !kw || k.includes(kw) || v.name.includes(kw));

  return (
    <aside className="side-left card" aria-label="图形库">
      <div className="panel-title">图形库</div>
      <label className="search-field">
        <Search size={14} />
        <input placeholder="搜索图形或图标" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="side-scroll">
        {shapes.length > 0 && <div className="section-label">基础图形</div>}
        <div className="shape-grid">
          {shapes.map((s) => (
            <button
              key={s.type}
              className="shape-tile"
              draggable
              onDragStart={(e) => drag(e, { shape: s.type })}
              onClick={() => addAtCenter(s.type)}
              title={`${s.name}（点击或拖入画布）`}
            >
              <Preview shape={s.type} />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
        {icons.length > 0 && <div className="section-label">图标节点</div>}
        <div className="icon-grid">
          {icons.map(([key, { icon: I, name }]) => (
            <button
              key={key}
              className="icon-tile"
              draggable
              onDragStart={(e) => drag(e, { shape: 'rounded', icon: key, label: name })}
              onClick={() => addAtCenter('rounded', { icon: key, label: name })}
              title={name}
            >
              <I size={18} strokeWidth={1.6} />
            </button>
          ))}
        </div>
        {!shapes.length && !icons.length && <div className="muted empty-small">没有匹配的图形</div>}
      </div>
    </aside>
  );
}
