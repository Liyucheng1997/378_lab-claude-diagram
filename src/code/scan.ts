import { CODE_LANGS, extractImports, extractSymbols, langOf } from './indexer';
import type { LoadedProject, ProjectFile } from './types';

// 浏览器里只读打开本地文件夹：优先用 File System Access API（Chrome / Edge，可记住授权），
// 不支持时退回 <input webkitdirectory>。

export interface FsFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}
export interface FsDirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FsFileHandle | FsDirHandle>;
  queryPermission?(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'read' }): Promise<PermissionState>;
}

type Picker = (o?: { id?: string; mode?: 'read' }) => Promise<FsDirHandle>;
const picker = () => (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;
export const supportsFsAccess = () => typeof picker() === 'function';

const MAX_FILES = 6000;
const MAX_FILE_SIZE = 512 * 1024;
const MAX_TOTAL = 40 * 1024 * 1024;

const IGNORE_DIRS = new Set([
  'node_modules', 'bower_components', 'jspm_packages', 'dist', 'build', 'out', 'target', 'vendor', 'coverage', '__pycache__',
  'venv', 'env', 'site-packages', 'obj', 'Pods', 'DerivedData', 'tmp', 'temp', 'logs', '__snapshots__', 'storybook-static',
]);
const IGNORE_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|go\.sum)$|\.min\.(js|css)$|\.map$|\.d\.ts\.map$/i;

/** 只支持 .gitignore 里最常见的写法：目录名、*.ext、/前缀、简单通配 */
function gitignoreMatcher(text: string) {
  const rules: { re: RegExp; dirOnly: boolean; anchored: boolean }[] = [];
  for (let raw of text.split('\n')) {
    raw = raw.trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('!')) continue;
    const dirOnly = raw.endsWith('/');
    let p = raw.replace(/\/+$/, '');
    const anchored = p.startsWith('/') || p.slice(0, -1).includes('/');
    p = p.replace(/^\//, '');
    const src = p
      .split('')
      .map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : /[.+^${}()|[\]\\]/.test(c) ? '\\' + c : c))
      .join('')
      .replace(/\[\^\/\]\*\[\^\/\]\*/g, '.*'); // **
    rules.push({ re: new RegExp(anchored ? `^${src}$` : `(^|/)${src}$`), dirOnly, anchored });
  }
  return (path: string, isDir: boolean) => rules.some((r) => (!r.dirOnly || isDir) && r.re.test(path));
}

function skipDir(name: string) {
  return IGNORE_DIRS.has(name) || (name.startsWith('.') && name !== '.github');
}

export type Progress = (read: number) => void;

interface RawEntry {
  path: string;
  size: number;
  read(): Promise<string>;
}

async function finish(name: string, entries: RawEntry[], skippedBefore: number, onProgress?: Progress): Promise<LoadedProject> {
  let skipped = skippedBefore;
  let truncated = false;
  let total = 0;
  const picked: RawEntry[] = [];
  for (const e of entries.sort((a, b) => a.path.localeCompare(b.path))) {
    if (!langOf(e.path) || IGNORE_FILES.test(e.path) || e.size > MAX_FILE_SIZE) {
      skipped++;
      continue;
    }
    if (picked.length >= MAX_FILES || total + e.size > MAX_TOTAL) {
      truncated = true;
      skipped++;
      continue;
    }
    total += e.size;
    picked.push(e);
  }

  const texts: (string | null)[] = new Array(picked.length).fill(null);
  let done = 0;
  for (let i = 0; i < picked.length; i += 32) {
    await Promise.all(
      picked.slice(i, i + 32).map(async (e, j) => {
        try {
          const t = await e.read();
          // 含 NUL 字符的多半是二进制
          texts[i + j] = t.includes('\u0000') ? null : t.replace(/\r\n?/g, '\n');
        } catch {
          texts[i + j] = null;
        }
      }),
    );
    done = Math.min(picked.length, i + 32);
    onProgress?.(done);
  }

  const files = new Map<string, ProjectFile>();
  const dirs = new Set<string>();
  let totalLines = 0;
  picked.forEach((e, i) => {
    const text = texts[i];
    if (text == null) return void skipped++;
    const lang = langOf(e.path)!;
    const lines = text ? text.split('\n').length : 0;
    totalLines += lines;
    files.set(e.path, { path: e.path, text, lines, size: e.size, lang, symbols: CODE_LANGS.has(lang) ? extractSymbols(text, lang) : [], imports: [] });
    for (let p = e.path; p.includes('/'); ) {
      p = p.slice(0, p.lastIndexOf('/'));
      dirs.add(p);
    }
  });
  const has = (p: string) => files.has(p);
  for (const f of files.values()) if (CODE_LANGS.has(f.lang)) f.imports = extractImports(f.path, f.text, f.lang, has);
  return { name, files, dirs, totalLines, skipped, truncated, loadedAt: Date.now() };
}

export async function scanHandle(root: FsDirHandle, onProgress?: Progress): Promise<LoadedProject> {
  const entries: RawEntry[] = [];
  let skipped = 0;
  let ignore = (_p: string, _d: boolean) => false;
  for await (const h of root.values()) {
    if (h.kind === 'file' && h.name === '.gitignore') ignore = gitignoreMatcher(await (await h.getFile()).text());
  }
  const walk = async (dir: FsDirHandle, prefix: string, depth: number) => {
    if (depth > 24) return;
    const subdirs: [FsDirHandle, string][] = [];
    for await (const h of dir.values()) {
      const path = prefix + h.name;
      if (h.kind === 'directory') {
        if (skipDir(h.name) || ignore(path, true)) continue;
        subdirs.push([h, path]);
      } else {
        if (ignore(path, false) || entries.length > MAX_FILES * 3) {
          skipped++;
          continue;
        }
        const file = await h.getFile();
        entries.push({ path, size: file.size, read: () => file.text() });
      }
    }
    for (const [h, p] of subdirs) await walk(h, p + '/', depth + 1);
  };
  await walk(root, '', 0);
  return finish(root.name, entries, skipped, onProgress);
}

export async function scanFileList(list: File[], onProgress?: Progress): Promise<LoadedProject> {
  const name = list[0]?.webkitRelativePath.split('/')[0] || '项目';
  const gi = list.find((f) => f.webkitRelativePath === `${name}/.gitignore`);
  const ignore = gi ? gitignoreMatcher(await gi.text()) : () => false;
  const entries: RawEntry[] = [];
  let skipped = 0;
  for (const f of list) {
    const path = f.webkitRelativePath.split('/').slice(1).join('/');
    const segs = path.split('/');
    const dirs = segs.slice(0, -1);
    if (dirs.some(skipDir) || dirs.some((_, i) => ignore(dirs.slice(0, i + 1).join('/'), true)) || ignore(path, false)) {
      skipped++;
      continue;
    }
    entries.push({ path, size: f.size, read: () => f.text() });
  }
  return finish(name, entries, skipped, onProgress);
}

/** 弹出文件夹选择框；用户取消时返回 null */
export async function pickFolder(): Promise<{ handle?: FsDirHandle; files?: File[] } | null> {
  const p = picker();
  if (p) {
    try {
      return { handle: await p({ id: 'claude-diagram-code', mode: 'read' }) };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.addEventListener('change', () => resolve(input.files?.length ? { files: [...input.files] } : null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
