import { Check, ChevronRight, Copy, ExternalLink, FileCode, Folder, FolderOpen, Link2, RefreshCw, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { editorName, openInEditor } from '../code/editor';
import { rememberRoot } from '../code/handles';
import { highlight } from '../code/highlight';
import { reconnectProject, useCode } from '../code/store';
import type { CodeRef, LoadedProject } from '../code/types';
import { loadSettings } from '../lib/storage';
import { useEditor } from '../store';
import { toast } from './ui';

// 代码速览：点击带代码位置的节点后浮在画布右侧，显示对应文件并高亮代码块。

const WIDTH_KEY = 'cd.code.peekWidth';
/** 超大文件只渲染目标附近的这么多行 */
const WINDOW = 2400;

function loadWidth() {
  try {
    return Math.min(900, Math.max(320, Number(localStorage.getItem(WIDTH_KEY)) || 480));
  } catch {
    return 480;
  }
}

function CodeView({ project, at: r }: { project: LoadedProject; at: CodeRef }) {
  const file = project.files.get(r.path)!;
  const box = useRef<HTMLDivElement>(null);
  const all = useMemo(() => file.text.split('\n'), [file]);
  const target = r.line ?? 1;
  const from = all.length > WINDOW ? Math.max(1, target - WINDOW / 2) : 1;
  const to = Math.min(all.length, from + WINDOW - 1);
  const tokens = useMemo(() => highlight(all.slice(from - 1, to), file.lang), [all, from, to, file.lang]);
  const end = r.line ? Math.max(r.line, r.endLine ?? r.line) : 0;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const row = el.querySelector<HTMLElement>(`[data-line="${target}"]`);
    el.scrollTop = row && r.line ? Math.max(0, row.offsetTop - 72) : 0;
  }, [file, target, r.line]);

  return (
    <div className="cp-code" ref={box}>
      {from > 1 && <div className="cp-gap">… 前面省略 {from - 1} 行</div>}
      {tokens.map((line, i) => {
        const n = from + i;
        const cls = n === r.line ? ' hl-start' : r.line && n > r.line && n <= end ? ' hl' : '';
        return (
          <div key={n} className={'cp-line' + cls} data-line={n}>
            <span className="cp-ln">{n}</span>
            <span className="cp-src">
              {line.map((tk, j) => (tk.c ? <span key={j} className={'tk-' + tk.c}>{tk.t}</span> : tk.t))}
              {'\n'}
            </span>
          </div>
        );
      })}
      {to < all.length && <div className="cp-gap">… 后面省略 {all.length - to} 行</div>}
    </div>
  );
}

function DirView({ project, path, onOpen }: { project: LoadedProject; path: string; onOpen(p: string): void }) {
  const prefix = path ? path + '/' : '';
  const dirs = [...project.dirs].filter((d) => d.startsWith(prefix) && !d.slice(prefix.length).includes('/')).sort();
  const files = [...project.files.values()].filter((f) => f.path.startsWith(prefix) && !f.path.slice(prefix.length).includes('/'));
  return (
    <div className="cp-dir">
      {dirs.map((d) => (
        <button key={d} className="cp-entry" onClick={() => onOpen(d)}>
          <Folder size={14} />
          <span className="cp-entry-name">{d.slice(prefix.length)}/</span>
          <ChevronRight size={13} className="muted" />
        </button>
      ))}
      {files.map((f) => (
        <button key={f.path} className="cp-entry" onClick={() => onOpen(f.path)}>
          <FileCode size={14} />
          <span className="cp-entry-name">{f.path.slice(prefix.length)}</span>
          <span className="cp-entry-meta tabular">{f.lines} 行</span>
        </button>
      ))}
      {!dirs.length && !files.length && <div className="cp-empty">目录中没有可显示的文件</div>}
    </div>
  );
}

