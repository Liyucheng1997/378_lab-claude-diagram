import { saveDoc, setCurrentDocId } from './lib/storage';
import { useEditor } from './store';

// 自动保存：内容变化 600ms 后写入 localStorage
let timer: ReturnType<typeof setTimeout> | undefined;
let listeners: ((saved: boolean) => void)[] = [];

export function onSaveState(fn: (saved: boolean) => void) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

function flush() {
  const s = useEditor.getState();
  // 空白且没有对话的新文档不落盘，避免产生大量空文档
  if (!s.nodes.length && !s.chat.length) return listeners.forEach((l) => l(true));
  const ok = saveDoc({
    id: s.docId,
    diagram: s.getDiagram(),
    chat: s.chat.filter((c) => c.status !== 'streaming'),
    // 对话进行中不保存 API 历史，避免存下半截
    apiHistory: s.busy ? undefined : s.apiHistory,
    updatedAt: Date.now(),
  });
  setCurrentDocId(s.docId);
  listeners.forEach((l) => l(ok));
}

export function startAutosave() {
  useEditor.subscribe((s, prev) => {
    if (
      s.nodes === prev.nodes &&
      s.edges === prev.edges &&
      s.title === prev.title &&
      s.background === prev.background &&
      s.chat === prev.chat &&
      s.apiHistory === prev.apiHistory
    )
      return;
    listeners.forEach((l) => l(false));
    clearTimeout(timer);
    timer = setTimeout(flush, 600);
  });
  window.addEventListener('beforeunload', () => {
    clearTimeout(timer);
    flush();
  });
}

export const saveNow = () => {
  clearTimeout(timer);
  flush();
};
