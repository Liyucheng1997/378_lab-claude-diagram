import { create } from 'zustand';
import { getHandle, saveHandle } from './handles';
import { pickFolder, scanFileList, scanHandle, type FsDirHandle } from './scan';
import type { CodeRef, LoadedProject } from './types';

export interface Peek {
  ref: CodeRef;
  /** 节点文字，作为代码面板标题 */
  label?: string;
  nodeId?: string;
}

interface CodeState {
  /** 当前在内存中的项目（同一时间只有一个） */
  project: LoadedProject | null;
  /** 正在读取：已读文件数 */
  scanning: number | null;
  peek: Peek | null;
  openPeek(p: Peek): void;
  closePeek(): void;
}

export const useCode = create<CodeState>((set) => ({
  project: null,
  scanning: null,
  peek: null,
  openPeek(p) {
    set({ peek: p });
  },
  closePeek() {
    set({ peek: null });
  },
}));

async function load(src: { handle?: FsDirHandle; files?: File[] }): Promise<LoadedProject> {
  useCode.setState({ scanning: 0 });
  try {
    const onProgress = (n: number) => useCode.setState({ scanning: n });
    const project = src.handle ? await scanHandle(src.handle, onProgress) : await scanFileList(src.files!, onProgress);
    if (src.handle) await saveHandle(project.name, src.handle);
    useCode.setState({ project });
    return project;
  } finally {
    useCode.setState({ scanning: null });
  }
}

/** 让用户选择文件夹并读取；取消返回 null */
export async function openProjectFolder(): Promise<LoadedProject | null> {
  const src = await pickFolder();
  return src ? load(src) : null;
}

/**
 * 重新连接图表关联的项目。interactive 为 true 时（来自用户点击）可以弹出授权或选择框；
 * 否则只在浏览器仍保留授权时静默恢复。
 */
export async function reconnectProject(name: string, interactive: boolean): Promise<LoadedProject | null> {
  const cur = useCode.getState().project;
  if (cur?.name === name) return cur;
  const handle = await getHandle(name);
  if (handle?.queryPermission) {
    let perm = await handle.queryPermission({ mode: 'read' });
    if (perm !== 'granted' && interactive && handle.requestPermission) perm = await handle.requestPermission({ mode: 'read' });
    if (perm === 'granted') return load({ handle });
  }
  if (!interactive) return null;
  const p = await openProjectFolder();
  return p;
}
