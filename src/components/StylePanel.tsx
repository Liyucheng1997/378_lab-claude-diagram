import { Bold, MousePointer2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ICONS } from '../lib/icons';
import { nodeDepth } from '../lib/iso';
import { applyPalette, PALETTES } from '../lib/palettes';
import { SHAPE_CATALOG } from '../lib/shapes';
import { edgeStyle, nodeStyle, type ArrowType, type EdgeStyle, type LineType, type NodeStyle } from '../lib/types';
import { useEditor } from '../store';
import { ColorField, Seg } from './ui';

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="sp-row">
      <div className="sp-label">{props.label}</div>
      <div className="sp-control">{props.children}</div>
    </div>
  );
}

function Num(props: { value: number; min: number; max: number; step?: number; onChange(v: number): void; suffix?: string }) {
  return (
    <div className="num-field">
      <input
        className="input tabular"
        type="number"
        value={Math.round(props.value * 100) / 100}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) props.onChange(Math.min(props.max, Math.max(props.min, v)));
        }}
      />
      {props.suffix && <span className="muted">{props.suffix}</span>}
    </div>
  );
}

export function StylePanel() {
  const nodes = useEditor(useShallow((s) => s.nodes.filter((n) => n.selected)));
  const edges = useEditor(useShallow((s) => s.edges.filter((e) => e.selected)));
  const background = useEditor((s) => s.background);
  const view = useEditor((s) => s.view);
  const st = useEditor.getState;

  if (!nodes.length && !edges.length) {
    return (
      <div className="style-panel">
        <div className="sp-empty">
          <MousePointer2 size={30} strokeWidth={1.4} />
          <div>选中图形或连线后在这里调整样式</div>
        </div>
        <div className="sp-section">
          <div className="sp-section-title">画布</div>
          <Row label="背景">
            <ColorField value={background} onChange={(c) => st().setBackground(c)} />
            <button className="btn btn-sm btn-ghost" onClick={() => st().setBackground('')}>
              恢复默认
            </button>
          </Row>
        </div>
        <div className="sp-section">
          <div className="sp-section-title">一键配色</div>
          <div className="palette-grid">
            {PALETTES.map((p) => (
              <button
                key={p.id}
                className="palette-card"
                onClick={() => st().nodes.length && st().setDiagram(applyPalette(st().getDiagram(), p))}
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
        </div>
      </div>
    );
  }

  const nIds = nodes.map((n) => n.id);
  const eIds = edges.map((e) => e.id);
  const first = nodes[0];
  const fs = first ? nodeStyle(first.data.shape, first.data.style) : undefined;
  const setN = (patch: NodeStyle) => st().updateNodeData(nIds, (d) => ({ style: { ...d.style, ...patch } }));
  const firstE = edges[0];
  const es = firstE ? edgeStyle(firstE.data?.style) : undefined;
  const setE = (patch: EdgeStyle) => st().updateEdgeData(eIds, (d) => ({ style: { ...d.style, ...patch } }));

  return (
    <div className="style-panel">
      {first && fs && (
        <div className="sp-section">
          <div className="sp-section-title">
            {nodes.length > 1 ? `${nodes.length} 个图形` : '图形'}
          </div>
          {nodes.length === 1 && (
            <Row label="文字">
              <textarea
                className="input"
                rows={2}
                value={first.data.label}
                onChange={(e) => {
                  // 连续输入只记一次历史：直接改数据，不经过 updateNodeData
                  const v = e.target.value;
                  useEditor.setState({ nodes: st().nodes.map((n) => (n.id === first.id ? { ...n, data: { ...n.data, label: v } } : n)) });
                }}
                onFocus={() => st().snapshot()}
              />
            </Row>
          )}
          <Row label="形状">
            <select
              className="input"
              value={nodes.every((n) => n.data.shape === first.data.shape) ? first.data.shape : ''}
              onChange={(e) => e.target.value && st().updateNodeData(nIds, () => ({ shape: e.target.value as never }))}
            >
              <option value="">—</option>
              {SHAPE_CATALOG.map((s) => (
                <option key={s.type} value={s.type}>
                  {s.name}
                </option>
              ))}
            </select>
          </Row>
          {first.data.shape !== 'group' && (
            <Row label="图标">
              <select
                className="input"
                value={first.data.icon ?? ''}
                onChange={(e) => st().updateNodeData(nIds, () => ({ icon: e.target.value || undefined }))}
              >
                <option value="">无</option>
                {Object.entries(ICONS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.name}（{k}）
                  </option>
                ))}
              </select>
            </Row>
          )}
          <Row label="填充">
            <ColorField value={fs.fill} allowNone onChange={(c) => setN({ fill: c })} />
          </Row>
          <Row label="边框">
            <ColorField value={fs.stroke} allowNone onChange={(c) => setN({ stroke: c })} />
          </Row>
          <Row label="边框样式">
            <div className="sp-inline">
              <Num value={fs.strokeWidth} min={0} max={10} step={0.5} onChange={(v) => setN({ strokeWidth: v })} suffix="px" />
              <Seg
                small
                value={fs.dashed ? 'dash' : 'solid'}
                options={[
                  { value: 'solid', label: '实线' },
                  { value: 'dash', label: '虚线' },
                ]}
                onChange={(v) => setN({ dashed: v === 'dash' })}
              />
            </div>
          </Row>
          <Row label="文字颜色">
            <ColorField value={fs.textColor} onChange={(c) => setN({ textColor: c })} />
          </Row>
          <Row label="字号">
            <div className="sp-inline">
              <Num value={fs.fontSize} min={8} max={72} onChange={(v) => setN({ fontSize: v })} suffix="px" />
              <button className={'icon-btn toggle' + (fs.bold ? ' on' : '')} onClick={() => setN({ bold: !fs.bold })} title="加粗" aria-label="加粗">
                <Bold size={15} />
              </button>
            </div>
          </Row>
          {nodes.length === 1 && (
            <Row label="尺寸">
              <div className="sp-inline">
                <Num value={first.width ?? 0} min={20} max={4000} onChange={(v) => st().setNodes((ns) => ns.map((n) => (n.id === first.id ? { ...n, width: v } : n)))} suffix="宽" />
                <Num value={first.height ?? 0} min={20} max={4000} onChange={(v) => st().setNodes((ns) => ns.map((n) => (n.id === first.id ? { ...n, height: v } : n)))} suffix="高" />
              </div>
            </Row>
          )}
          {view === '3d' && first.data.shape !== 'text' && (
            <Row label="3D 高度">
              <div className="sp-inline">
                <Num
                  value={nodeDepth({ id: first.id, label: '', shape: first.data.shape, x: 0, y: 0, width: first.width ?? 0, height: first.height ?? 0, style: first.data.style })}
                  min={1}
                  max={400}
                  onChange={(v) => setN({ depth: v })}
                  suffix="px"
                />
                {!!first.data.style.depth && (
                  <button className="btn btn-sm btn-ghost" onClick={() => setN({ depth: undefined })}>
                    自动
                  </button>
                )}
              </div>
            </Row>
          )}
        </div>
      )}

      {firstE && es && (
        <div className="sp-section">
          <div className="sp-section-title">{edges.length > 1 ? `${edges.length} 条连线` : '连线'}</div>
          {edges.length === 1 && (
            <Row label="文字">
              <input
                className="input"
                value={firstE.data?.label ?? ''}
                placeholder="双击连线也可编辑"
                onFocus={() => st().snapshot()}
                onChange={(e) => {
                  const v = e.target.value;
                  useEditor.setState({
                    edges: st().edges.map((x) => (x.id === firstE.id ? { ...x, data: { style: {}, ...x.data, label: v || undefined } } : x)),
                  });
                }}
              />
            </Row>
          )}
          <Row label="颜色">
            <ColorField value={es.color} onChange={(c) => setE({ color: c })} />
          </Row>
          <Row label="线型">
            <Seg<LineType>
              small
              value={es.lineType}
              options={[
                { value: 'smoothstep', label: '圆角' },
                { value: 'step', label: '直角' },
                { value: 'bezier', label: '曲线' },
                { value: 'straight', label: '直线' },
              ]}
              onChange={(v) => setE({ lineType: v })}
            />
          </Row>
          <Row label="箭头">
            <Seg<ArrowType>
              small
              value={es.arrow}
              options={[
                { value: 'end', label: '→', title: '终点' },
                { value: 'start', label: '←', title: '起点' },
                { value: 'both', label: '↔', title: '双向' },
                { value: 'none', label: '—', title: '无' },
              ]}
              onChange={(v) => setE({ arrow: v })}
            />
          </Row>
          <Row label="粗细">
            <div className="sp-inline">
              <Num value={es.width} min={0.5} max={10} step={0.5} onChange={(v) => setE({ width: v })} suffix="px" />
              <Seg
                small
                value={es.animated ? 'flow' : es.dashed ? 'dash' : 'solid'}
                options={[
                  { value: 'solid', label: '实线' },
                  { value: 'dash', label: '虚线' },
                  { value: 'flow', label: '流动' },
                ]}
                onChange={(v) => setE({ dashed: v === 'dash', animated: v === 'flow' })}
              />
            </div>
          </Row>
        </div>
      )}
    </div>
  );
}
