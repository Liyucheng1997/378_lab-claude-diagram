import { FolderOpen, FolderSearch, Info, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { sendMessage } from '../ai/session';
import type { Settings } from '../ai/types';
import { recallRoot, rememberRoot } from '../code/handles';
import { supportsFsAccess } from '../code/scan';
import { openProjectFolder, useCode } from '../code/store';
import { saveNow } from '../persist';
import { useEditor } from '../store';
import { Modal, toast } from './ui';

const KINDS = [
  {
    id: 'arch',
    title: '整体架构',
    desc: '分层与核心模块',
    prompt: '分析这个项目的整体架构，画一张分层架构图：用分组表示层次或子系统（如界面层、业务逻辑、数据与外部服务），节点是关键模块或文件，连线表示主要的调用与依赖关系。',
  },
  {
    id: 'deps',
    title: '模块依赖',
    desc: '文件之间的 import 关系',
    prompt: '画这个项目的模块依赖图：节点是源文件（文件太多时以目录为单位），按目录分组，连线表示 import 依赖方向，突出被依赖最多的核心模块。',
  },
  {
    id: 'flow',
    title: '核心流程',
    desc: '一条主流程的调用链',
    prompt: '找出这个项目最核心的一条业务流程（从用户操作或程序入口开始），画出它的调用链流程图：节点是实际的函数或方法，按调用顺序连线，标出关键的判断分支和数据流转。',
  },
  {
    id: 'data',
    title: '数据模型',
    desc: '类型、类与它们的关系',
    prompt: '画这个项目的数据模型图：主要的类型、接口、类或数据表，节点第二行列出关键字段，连线表示包含、引用、继承等关系。',
  },
  {
    id: 'tree',
    title: '目录导览',
    desc: '目录结构与各自职责',
    prompt: '画这个项目的目录结构导览图（从左到右的树状图）：每个重要的目录或文件一个节点，第二行写一句职责说明，忽略无关的配置和静态资源。',
  },
  {
    id: 'custom',
    title: '自定义',
    desc: '按你的描述来分析',
    prompt: '',
  },
] as const;

type KindId = (typeof KINDS)[number]['id'];

export function CodeAnalysisDialog(props: { settings: Settings; onClose(): void; onOpenSettings(): void }) {
  const project = useCode((s) => s.project);
  const scanning = useCode((s) => s.scanning);
  const hasNodes = useEditor((s) => s.nodes.length > 0);
  const busy = useEditor((s) => s.busy);
  const [kind, setKind] = useState<KindId>('arch');
  const [focus, setFocus] = useState('');
  const [root, setRoot] = useState(() => (project ? recallRoot(project.name) : ''));
  const [newDoc, setNewDoc] = useState(hasNodes);

  const stats = useMemo(() => {
    if (!project) return null;
    const langs = new Map<string, number>();
    for (const f of project.files.values()) langs.set(f.lang, (langs.get(f.lang) ?? 0) + f.lines);
    const top = [...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const symbols = [...project.files.values()].reduce((a, f) => a + f.symbols.length, 0);
    return { top, symbols };
  }, [project]);

  const pick = async () => {
    try {
      const p = await openProjectFolder();
      if (p) {
        setRoot(recallRoot(p.name));
        if (!p.files.size) toast('这个文件夹里没有可分析的代码文件', 'error');
      }
    } catch (e) {
      toast('读取文件夹失败：' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  };

  const k = KINDS.find((x) => x.id === kind)!;
  const canStart = !!project?.files.size && !busy && scanning === null && (kind !== 'custom' || !!focus.trim());

  const start = () => {
    if (!project) return;
    if (!props.settings.apiKey.trim()) return props.onOpenSettings();
    const s = useEditor.getState();
    if (newDoc) {
      saveNow();
      s.newDocument();
    }
    const rootPath = root.trim();
    rememberRoot(project.name, rootPath);
    useEditor.getState().setProject({ name: project.name, rootPath: rootPath || undefined });
    if (newDoc || !hasNodes) useEditor.getState().setTitle(`${project.name} · ${k.title}`);
    const text = kind === 'custom' ? focus.trim() : k.prompt + (focus.trim() ? `\n\n重点关注：${focus.trim()}` : '');
    useCode.getState().closePeek();
    props.onClose();
    sendMessage(text, [], props.settings);
  };

  return (
    <Modal
      title="AI 分析项目代码"
      onClose={props.onClose}
      width={560}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={start} disabled={!canStart}>
            开始分析
          </button>
        </>
      }
    >
      <div className="form settings-form code-dialog">
        <div className="field">
          <label className="form-label">项目文件夹</label>
          {project ? (
            <div className="proj-card">
              <div className="proj-icon">
                <FolderOpen size={18} />
              </div>
              <div className="proj-info">
                <div className="proj-name">{project.name}</div>
                <div className="proj-meta tabular">
                  {project.files.size} 个文件 · {project.totalLines.toLocaleString()} 行 · {stats!.symbols} 个符号
                  {stats!.top.length > 0 && ' · ' + stats!.top.map(([l]) => l).join(' / ')}
                </div>
              </div>
              <button className="btn btn-sm" onClick={pick} disabled={scanning !== null}>
                <RefreshCw size={13} /> 更换
              </button>
            </div>
          ) : (
            <button className="pick-folder" onClick={pick} disabled={scanning !== null}>
              <FolderSearch size={22} strokeWidth={1.6} />
              <span className="pf-title">{scanning !== null ? `正在读取… 已读取 ${scanning} 个文件` : '选择项目文件夹'}</span>
              <span className="pf-sub">文件只在浏览器内存中读取，不会上传到任何服务器；会自动跳过 node_modules、构建产物和 .gitignore 中的内容</span>
            </button>
          )}
          {project && (project.truncated || project.skipped > 0) && (
            <div className="field-hint">
              <Info size={13} />
              已跳过 {project.skipped} 个非代码或过大的文件{project.truncated ? '；项目较大，只读取了部分文件' : ''}。
            </div>
          )}
          {!supportsFsAccess() && (
            <div className="field-hint">
              <Info size={13} /> 当前浏览器不支持记住文件夹授权，刷新页面后需要重新选择文件夹（推荐使用 Chrome 或 Edge）。
            </div>
          )}
        </div>

        <div className="field">
          <label className="form-label">分析什么</label>
          <div className="model-list kind-list">
            {KINDS.map((x) => (
              <button key={x.id} className={'model-opt' + (kind === x.id ? ' active' : '')} onClick={() => setKind(x.id)}>
                <span className="mo-name">{x.title}</span>
                <span className="mo-desc">{x.desc}</span>
              </button>
            ))}
          </div>
          <textarea
            className="input code-focus"
            rows={2}
            placeholder={kind === 'custom' ? '描述你想看的图，例如"画出用户发送消息后到画布更新的完整调用链"' : '重点关注（可选），例如"AI 对话是怎么驱动画布更新的"'}
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="form-label" htmlFor="proj-root">
            本机路径（可选）
          </label>
          <input
            id="proj-root"
            className="input"
            placeholder={project ? `例如 D:\\code\\${project.name}` : '例如 D:\\code\\my-app'}
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            spellCheck={false}
          />
          <div className="field-hint">点击图中的节点会在右侧显示对应代码；填写路径后还能一键在 VS Code / Cursor / JetBrains 中打开（浏览器拿不到完整路径）。</div>
        </div>

        {hasNodes && (
          <label className="form-check">
            <input type="checkbox" checked={newDoc} onChange={(e) => setNewDoc(e.target.checked)} />
            在新图表中生成（不勾选则在当前画布上继续）
          </label>
        )}
      </div>
    </Modal>
  );
}
