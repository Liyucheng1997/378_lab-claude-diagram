import { ArrowUp, Brain, ChevronRight, FolderCode, ImagePlus, KeyRound, MessageSquarePlus, RefreshCw, RotateCcw, Sparkles, Square, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { fileToAttachment, retry, sendMessage, stopGeneration, type ImageAttachment } from '../ai/session';
import { modelName, type ChatItem, type Settings, type ToolActivity } from '../ai/types';
import { reconnectProject, useCode } from '../code/store';
import { CODE_TOOL_NAMES } from '../code/tools';
import { useEditor } from '../store';
import { Confirm, toast } from './ui';

const STARTERS = [
  { title: '登录注册流程', text: '画一个用户注册登录的流程图，包含手机验证码校验、密码错误重试 3 次锁定、第三方登录分支' },
  { title: '微服务架构', text: '画一个电商系统的微服务架构图：客户端、API 网关、用户/商品/订单/支付服务、Redis 缓存、MySQL、Kafka 消息队列，按层分组' },
  { title: 'CI/CD 流水线', text: '画一个 CI/CD 流水线，从左到右：代码提交 → 单元测试 → 构建镜像 → 安全扫描 → 部署测试环境 → 人工审批 → 发布生产，失败时通知开发者' },
  { title: '组织架构', text: '画一个公司组织架构图：CEO 下设技术、产品、市场、运营四个中心，每个中心下有 2–3 个团队' },
  { title: '云网络拓扑', text: '画一个云上三层网络架构：VPC 内有公有子网（负载均衡、NAT 网关）和私有子网（应用服务器集群、数据库主从），外部用户经 CDN 访问' },
  { title: '订单状态机', text: '画一个订单状态机：待支付、已支付、待发货、已发货、已完成、已取消、退款中、已退款，标注每个状态转换的触发事件' },
];

const QUICK = ['换一套商务风配色', '改成从左到右排版', '给每个节点加上合适的图标', '把文字全部翻译成英文', '加一个图例说明'];
const CODE_QUICK = ['展开最核心模块的内部结构', '画出主流程的调用链', '解释选中节点的代码', '标出可能的问题和改进点', '换一套商务风配色'];

const TOOL_RUNNING: Record<string, string> = {
  create_diagram: '正在绘制图表',
  edit_diagram: '正在修改图表',
  read_file: '正在阅读代码',
  search_code: '正在搜索代码',
  list_files: '正在浏览文件',
};

/** `src/a.ts:12` 这类代码位置可点击，在代码面板中打开 */
const LOC_RE = /^([\w@.-]+(?:\/[\w@.[\]()-]+)*\.\w+)(?::(\d+)(?:[-–](\d+))?)?$/;

function CodeSpan({ text }: { text: string }) {
  const hasProject = useEditor((s) => !!s.project);
  const m = hasProject ? LOC_RE.exec(text.trim()) : null;
  if (!m) return <code>{text}</code>;
  const line = m[2] ? Number(m[2]) : undefined;
  const endLine = m[3] ? Number(m[3]) : undefined;
  return (
    <code
      className="code-link"
      role="link"
      title="查看代码"
      onClick={() => useCode.getState().openPeek({ ref: { path: m[1], line, endLine } })}
    >
      {text}
    </code>
  );
}

/** 极简 Markdown：**粗体**、`代码`、列表符号保持原样 */
function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    parts.push(t.startsWith('**') ? <strong key={m.index}>{t.slice(2, -2)}</strong> : <CodeSpan key={m.index} text={t.slice(1, -1)} />);
    last = m.index + t.length;
  }
  parts.push(text.slice(last));
  return <div className="msg-text">{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</div>;
}

/** 按发生顺序把正文切开，在中间插入工具卡片；连续的读代码操作合并成一行 */
function segments(item: ChatItem): (string | ToolActivity | ToolActivity[])[] {
  const out: (string | ToolActivity | ToolActivity[])[] = [];
  let pos = 0;
  for (const t of [...(item.tools ?? [])].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))) {
    const at = Math.min(t.at ?? item.text.length, item.text.length);
    const chunk = item.text.slice(pos, at).trim();
    if (chunk) out.push(chunk);
    const last = out[out.length - 1];
    if (!CODE_TOOL_NAMES.has(t.name)) out.push(t);
    else if (Array.isArray(last)) last.push(t);
    else out.push([t]);
    pos = Math.max(pos, at);
  }
  const rest = item.text.slice(pos).trim();
  if (rest) out.push(rest);
  return out;
}

