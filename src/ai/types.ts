import type { EditorKind } from '../code/types';

export interface ToolActivity {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  /** 已接收的工具参数字符数，用于显示进度 */
  chars: number;
  summary?: string;
  /** 工具开始时正文已有的长度，用于把工具卡片插在正确位置 */
  at?: number;
}

export interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** 用户附带的图片（dataURL），仅用于界面展示 */
  images?: string[];
  thinking?: string;
  tools?: ToolActivity[];
  status?: 'streaming' | 'done' | 'error' | 'refused' | 'stopped';
  error?: string;
  /** 实际服务的模型（发生回退时与设置不同） */
  servedBy?: string;
  createdAt: number;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Settings {
  apiKey: string;
  model: string;
  effort: Effort;
  baseURL: string;
  fallback: boolean;
  showThinking: boolean;
  /** 代码分析：点击节点后用哪个编辑器打开 */
  editor: EditorKind;
}

export const MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', desc: '默认推荐，质量与速度均衡' },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', desc: '最强推理，速度较慢、价格更高' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', desc: '更快更省，适合日常修改' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', desc: '极速，适合小改动' },
];

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'claude-opus-5-5',
  effort: 'medium',
  baseURL: '',
  fallback: true,
  showThinking: true,
  editor: 'vscode',
};

export function modelName(id: string) {
  return MODELS.find((m) => m.id === id)?.name ?? id;
}
