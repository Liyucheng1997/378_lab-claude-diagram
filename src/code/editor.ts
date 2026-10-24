import type { EditorKind } from './types';

export const EDITORS: { value: EditorKind; label: string }[] = [
  { value: 'vscode', label: 'VS Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'idea', label: 'JetBrains' },
];

export const editorName = (k: EditorKind) => EDITORS.find((e) => e.value === k)?.label ?? k;

/** 拼出编辑器的协议链接，如 vscode://file/F:/proj/src/a.ts:12:1 */
export function editorUrl(kind: EditorKind, root: string, path: string, line = 1): string {
  const base = root.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const abs = path ? `${base}/${path}` : base;
  if (kind === 'idea') return `idea://open?file=${encodeURIComponent(abs)}&line=${line}`;
  return `${kind}://file/${encodeURI(abs.replace(/^\/+/, ''))}:${line}:1`;
}

export function openInEditor(kind: EditorKind, root: string, path: string, line?: number) {
  const a = document.createElement('a');
  a.href = editorUrl(kind, root, path, line);
  a.click();
}