/** 读代码的操作通常很多：折叠成一行摘要，展开后列出每一步 */
function CodeToolRow({ tools }: { tools: ToolActivity[] }) {
  const [open, setOpen] = useState(false);
  const running = tools.find((t) => t.status === 'running');
  const reads = tools.filter((t) => t.name === 'read_file').length;
  const searches = tools.filter((t) => t.name === 'search_code').length;
  const lists = tools.length - reads - searches;
  const errors = tools.filter((t) => t.status === 'error').length;
  const parts = [reads && `阅读 ${reads} 次`, searches && `搜索 ${searches} 次`, lists && `浏览 ${lists} 次`].filter(Boolean);
  return (
    <div className="code-tools">
      <button className={`tool-chip tool-${running ? 'running' : errors === tools.length ? 'error' : 'done'}`} onClick={() => setOpen(!open)}>
        <span className="dot" />
        <span className="tool-name">
          {running ? TOOL_RUNNING[running.name] + '…' : '查看了代码'} · {parts.join('，')}
        </span>
        <ChevronRight size={13} className={'chev' + (open ? ' open' : '')} />
      </button>
      {open && (
        <div className="code-tool-list">
          {tools.map((t) => (
            <div key={t.id} className={'ctl-item tool-' + t.status}>
              <span className="dot" />
              <span>{t.status === 'running' ? TOOL_RUNNING[t.name] + '…' : t.summary ?? '完成'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssistantMessage({ item, settings }: { item: ChatItem; settings: Settings }) {
  const [showThinking, setShowThinking] = useState(false);
  const streaming = item.status === 'streaming';
  const empty = !item.text && !item.tools?.length;
  return (
    <div className="msg msg-assistant">
      <div className="msg-avatar">
        <Sparkles size={14} />
      </div>
      <div className="msg-body">
        {item.thinking && (
          <div className="thinking">
            <button className="thinking-toggle" onClick={() => setShowThinking(!showThinking)}>
              <Brain size={13} />
              <span>{streaming && empty ? '正在思考…' : '思考过程'}</span>
              <ChevronRight size={13} className={'chev' + (showThinking ? ' open' : '')} />
            </button>
            {showThinking && <div className="thinking-text">{item.thinking}</div>}
          </div>
        )}
        {segments(item).map((seg, i) =>
          typeof seg === 'string' ? (
            <RichText key={i} text={seg} />
          ) : Array.isArray(seg) ? (
            <CodeToolRow key={seg[0].id} tools={seg} />
          ) : (
            <div key={seg.id} className={`tool-chip tool-${seg.status}`}>
              <span className="dot" />
              <span className="tool-name">
                {seg.status === 'running'
                  ? (TOOL_RUNNING[seg.name] ?? '正在处理') + (seg.chars ? ` · ${(seg.chars / 1000).toFixed(1)}k` : '…')
                  : seg.summary ?? (seg.status === 'error' ? '操作失败' : '完成')}
              </span>
            </div>
          ),
        )}
        {streaming && empty && !item.thinking && (
          <div className="typing">
            <i />
            <i />
            <i />
          </div>
        )}
        {item.status === 'error' && (
          <div className="msg-error">
            <span className="dot" />
            <span>{item.error}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => retry(item.id, settings)}>
              <RotateCcw size={13} /> 重试
            </button>
          </div>
        )}
        {item.status === 'refused' && (
          <div className="msg-error warn">
            <span className="dot" />
            <span>模型拒绝了这个请求{item.error ? `：${item.error}` : ''}。可以换一种说法再试。</span>
          </div>
        )}
        {item.status === 'stopped' && <div className="msg-meta">已停止生成</div>}
        {item.servedBy && item.servedBy !== settings.model && <div className="msg-meta">由 {modelName(item.servedBy)} 自动回退完成</div>}
      </div>
    </div>
  );
}

export function ChatPanel(props: { settings: Settings; onOpenSettings(): void; onAnalyzeCode(): void }) {
  const { settings } = props;
  const chat = useEditor((s) => s.chat);
  const busy = useEditor((s) => s.busy);
  const hasNodes = useEditor((s) => s.nodes.length > 0);
  const project = useEditor((s) => s.project);
  const loadedName = useCode((s) => s.project?.name);
  const scanning = useCode((s) => s.scanning);
  const selCount = useEditor((s) => s.nodes.filter((n) => n.selected).length + s.edges.filter((e) => e.selected).length);
  const [text, setText] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat]);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [text]);

  const noKey = !settings.apiKey.trim();

  const send = (t = text) => {
    if (noKey) return props.onOpenSettings();
    if (busy || (!t.trim() && !images.length)) return;
    stick.current = true;
    sendMessage(t, images, settings);
    setText('');
    setImages([]);
  };

  const addFiles = async (files: Iterable<File>) => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const a = await fileToAttachment(f);
        setImages((x) => [...x, a].slice(0, 4));
      } catch {
        toast('图片读取失败', 'error');
      }
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <button className="model-chip" onClick={props.onOpenSettings} title="切换模型与设置">
          <span className={'dot ' + (noKey ? 'warn' : 'ok')} />
          {noKey ? '未设置 API Key' : modelName(settings.model)}
        </button>
        <div className="chat-head-actions">
          <button className="icon-btn" onClick={props.onAnalyzeCode} title="AI 分析项目代码" aria-label="AI 分析项目代码" disabled={busy}>
            <FolderCode size={16} />
          </button>
          <button className="icon-btn" onClick={() => chat.length && setConfirmClear(true)} title="新对话" aria-label="新对话" disabled={busy}>
            <MessageSquarePlus size={16} />
          </button>
        </div>
      </div>
      {project && loadedName !== project.name && (
        <div className="proj-banner">
          <FolderCode size={14} />
          <span>{scanning !== null ? `正在读取「${project.name}」… ${scanning}` : `项目「${project.name}」的代码未加载，Claude 暂时读不到代码`}</span>
          {scanning === null && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={async () => {
                try {
                  const p = await reconnectProject(project.name, true);
                  if (p && p.name !== project.name) toast(`打开的是「${p.name}」，与图表关联的「${project.name}」不同`, 'error');
                } catch (e) {
                  toast('打开失败：' + (e instanceof Error ? e.message : String(e)), 'error');
                }
              }}
            >
              <RefreshCw size={12} /> 重新连接
            </button>
          )}
        </div>
      )}

      <div
        className="chat-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {chat.length === 0 ? (
          <div className="chat-empty">
            <div className="ce-eyebrow">AI DIAGRAM</div>
            <div className="ce-title">
              描述你的想法，<span className="accent">Claude</span> 帮你画出来
            </div>
            <div className="ce-sub">支持流程图、架构图、网络拓扑、组织架构、状态机等；也可以上传草图照片让它还原。</div>
            <div className="starter-list">
              <button className="starter starter-code" onClick={props.onAnalyzeCode}>
                <span className="starter-title">
                  <FolderCode size={14} /> 分析项目代码
                </span>
                <span className="starter-text">选择本地代码文件夹，Claude 阅读代码后画出架构图、依赖图或调用链，点击节点即可跳转到对应代码</span>
              </button>
              {STARTERS.map((s) => (
                <button key={s.title} className="starter" onClick={() => (noKey ? props.onOpenSettings() : send(s.text))}>
                  <span className="starter-title">{s.title}</span>
                  <span className="starter-text">{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          chat.map((c) =>
            c.role === 'user' ? (
              <div key={c.id} className="msg msg-user">
                <div className="bubble">
                  {c.images?.length ? (
                    <div className="bubble-images">
                      {c.images.map((src, i) => (
                        <img key={i} src={src} alt="附图" />
                      ))}
                    </div>
                  ) : null}
                  {c.text}
                </div>
              </div>
            ) : (
              <AssistantMessage key={c.id} item={c} settings={settings} />
            ),
          )
        )}
      </div>

      <div className="composer-wrap">
        {hasNodes && !busy && chat.length > 0 && (
          <div className="quick-row">
            {(project ? CODE_QUICK : QUICK).map((q) => (
              <button key={q} className="chip" onClick={() => send(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        {noKey ? (
          <button className="key-cta" onClick={props.onOpenSettings}>
            <KeyRound size={16} />
            <span>填写你的 Claude API Key 后开始对话</span>
            <ChevronRight size={15} />
          </button>
        ) : (
          <div
            className="composer"
            onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
            onDrop={(e) => {
              if (!e.dataTransfer.files.length) return;
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
          >
            {selCount > 0 && (
              <div className="sel-hint">
                <span className="dot" />
                将针对选中的 {selCount} 个元素修改
              </div>
            )}
            {images.length > 0 && (
              <div className="attach-row">
                {images.map((img, i) => (
                  <div key={i} className="attach">
                    <img src={img.dataUrl} alt="" />
                    <button onClick={() => setImages(images.filter((_, j) => j !== i))} aria-label="移除图片">
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={ta}
              rows={1}
              value={text}
              placeholder={hasNodes ? '说说要怎么改，比如"把数据库换成绿色"' : '描述你想画的图…'}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
                if (files.length) {
                  e.preventDefault();
                  addFiles(files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="composer-bar">
              <button className="icon-btn" onClick={() => file.current?.click()} title="上传图片（草图、截图）" aria-label="上传图片">
                <ImagePlus size={17} />
              </button>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
              <span className="composer-tip">Enter 发送 · Shift+Enter 换行</span>
              {busy ? (
                <button className="send-btn stop" onClick={stopGeneration} title="停止" aria-label="停止">
                  <Square size={12} fill="currentColor" />
                </button>
              ) : (
                <button className="send-btn" disabled={!text.trim() && !images.length} onClick={() => send()} title="发送" aria-label="发送">
                  <ArrowUp size={17} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {confirmClear && (
        <Confirm
          title="开始新对话？"
          message="将清空当前的对话记录，画布内容会保留。"
          okText="新对话"
          onOk={() => {
            useEditor.getState().setChat(() => []);
            useEditor.getState().setApiHistory([]);
          }}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
