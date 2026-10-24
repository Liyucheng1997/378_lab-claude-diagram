import { BaseEdge, EdgeLabelRenderer, useInternalNode, type EdgeProps, type InternalNode } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import type { ShapeRFNode, SmartRFEdge } from '../lib/convert';
import { computeEdgePath } from '../lib/geometry';
import { edgeStyle } from '../lib/types';
import { useEditor } from '../store';

const rectOf = (n: InternalNode<ShapeRFNode>) => ({
  x: n.internals.positionAbsolute.x,
  y: n.internals.positionAbsolute.y,
  width: n.measured.width ?? n.width ?? 160,
  height: n.measured.height ?? n.height ?? 64,
});

function SmartEdgeImpl({ id, source, target, data, selected }: EdgeProps<SmartRFEdge>) {
  const s = useInternalNode<ShapeRFNode>(source);
  const t = useInternalNode<ShapeRFNode>(target);
  const editing = useEditor((st) => st.editingEdge === id);
  const [draft, setDraft] = useState(data?.label ?? '');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(data?.label ?? '');
      requestAnimationFrame(() => input.current?.select());
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s || !t) return null;
  const st = edgeStyle(data?.style);
  const { path, labelX, labelY } = computeEdgePath(rectOf(s), rectOf(t), st.lineType);
  const mid = 'mk-' + id.replace(/[^A-Za-z0-9_-]/g, '_');
  const color = selected ? 'var(--primary)' : st.color;
  const hasStart = st.arrow === 'start' || st.arrow === 'both';
  const hasEnd = st.arrow === 'end' || st.arrow === 'both';

  const commit = () => {
    const { setEditingEdge, updateEdgeData } = useEditor.getState();
    setEditingEdge(null);
    if (draft !== (data?.label ?? '')) updateEdgeData([id], () => ({ label: draft || undefined }));
  };

  return (
    <>
      <defs>
        <marker id={mid} viewBox="0 0 10 10" refX="9" refY="5" markerWidth={9 + st.width} markerHeight={9 + st.width} markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" style={{ fill: color }} />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={hasEnd ? `url(#${mid})` : undefined}
        markerStart={hasStart ? `url(#${mid})` : undefined}
        interactionWidth={18}
        className={st.animated ? 'edge-flow' : undefined}
        style={{ stroke: color, strokeWidth: selected ? st.width + 0.5 : st.width, strokeDasharray: st.dashed || st.animated ? '6 4' : undefined }}
      />
      {(data?.label || editing) && (
        <EdgeLabelRenderer>
          <div
            className={'edge-label nodrag nopan' + (selected ? ' selected' : '')}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onDoubleClick={() => useEditor.getState().setEditingEdge(id)}
          >
            {editing ? (
              <input
                ref={input}
                className="edge-label-input"
                value={draft}
                size={Math.max(4, draft.length + 1)}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') useEditor.getState().setEditingEdge(null);
                }}
              />
            ) : (
              data?.label
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const SmartEdge = memo(SmartEdgeImpl);
