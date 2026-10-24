import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import type { ShapeRFNode } from '../lib/convert';
import { ICONS } from '../lib/icons';
import { labelBox, shapePrimitives, type Primitive } from '../lib/shapes';
import { nodeStyle } from '../lib/types';
import { useEditor } from '../store';

export function ShapeSVG(props: { prims: Primitive[]; fill: string; stroke: string; strokeWidth: number; dashed?: boolean }) {
  const common = {
    stroke: props.stroke,
    strokeWidth: props.strokeWidth,
    strokeDasharray: props.dashed ? '6 4' : undefined,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  };
  return (
    <>
      {props.prims.map((p, i) => {
        const fill = p.noFill ? 'none' : props.fill;
        if (p.tag === 'rect') return <rect key={i} x={p.x} y={p.y} width={p.width} height={p.height} rx={p.rx} fill={fill} {...common} />;
        if (p.tag === 'ellipse') return <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill={fill} {...common} />;
        return <path key={i} d={p.d} fill={fill} {...common} />;
      })}
    </>
  );
}

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

function ShapeNodeImpl({ id, data, selected, width, height }: NodeProps<ShapeRFNode>) {
  const w = width ?? 160;
  const h = height ?? 64;
  const st = nodeStyle(data.shape, data.style);
  const box = labelBox(data.shape, w, h);
  const Icon = data.icon && data.shape !== 'group' ? ICONS[data.icon]?.icon : undefined;
  const iconSize = Icon ? Math.round(Math.min(28, Math.max(18, h * 0.32))) : 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(data.label);
      requestAnimationFrame(() => {
        ta.current?.focus();
        ta.current?.select();
      });
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    setEditing(false);
    if (draft !== data.label) useEditor.getState().updateNodeData([id], () => ({ label: draft }));
  };

  return (
    <div className={`shape-node shape-${data.shape}`} style={{ width: w, height: h }} onDoubleClick={() => setEditing(true)}>
      <NodeResizer
        isVisible={!!selected}
        minWidth={data.shape === 'text' ? 30 : 40}
        minHeight={24}
        onResizeStart={() => useEditor.getState().snapshot()}
        lineClassName="rs-line"
        handleClassName="rs-handle"
      />
      <svg className="shape-svg" width={w} height={h}>
        <ShapeSVG prims={shapePrimitives(data.shape, w, h)} fill={st.fill} stroke={st.stroke} strokeWidth={st.strokeWidth} dashed={st.dashed} />
      </svg>
      <div
        className={`shape-label align-${box.align} valign-${box.valign}`}
        style={{
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          color: st.textColor,
          fontSize: st.fontSize,
          fontWeight: st.bold ? 600 : 400,
        }}
      >
        {Icon && <Icon size={iconSize} strokeWidth={1.75} className="shape-icon" />}
        {editing ? (
          <textarea
            ref={ta}
            className="label-editor nodrag nowheel"
            value={draft}
            style={{ fontSize: st.fontSize, color: st.textColor, textAlign: box.align === 'left' ? 'left' : 'center' }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') setEditing(false);
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
            }}
          />
        ) : (
          data.label && <span className="label-text">{data.label}</span>
        )}
      </div>
      {SIDES.map((p) => (
        <Handle key={p} id={p} type="source" position={p} className="hd" />
      ))}
    </div>
  );
}

export const ShapeNode = memo(ShapeNodeImpl);
