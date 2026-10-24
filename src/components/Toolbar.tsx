import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, LayoutGrid, Palette, Redo2, Trash, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { autoLayout } from '../lib/layout';
import { applyPalette, PALETTES } from '../lib/palettes';
import type { Direction } from '../lib/types';
import { useEditor } from '../store';
import { Popover, Seg, toast } from './ui';

const DIRS: { d: Direction; label: string; icon: typeof ArrowDown }[] = [
  { d: 'DOWN', label: '自上而下', icon: ArrowDown },
  { d: 'RIGHT', label: '自左向右', icon: ArrowRight },
  { d: 'UP', label: '自下而上', icon: ArrowUp },
  { d: 'LEFT', label: '自右向左', icon: ArrowLeft },
];

export async function relayout(direction?: Direction) {
  const s = useEditor.getState();
  if (!s.nodes.length) return;
  const d = await autoLayout(s.getDiagram(), direction ?? s.direction);
  s.setDiagram(d, { fit: true });
}

export function Toolbar() {
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const hasSel = useEditor((s) => s.nodes.some((n) => n.selected) || s.edges.some((e) => e.selected));
  const direction = useEditor((s) => s.direction);
  const view = useEditor((s) => s.view);
  const [layoutEl, setLayoutEl] = useState<HTMLElement | null>(null);
  const [paletteEl, setPaletteEl] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState<'layout' | 'palette' | null>(null);
  const st = useEditor.getState;

  return (
    <div className="float-toolbar" role="toolbar">
      <Seg
        small
        value={view}
        onChange={(v) => st().setView(v)}
        options={[
          { value: '2d', label: '2D', title: '平面视图：可连线、改字、调整大小' },
          { value: '3d', label: '3D', title: '立体视图（等轴测）：可拖动节点、旋转视角' },
        ]}
      />
      <span className="tb-sep" />
      <button className="icon-btn" disabled={!canUndo} onClick={() => st().undo()} title="撤销 (Ctrl+Z)" aria-label="撤销">
        <Undo2 size={16} />
      </button>
      <button className="icon-btn" disabled={!canRedo} onClick={() => st().redo()} title="重做 (Ctrl+Shift+Z)" aria-label="重做">
        <Redo2 size={16} />
      </button>
      <span className="tb-sep" />
      <button ref={setLayoutEl} className="tb-btn" onClick={() => setOpen(open === 'layout' ? null : 'layout')} title="自动布局">
        <LayoutGrid size={15} />
        <span>自动布局</span>
      </button>
      <button ref={setPaletteEl} className="tb-btn" onClick={() => setOpen(open === 'palette' ? null : 'palette')} title="一键配色">
        <Palette size={15} />
        <span>配色</span>
      </button>
      <span className="tb-sep" />
      <button className="icon-btn" disabled={!hasSel} onClick={() => st().duplicateSelected()} title="复制一份 (Ctrl+D)" aria-label="复制">
        <Copy size={15} />
      </button>
      <button className="icon-btn" disabled={!hasSel} onClick={() => st().deleteSelected()} title="删除 (Delete)" aria-label="删除">
        <Trash size={15} />
      </button>

      <Popover anchor={layoutEl} open={open === 'layout'} onClose={() => setOpen(null)} className="menu">
        <div className="menu-header">按方向重新排版</div>
        {DIRS.map(({ d, label, icon: I }) => (
          <div
            key={d}
            className="menu-item"
            onClick={() => {
              setOpen(null);
              relayout(d).catch((e) => toast(String(e), 'error'));
            }}
          >
            <span className="menu-icon">
              <I size={15} />
            </span>
            <span className="menu-label">{label}</span>
            {d === direction && <span className="menu-shortcut">当前</span>}
          </div>
        ))}
      </Popover>

      <Popover anchor={paletteEl} open={open === 'palette'} onClose={() => setOpen(null)} className="palette-pop">
        <div className="menu-header">一键配色（可撤销）</div>
        <div className="palette-grid">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              className="palette-card"
              onClick={() => {
                const s = st();
                if (!s.nodes.length) return toast('画布还是空的');
                s.setDiagram(applyPalette(s.getDiagram(), p));
                setOpen(null);
              }}
            >
              <span className="palette-dots" style={{ background: p.background ?? 'var(--panel-2)' }}>
                {p.strokes.slice(0, 4).map((c, i) => (
                  <i key={i} style={{ background: p.fills[i % p.fills.length], borderColor: c }} />
                ))}
              </span>
              <span className="palette-name">{p.name}</span>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