export function CodePeek() {
  const peek = useCode((s) => s.peek);
  const project = useCode((s) => s.project);
  const scanning = useCode((s) => s.scanning);
  const meta = useEditor((s) => s.project);
  const [width, setWidth] = useState(loadWidth);
  const [editRoot, setEditRoot] = useState(false);
  const [rootDraft, setRootDraft] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEditRoot(false);
  }, [peek]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === 'Escape' && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) useCode.getState().closePeek();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!peek) return null;
  const r = peek.ref;
  const name = meta?.name ?? project?.name ?? '';
  const ready = !!project && (!meta || project.name === meta.name);
  const isFile = ready && project.files.has(r.path);
  const isDir = ready && !isFile && (r.path === '' || project.dirs.has(r.path));
  const loc = r.path + (r.line ? `:${r.line}` : '');
  const root = meta?.rootPath ?? '';

  const navigate = (path: string) => useCode.getState().openPeek({ ref: { path }, label: undefined, nodeId: peek.nodeId });

  const openExternal = () => {
    if (!root) {
      setRootDraft('');
      setEditRoot(true);
      return;
    }
    openInEditor(loadSettings().editor, root, r.path, r.line);
  };

  const saveRoot = () => {
    const v = rootDraft.trim();
    if (!meta) return;
    useEditor.getState().setProject({ ...meta, rootPath: v || undefined });
    rememberRoot(meta.name, v);
    setEditRoot(false);
    if (v) openInEditor(loadSettings().editor, v, r.path, r.line);
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    let w = w0;
    const move = (ev: PointerEvent) => {
      w = Math.min(900, Math.max(320, w0 + x0 - ev.clientX));
      setWidth(w);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(w)));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const crumbs = r.path ? r.path.split('/') : [];

  return (
    <div className="code-peek" style={{ width }} onWheel={(e) => e.stopPropagation()}>
      <div className="cp-resize" onPointerDown={startResize} />
      <div className="cp-head">
        <div className="cp-title-row">
          <div className="cp-title">{peek.label || crumbs[crumbs.length - 1] || name}</div>
          <button
            className="icon-btn"
            title="复制位置"
            aria-label="复制位置"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(loc);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              } catch {
                toast('复制失败', 'error');
              }
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button className="icon-btn" title={`在 ${editorName(loadSettings().editor)} 中打开`} aria-label="在编辑器中打开" onClick={openExternal}>
            <ExternalLink size={14} />
          </button>
          <button className="icon-btn" title="关闭（Esc）" aria-label="关闭" onClick={() => useCode.getState().closePeek()}>
            <X size={15} />
          </button>
        </div>
        <div className="cp-crumbs">
          <button className="cp-crumb" onClick={() => navigate('')} disabled={!ready}>
            {name || '项目'}
          </button>
          {crumbs.map((c, i) => (
            <span key={i} className="cp-crumb-wrap">
              <ChevronRight size={11} />
              <button className="cp-crumb" onClick={() => navigate(crumbs.slice(0, i + 1).join('/'))} disabled={!ready || i === crumbs.length - 1}>
                {c}
              </button>
            </span>
          ))}
          {r.line && (
            <span className="cp-lines tabular">
              {r.endLine && r.endLine > r.line ? `第 ${r.line}–${r.endLine} 行` : `第 ${r.line} 行`}
            </span>
          )}
        </div>
        {r.note && <div className="cp-note">{r.note}</div>}
        {editRoot && (
          <div className="cp-root">
            <div className="cp-root-hint">
              浏览器无法获得文件夹的完整路径。填写项目在本机的位置后，即可在 {editorName(loadSettings().editor)} 中直接打开（编辑器可在「设置」中切换）。
            </div>
            <div className="cp-root-row">
              <input
                className="input"
                autoFocus
                placeholder={`例如 D:\\code\\${name || 'my-app'}`}
                value={rootDraft}
                onChange={(e) => setRootDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveRoot()}
                spellCheck={false}
              />
              <button className="btn btn-primary btn-sm" onClick={saveRoot} disabled={!meta}>
                打开
              </button>
            </div>
          </div>
        )}
      </div>

      {ready && isFile ? (
        <CodeView project={project} at={r} />
      ) : ready && isDir ? (
        <DirView project={project} path={r.path} onOpen={navigate} />
      ) : ready ? (
        <div className="cp-empty">
          项目中找不到 <code>{r.path}</code>，可能文件已被移动或删除。
        </div>
      ) : (
        <div className="cp-empty cp-connect">
          <FolderOpen size={28} strokeWidth={1.5} />
          <div>
            {scanning !== null ? `正在读取项目文件… ${scanning}` : name ? `项目「${name}」的代码还没有加载` : '这个节点关联了代码，但当前图表没有打开项目'}
          </div>
          {name && scanning === null && (
            <button
              className="btn btn-primary btn-sm"
              onClick={async () => {
                try {
                  const p = await reconnectProject(name, true);
                  if (p && p.name !== name) toast(`打开的是「${p.name}」，与图表关联的「${name}」不同`, 'error');
                } catch (e) {
                  toast('打开失败：' + (e instanceof Error ? e.message : String(e)), 'error');
                }
              }}
            >
              <RefreshCw size={13} /> 重新连接项目
            </button>
          )}
          {root && (
            <button className="btn btn-sm btn-ghost" onClick={openExternal}>
              <Link2 size={13} /> 直接在编辑器中打开
            </button>
          )}
        </div>
      )}
    </div>
  );
}
