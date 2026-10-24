import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

// ---------- 浮层 ----------

export function Popover(props: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose(): void;
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  placement?: 'bottom' | 'top';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!props.open || !props.anchor || !ref.current) return;
    const a = props.anchor.getBoundingClientRect();
    const p = ref.current.getBoundingClientRect();
    let left = props.align === 'right' ? a.right - p.width : props.align === 'center' ? a.left + a.width / 2 - p.width / 2 : a.left;
    left = Math.max(8, Math.min(left, window.innerWidth - p.width - 8));
    let top = props.placement === 'top' ? a.top - p.height - 6 : a.bottom + 6;
    if (top + p.height > window.innerHeight - 8) top = Math.max(8, a.top - p.height - 6);
    setPos({ left, top });
  }, [props.open, props.anchor, props.align, props.placement]);

  useEffect(() => {
    if (!props.open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || props.anchor?.contains(t)) return;
      props.onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [props.open, props.anchor, props.onClose]);

  if (!props.open) return null;
  return createPortal(
    <div
      ref={ref}
      className={'popover ' + (props.className ?? '')}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, transformOrigin: props.align === 'right' ? 'top right' : 'top left' }}
    >
      {props.children}
    </div>,
    document.body,
  );
}

export function MenuItem(props: { icon?: ReactNode; label: string; hint?: string; onClick(): void; disabled?: boolean }) {
  return (
    <div
      className={'menu-item' + (props.disabled ? ' disabled' : '')}
      onClick={() => !props.disabled && props.onClick()}
      role="menuitem"
    >
      <span className="menu-icon">{props.icon}</span>
      <span className="menu-label">{props.label}</span>
      {props.hint && <span className="menu-shortcut">{props.hint}</span>}
    </div>
  );
}

// ---------- 对话框 ----------

export function Modal(props: { title: string; onClose(): void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [props.onClose]);
  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" style={{ width: props.width ?? 480 }} role="dialog" aria-label={props.title}>
        <div className="modal-header" style={{ cursor: 'default' }}>
          <span>{props.title}</span>
          <button className="modal-x" onClick={props.onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-footer">{props.footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- 分段控件 ----------

export function Seg<T extends string>(props: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange(v: T): void; small?: boolean }) {
  return (
    <div className={'seg' + (props.small ? ' seg-sm' : '')} role="tablist">
      {props.options.map((o) => (
        <button
          key={o.value}
          className={o.value === props.value ? 'active' : ''}
          onClick={() => props.onChange(o.value)}
          title={o.title}
          role="tab"
          aria-selected={o.value === props.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- 颜色 ----------

const SWATCHES = [
  '#ffffff', '#f5f5f7', '#e8f2fd', '#e9f7ed', '#fff3e6', '#fdeceb', '#f3eefc', '#fff8db',
  '#1d1d1f', '#6e6e73', '#0071e3', '#248a3d', '#c93400', '#d70015', '#8944ab', '#d4a000',
];

export function ColorField(props: { value: string | undefined; onChange(v: string): void; allowNone?: boolean }) {
  const v = props.value ?? '';
  const hex = /^#[0-9a-f]{6}$/i.test(v) ? v : '#ffffff';
  return (
    <div className="color-field">
      <div className="cf-swatches">
        {props.allowNone && (
          <button className={'swatch swatch-none' + (v === 'none' ? ' on' : '')} title="无" onClick={() => props.onChange('none')} />
        )}
        {SWATCHES.map((c) => (
          <button
            key={c}
            className={'swatch' + (v.toLowerCase() === c ? ' on' : '')}
            style={{ background: c }}
            title={c}
            onClick={() => props.onChange(c)}
          />
        ))}
        <label className="swatch swatch-custom" title="自定义颜色">
          <input type="color" value={hex} onChange={(e) => props.onChange(e.target.value)} />
        </label>
      </div>
    </div>
  );
}

// ---------- 提示 ----------

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
  show: boolean;
}
const useToasts = create<{ list: Toast[] }>(() => ({ list: [] }));
let tid = 0;

export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = ++tid;
  useToasts.setState((s) => ({ list: [...s.list, { id, text, kind, show: false }] }));
  requestAnimationFrame(() => useToasts.setState((s) => ({ list: s.list.map((t) => (t.id === id ? { ...t, show: true } : t)) })));
  setTimeout(() => useToasts.setState((s) => ({ list: s.list.map((t) => (t.id === id ? { ...t, show: false } : t)) })), 2600);
  setTimeout(() => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) })), 3000);
}

export function ToastHost() {
  const list = useToasts((s) => s.list);
  return createPortal(
    <div className="toast-host">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}` + (t.show ? ' show' : '')}>
          {t.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ---------- 确认框 ----------

export function Confirm(props: { title: string; message: string; danger?: boolean; okText?: string; onOk(): void; onClose(): void }) {
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      width={380}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            取消
          </button>
          <button
            className={'btn ' + (props.danger ? 'btn-danger-solid' : 'btn-primary')}
            onClick={() => {
              props.onOk();
              props.onClose();
            }}
            autoFocus
          >
            {props.okText ?? '确定'}
          </button>
        </>
      }
    >
      <div className="modal-msg">{props.message}</div>
    </Modal>
  );
}
