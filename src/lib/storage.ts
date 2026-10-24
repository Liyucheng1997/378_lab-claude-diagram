import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { DEFAULT_SETTINGS, type ChatItem, type Settings } from '../ai/types';
import type { ProjectMeta } from '../code/types';
import type { Diagram } from './types';

// 所有数据只保存在当前浏览器的 localStorage 中。

export interface DocMeta {
  id: string;
  title: string;
  updatedAt: number;
  nodeCount: number;
}

export interface DocRecord {
  id: string;
  diagram: Diagram;
  chat: ChatItem[];
  /** 发送给 API 的原始对话历史；为保证历史不被改写，存不下时整体不存 */
  apiHistory?: BetaMessageParam[];
  project?: ProjectMeta;
  updatedAt: number;
}

const K = {
  settings: 'cd.settings',
  index: 'cd.docs',
  doc: (id: string) => 'cd.doc.' + id,
  current: 'cd.current',
  theme: 'cd.theme',
};

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K.settings, {}) });
export const saveSettings = (s: Settings) => write(K.settings, s);

export const listDocs = (): DocMeta[] => read<DocMeta[]>(K.index, []).sort((a, b) => b.updatedAt - a.updatedAt);
export const loadDoc = (id: string): DocRecord | null => read<DocRecord | null>(K.doc(id), null);
export const currentDocId = (): string | null => read<string | null>(K.current, null);
export const setCurrentDocId = (id: string) => write(K.current, id);

export function saveDoc(rec: DocRecord): boolean {
  // 图片和长对话可能超出配额：先完整保存，失败则去掉 API 历史，再失败则去掉聊天图片
  let ok = write(K.doc(rec.id), rec);
  if (!ok) ok = write(K.doc(rec.id), { ...rec, apiHistory: undefined });
  if (!ok)
    ok = write(K.doc(rec.id), {
      ...rec,
      apiHistory: undefined,
      chat: rec.chat.map((c) => ({ ...c, images: undefined })),
    });
  const index = listDocs().filter((d) => d.id !== rec.id);
  index.push({ id: rec.id, title: rec.diagram.title, updatedAt: rec.updatedAt, nodeCount: rec.diagram.nodes.length });
  write(K.index, index);
  return ok;
}

export function deleteDoc(id: string) {
  try {
    localStorage.removeItem(K.doc(id));
  } catch {
    /* ignore */
  }
  write(
    K.index,
    listDocs().filter((d) => d.id !== id),
  );
}

export function loadTheme(): 'light' | 'dark' {
  try {
    return localStorage.getItem(K.theme) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function saveTheme(t: 'light' | 'dark') {
  try {
    localStorage.setItem(K.theme, t);
  } catch {
    /* ignore */
  }
}
