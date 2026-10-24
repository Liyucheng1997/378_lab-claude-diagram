import {
  ChevronDown, ClipboardCopy, Download, FileCode2, FileImage, FileJson, FilePlus, FileText, FileType, FolderOpen,
  Moon, Settings as SettingsIcon, Shapes, Sun, Trash, Upload,
} from 'lucide-react';
import { useRef, useState } from 'react';
import {
  diagramToBlob, diagramToDrawio, diagramToJSON, diagramToMermaid, diagramToPDF, diagramToSVG, downloadBlob, downloadText, safeFileName,
} from '../lib/exporters';
import { importFile } from '../lib/importers';
import { deleteDoc, listDocs, type DocMeta } from '../lib/storage';
import { saveNow } from '../persist';
import { useEditor } from '../store';
import { Confirm, MenuItem, Popover, toast } from './ui';

function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return new Date(t).toLocaleDateString();
}

export function TitleBar(props: { theme: 'light' | 'dark'; onToggleTheme(): void; onOpenSettings(): void }) {
  const title = useEditor((s) => s.title);
  const docId = useEditor((s) => s.docId);
  const busy = useEditor((s) => s.busy);
  const [docsEl, setDocsEl] = useState<HTMLElement | null>(null);
  const [exportEl, setExportEl] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState<'docs' | 'export' | null>(null);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [toDelete, setToDelete] = useState<DocMeta | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const st = useEditor.getState;

  const doExport = async (kind: string) => {
    setOpen(null);
    const d = st().getDiagram();
    if (!d.nodes.length) return toast('画布还是空的');
    const name = safeFileName(d.title);
    try {
      switch (kind) {
        case 'png':
          downloadBlob(await diagramToBlob(d, 'image/png', 2), name + '.png');
          break;
        case 'png-t':
          downloadBlob(await diagramToBlob(d, 'image/png', 2, true), name + '.png');
          break;
        case 'jpg':
          downloadBlob(await diagramToBlob(d, 'image/jpeg', 2), name + '.jpg');
          break;
        case 'svg':
          downloadText(diagramToSVG(d).svg, name + '.svg', 'image/svg+xml');
          break;
        case 'pdf':
          downloadBlob(await diagramToPDF(d), name + '.pdf');
          break;
        case 'drawio':
          downloadText(diagramToDrawio(d), name + '.drawio', 'application/xml');
          break;
        case 'json':
          downloadText(diagramToJSON(d), name + '.json', 'application/json');
          break;
        case 'mermaid':
          downloadText(diagramToMermaid(d), name + '.mmd', 'text/plain');
          break;
        case 'copy': {
          const blob = await diagramToBlob(d, 'image/png', 2);
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          toast('已复制为图片', 'success');
          return;
        }
        case 'copy-mermaid':
          await navigator.clipboard.writeText(diagramToMermaid(d));
          toast('已复制 Mermaid 代码', 'success');
          return;
      }
      toast('已导出', 'success');
    } catch (e) {
      toast('导出失败：' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  };

  const onImport = async (f: File) => {
    try {
      const d = await importFile(f);
      saveNow();
      st().newDocument();
      st().setDiagram(d, { fit: true, record: false });
      toast(`已打开「${d.title}」`, 'success');
    } catch (e) {
      toast('打开失败：' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  };

  return (
    <header className="titlebar">
      <div className="brand">
        <div className="logo-mark">
          <Shapes size={17} />
        </div>
        <div className="brand-text">
          <div className="brand-name">Claude 绘图</div>
          <div className="brand-sub">AI Diagram Studio</div>
        </div>
      </div>

      <div className="doc-title">
        <input
          className="title-input"
          value={title}
          onChange={(e) => st().setTitle(e.target.value)}
          aria-label="图表标题"
          spellCheck={false}
        />
        <button
          ref={setDocsEl}
          className="icon-btn"
          title="我的图表"
          aria-label="我的图表"
          onClick={() => {
            saveNow();
            setDocs(listDocs());
            setOpen(open === 'docs' ? null : 'docs');
          }}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      <div className="tb-spacer" />

      <button className="btn btn-sm tb-hide-sm" onClick={() => fileInput.current?.click()} title="打开 .json / .drawio 文件">
        <Upload size={14} />
        打开
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,.drawio,.xml,.dio"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = '';
        }}
      />
      <button ref={setExportEl} className="btn btn-primary btn-sm" onClick={() => setOpen(open === 'export' ? null : 'export')}>
        <Download size={14} />
        导出
      </button>
      <button className="tb-round" onClick={props.onOpenSettings} title="设置" aria-label="设置">
        <SettingsIcon size={16} />
      </button>
      <button className="tb-round" onClick={props.onToggleTheme} title="切换深色模式" aria-label="切换深色模式">
        {props.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <Popover anchor={docsEl} open={open === 'docs'} onClose={() => setOpen(null)} className="menu docs-menu">
        <MenuItem
          icon={<FilePlus size={15} />}
          label="新建图表"
          disabled={busy}
          onClick={() => {
            saveNow();
            st().newDocument();
            setOpen(null);
          }}
        />
        <MenuItem icon={<FolderOpen size={15} />} label="打开文件…" hint=".json .drawio" onClick={() => (setOpen(null), fileInput.current?.click())} />
        <div className="menu-sep" />
        <div className="menu-header">最近的图表</div>
        {docs.length === 0 && <div className="menu-empty">还没有保存的图表</div>}
        <div className="docs-scroll">
          {docs.map((d) => (
            <div
              key={d.id}
              className={'menu-item doc-item' + (d.id === docId ? ' current' : '')}
              onClick={() => {
                if (busy) return;
                saveNow();
                st().loadDocument(d.id);
                setOpen(null);
              }}
            >
              <span className="menu-icon">
                <FileText size={15} />
              </span>
              <span className="menu-label">{d.title || '未命名图表'}</span>
              <span className="menu-shortcut tabular">{timeAgo(d.updatedAt)}</span>
              {d.id !== docId && (
                <button
                  className="doc-del"
                  title="删除"
                  aria-label="删除"
                  onClick={(e) => {
                    e.stopPropagation();
                    setToDelete(d);
                  }}
                >
                  <Trash size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      </Popover>

      <Popover anchor={exportEl} open={open === 'export'} onClose={() => setOpen(null)} align="right" className="menu">
        <div className="menu-header">图片</div>
        <MenuItem icon={<FileImage size={15} />} label="PNG 图片" hint="2x" onClick={() => doExport('png')} />
        <MenuItem icon={<FileImage size={15} />} label="PNG（透明背景）" onClick={() => doExport('png-t')} />
        <MenuItem icon={<FileImage size={15} />} label="JPG 图片" onClick={() => doExport('jpg')} />
        <MenuItem icon={<FileType size={15} />} label="SVG 矢量图" onClick={() => doExport('svg')} />
        <MenuItem icon={<FileText size={15} />} label="PDF 文档" onClick={() => doExport('pdf')} />
        <div className="menu-sep" />
        <div className="menu-header">可编辑格式</div>
        <MenuItem icon={<FileCode2 size={15} />} label="draw.io 文件" hint=".drawio" onClick={() => doExport('drawio')} />
        <MenuItem icon={<FileJson size={15} />} label="JSON（可重新打开）" hint=".json" onClick={() => doExport('json')} />
        <MenuItem icon={<FileCode2 size={15} />} label="Mermaid 代码" hint=".mmd" onClick={() => doExport('mermaid')} />
        <div className="menu-sep" />
        <MenuItem icon={<ClipboardCopy size={15} />} label="复制为图片" onClick={() => doExport('copy')} />
        <MenuItem icon={<ClipboardCopy size={15} />} label="复制 Mermaid 代码" onClick={() => doExport('copy-mermaid')} />
      </Popover>

      {toDelete && (
        <Confirm
          title="删除图表？"
          message={`「${toDelete.title || '未命名图表'}」将从本机浏览器中删除，无法恢复。`}
          danger
          okText="删除"
          onOk={() => {
            deleteDoc(toDelete.id);
            setDocs(listDocs());
          }}
          onClose={() => setToDelete(null)}
        />
      )}
    </header>
  );
}
