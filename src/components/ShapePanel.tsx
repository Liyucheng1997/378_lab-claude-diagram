import { useReactFlow } from '@xyflow/react';
import { Search } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { assetPreviewSVG, ISO_ASSETS } from '../lib/iso';
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

const previews = new Map<string, string>();
/** 3D 素材预览只生成一次 */
function AssetPreview({ icon }: { icon: string }) {
  if (!previews.has(icon)) previews.set(icon, assetPreviewSVG(icon, 46));
  return <span className="asset-preview" dangerouslySetInnerHTML={{ __html: previews.get(icon)! }} />;
}

// 别名素材（与其他素材外观相同）不重复展示
const ASSET_TILES = ISO_ASSETS.filter((k) => !['inbox', 'wifi', 'box'].includes(k) && ICONS[k]);

export function ShapePanel() {
  const rf = useReactFlow();
  const [q, setQ] = useState('');
  const view = useEditor((s) => s.view);

  const addAtCenter = (shape: ShapeType, extra?: { icon?: string; label?: string }) => {
    const jitter = () => (Math.random() - 0.5) * 60;
    if (useEditor.getState().view === '3d') {
      // 3D 视图下 React Flow 未挂载：放在现有图形的中心附近
      const ns = useEditor.getState().getDiagram().nodes;
      const cx = ns.length ? ns.reduce((a, n) => a + n.x + n.width / 2, 0) / ns.length : 0;
      const cy = ns.length ? ns.reduce((a, n) => a + n.y + n.height / 2, 0) / ns.length : 0;
      useEditor.getState().addNode(shape, { x: cx + jitter(), y: cy + jitter() }, extra);
      return;
    }
    const el = document.querySelector('.canvas-wrap')!.getBoundingClientRect();
    const pos = rf.screenToFlowPosition({ x: el.left + el.width / 2, y: el.top + el.height / 2 });
    useEditor.getState().addNode(shape, { x: pos.x + jitter(), y: pos.y + jitter() }, extra);
  };
  const drag = (e: DragEvent, payload: object) => {
    e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const kw = q.trim().toLowerCase();
  const shapes = SHAPE_CATALOG.filter((s) => !kw || s.name.includes(kw) || s.type.includes(kw));
  const icons = Object.entries(ICONS).filter(([k, v]) => !kw || k.includes(kw) || v.name.includes(kw));
  const assets = view === '3d' ? ASSET_TILES.filter((k) => !kw || k.includes(kw) || ICONS[k].name.includes(kw) || '3d'.includes(kw)) : [];

  return (
    <aside className="side-left card" aria-label="图形库">
      <div className="panel-title">图形库</div>
      <label className="search-field">
        <Search size={14} />
        <input placeholder="搜索图形或图标" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="side-scroll">
        {assets.length > 0 && <div className="section-label">3D 素材</div>}
        {assets.length > 0 && (
          <div className="shape-grid asset-grid">
            {assets.map((k) => (
              <button
                key={k}
                className="shape-tile"
                draggable
                onDragStart={(e) => drag(e, { shape: 'rounded', icon: k, label: ICONS[k].name })}
                onClick={() => addAtCenter('rounded', { icon: k, label: ICONS[k].name })}
                title={`${ICONS[k].name}（点击或拖入画布）`}
              >
                <AssetPreview icon={k} />
                <span>{ICONS[k].name}</span>
              </button>
            ))}
          </div>
        )}
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
        {!shapes.length && !icons.length && !assets.length && <div className="muted empty-small">没有匹配的图形</div>}
      </div>
    </aside>
  );
}
