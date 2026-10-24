import { ReactFlowProvider, useViewport } from '@xyflow/react';
import { FolderCode, PanelLeft, PanelRight, Sparkles, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Settings } from '../ai/types';
import { reconnectProject, useCode } from '../code/store';
import { loadSettings, loadTheme, saveSettings, saveTheme } from '../lib/storage';
import { onSaveState, saveNow } from '../persist';
import { useEditor } from '../store';
import { Canvas } from './Canvas';
import { CodeAnalysisDialog } from './CodeAnalysisDialog';
import { ChatPanel } from './ChatPanel';
import { SettingsDialog } from './SettingsDialog';
import { ShapePanel } from './ShapePanel';
import { StylePanel } from './StylePanel';
import { TitleBar } from './TitleBar';
import { Seg, toast, ToastHost } from './ui';

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      const s = useEditor.getState();
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) (e.preventDefault(), s.undo());
      else if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) (e.preventDefault(), s.redo());
      else if (mod && k === 'c') s.copySelected();
      else if (mod && k === 'v') (e.preventDefault(), s.paste());
      else if (mod && k === 'd') (e.preventDefault(), s.duplicateSelected());
      else if (mod && k === 'a') (e.preventDefault(), s.selectAll());
      else if (mod && k === 's') (e.preventDefault(), saveNow(), toast('已保存到本机浏览器', 'success'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function StatusBar() {
  const nodes = useEditor((s) => s.nodes.length);
  const edges = useEditor((s) => s.edges.length);
  const busy = useEditor((s) => s.busy);
  const { zoom } = useViewport();
  const [saved, setSaved] = useState(true);
  const project = useEditor((s) => s.project);
  const loaded = useCode((s) => (s.project && s.project.name === project?.name ? s.project : null));
  useEffect(() => onSaveState(setSaved), []);
  return (
    <footer className="statusbar">
      <span className="tabular">
        {nodes} 个图形 · {edges} 条连线
      </span>
      <span className="tabular">{Math.round(zoom * 100)}%</span>
      {project && (
        <button
          className="status proj-status"
          title={loaded ? `${loaded.files.size} 个文件 · ${loaded.totalLines.toLocaleString()} 行` : '点击重新连接项目'}
          onClick={() => !loaded && reconnectProject(project.name, true).catch(() => undefined)}
        >
          <FolderCode size={13} />
          {project.name}
          <span className={'dot ' + (loaded ? 'ok' : 'warn')} />
        </button>
      )}
      <span className="tb-spacer" />
      {busy && (
        <span className="status">
          <span className="dot busy" />
          Claude 正在工作
        </span>
      )}
      <span className="status">
        <span className={'dot ' + (saved ? 'ok' : 'warn')} />
        {saved ? '已自动保存' : '未保存'}
      </span>
    </footer>
  );
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme);
  const [showSettings, setShowSettings] = useState(false);
  const [showAnalyze, setShowAnalyze] = useState(false);
  const project = useEditor((s) => s.project);
  const [tab, setTab] = useState<'ai' | 'style'>('ai');
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 1100);
  const [rightOpen, setRightOpen] = useState(true);
  useShortcuts();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  // 切换到关联了代码项目的图表时，若浏览器仍保留文件夹授权则静默加载
  useEffect(() => {
    if (project) reconnectProject(project.name, false).catch(() => undefined);
  }, [project?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const openAnalyze = () => {
    setRightOpen(true);
    setTab('ai');
    setShowAnalyze(true);
  };

  // 首次使用时提示填写 Key
  useEffect(() => {
    if (!settings.apiKey) {
      const t = setTimeout(() => setShowSettings(true), 400);
      return () => clearTimeout(t);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ReactFlowProvider>
      <TitleBar
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onOpenSettings={() => setShowSettings(true)}
        onAnalyzeCode={openAnalyze}
      />
      <main className={'workspace' + (leftOpen ? '' : ' no-left') + (rightOpen ? '' : ' no-right')}>
        {leftOpen && <ShapePanel />}
        <div className="center">
          <Canvas theme={theme} />
          <button className="panel-toggle left" onClick={() => setLeftOpen(!leftOpen)} title={leftOpen ? '收起图形库' : '展开图形库'} aria-label="切换图形库">
            <PanelLeft size={15} />
          </button>
          <button className="panel-toggle right" onClick={() => setRightOpen(!rightOpen)} title={rightOpen ? '收起侧栏' : '展开侧栏'} aria-label="切换侧栏">
            <PanelRight size={15} />
          </button>
        </div>
        {rightOpen && (
          <aside className="side-right card">
            <div className="side-tabs">
              <Seg<'ai' | 'style'>
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'ai', label: <span className="tab-label"><Sparkles size={14} /> AI 助手</span> },
                  { value: 'style', label: <span className="tab-label"><SlidersHorizontal size={14} /> 样式</span> },
                ]}
              />
            </div>
            <div className="side-body">
              {tab === 'ai' ? <ChatPanel settings={settings} onOpenSettings={() => setShowSettings(true)} onAnalyzeCode={openAnalyze} /> : <StylePanel />}
            </div>
          </aside>
        )}
      </main>
      <StatusBar />
      {showSettings && (
        <SettingsDialog
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={(s) => {
            setSettings(s);
            saveSettings(s);
            toast('设置已保存', 'success');
          }}
        />
      )}
      {showAnalyze && <CodeAnalysisDialog settings={settings} onClose={() => setShowAnalyze(false)} onOpenSettings={() => setShowSettings(true)} />}
      <ToastHost />
    </ReactFlowProvider>
  );
}
