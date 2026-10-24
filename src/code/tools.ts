import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { blockEnd } from './indexer';
import type { CodeRef, LoadedProject, ProjectFile } from './types';

// 代码分析工具：只读访问内存中的项目文件。

export const CodeRefZ = z.object({
  path: z.string().describe('相对项目根目录的文件或目录路径（与大纲一致），如 "src/ai/agent.ts"'),
  line: z.number().int().optional().describe('定义所在行，从 1 开始；以 read_file / search_code 返回的行号为准。目录可省略'),
  end_line: z.number().int().optional().describe('结束行；省略时自动按代码块估算'),
  symbol: z.string().optional().describe('函数 / 类 / 变量名，用于校正行号'),
  note: z.string().optional().describe('一句话说明这段代码的职责，用户点击节点时展示'),
});
export type CodeRefInput = z.infer<typeof CodeRefZ>;

const ListFilesZ = z.object({
  dir: z.string().optional().describe('只列出该目录下的文件（相对路径），省略表示整个项目'),
  pattern: z.string().optional().describe('文件名过滤：通配符如 "*.ts"、"*service*"，或路径片段'),
});

const ReadFileZ = z.object({
  path: z.string().describe('相对项目根目录的文件路径'),
  start_line: z.number().int().min(1).optional().describe('起始行（含），默认 1'),
  end_line: z.number().int().min(1).optional().describe('结束行（含）；单次最多返回 500 行'),
});

const SearchCodeZ = z.object({
  query: z.string().min(1).describe('要搜索的文本；regex 为 true 时按 JavaScript 正则解析'),
  regex: z.boolean().optional(),
  case_sensitive: z.boolean().optional(),
  path: z.string().optional().describe('限定范围：目录前缀如 "src/ai" 或通配符如 "*.py"'),
});

function jsonSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const s = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete s.$schema;
  return s as Anthropic.Tool.InputSchema;
}

export const CODE_TOOLS = [
  {
    name: 'list_files',
    description: '列出项目中的文件及其行数。大纲里已有完整目录树时通常不需要调用，用于大仓库里查看被省略的目录。',
    input_schema: jsonSchema(ListFilesZ),
  },
  {
    name: 'read_file',
    description: '读取项目文件内容，每行前带行号。大文件请用 start_line / end_line 分段读取，单次最多 500 行。',
    input_schema: jsonSchema(ReadFileZ),
  },
  {
    name: 'search_code',
    description: '在项目全部文本文件中搜索，返回 "路径:行号: 内容"，最多 80 条。用于查找定义、调用方、路由注册等。',
    input_schema: jsonSchema(SearchCodeZ),
  },
] satisfies Anthropic.Beta.BetaTool[];

export const CODE_TOOL_NAMES = new Set(CODE_TOOLS.map((t) => t.name));

// ---------- 路径 ----------

/** 规范化模型给出的路径：反斜杠、./ 前缀、项目名前缀；找不到时按唯一后缀匹配 */
export function resolvePath(raw: string, p: LoadedProject): { path: string; isDir: boolean } | null {
  let s = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (s.startsWith(p.name + '/')) s = s.slice(p.name.length + 1);
  if (s === '' || s === '.' || s === p.name) return { path: '', isDir: true };
  if (p.files.has(s)) return { path: s, isDir: false };
  if (p.dirs.has(s)) return { path: s, isDir: true };
  const hits = [...p.files.keys()].filter((k) => k.endsWith('/' + s));
  if (hits.length === 1) return { path: hits[0], isDir: false };
  const dirHits = [...p.dirs].filter((k) => k.endsWith('/' + s));
  if (dirHits.length === 1) return { path: dirHits[0], isDir: true };
  return null;
}

function globRe(pattern: string): RegExp {
  const src = pattern
    .split('')
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : /[.+^${}()|[\]\\]/.test(c) ? '\\' + c : c))
    .join('');
  return new RegExp(`(^|/)${src}$`, 'i');
}

function pathFilter(scope: string | undefined, p: LoadedProject): (path: string) => boolean {
  if (!scope?.trim()) return () => true;
  const s = scope.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (/[*?]/.test(s)) {
    const re = globRe(s);
    return (path) => re.test(path);
  }
  const r = resolvePath(s, p);
  if (r?.isDir) return (path) => r.path === '' || path.startsWith(r.path + '/');
  if (r) return (path) => path === r.path;
  return (path) => path.toLowerCase().includes(s.toLowerCase());
}

// ---------- 执行 ----------

const notLoaded =
  '项目文件当前没有加载（用户刷新了页面或换了设备）。请告诉用户点击界面上的「重新连接项目」后再试，不要凭记忆臆测代码内容。';

function numbered(f: ProjectFile, from: number, to: number) {
  const lines = f.text.split('\n');
  const w = String(to).length;
  const out: string[] = [];
  for (let i = from; i <= to; i++) {
    const t = lines[i - 1] ?? '';
    out.push(`${String(i).padStart(w)}  ${t.length > 600 ? t.slice(0, 600) + ' …' : t}`);
  }
  return out.join('\n');
}

export function runCodeTool(name: string, input: unknown, p: LoadedProject | null): { ok: boolean; content: string } {
  if (!p) return { ok: false, content: notLoaded };

  if (name === 'list_files') {
    const a = ListFilesZ.safeParse(input);
    if (!a.success) return { ok: false, content: '参数校验失败：\n' + z.prettifyError(a.error) };
    const inDir = pathFilter(a.data.dir, p);
    const re = a.data.pattern ? (/[*?]/.test(a.data.pattern) ? globRe(a.data.pattern) : null) : null;
    const frag = a.data.pattern && !re ? a.data.pattern.toLowerCase() : null;
    const list = [...p.files.values()].filter((f) => inDir(f.path) && (!re || re.test(f.path)) && (!frag || f.path.toLowerCase().includes(frag)));
    const shown = list.slice(0, 400);
    const body = shown.map((f) => `${f.path}  (${f.lines} 行)`).join('\n');
    return {
      ok: true,
      content: `找到 ${list.length} 个文件${list.length > shown.length ? `，只显示前 ${shown.length} 个，请缩小范围` : ''}：\n${body}`,
    };
  }

  if (name === 'read_file') {
    const a = ReadFileZ.safeParse(input);
    if (!a.success) return { ok: false, content: '参数校验失败：\n' + z.prettifyError(a.error) };
    const r = resolvePath(a.data.path, p);
    if (!r) return { ok: false, content: `文件 ${a.data.path} 不存在。请对照大纲里的路径，或先用 search_code / list_files 查找。` };
    if (r.isDir) {
      const kids = [...p.files.keys()].filter((k) => (r.path === '' ? !k.includes('/') : k.startsWith(r.path + '/') && !k.slice(r.path.length + 1).includes('/')));
      return { ok: false, content: `${r.path || '根目录'} 是目录，不是文件。其中的文件：\n${kids.join('\n') || '（无直接文件）'}` };
    }
    const f = p.files.get(r.path)!;
    const from = Math.min(a.data.start_line ?? 1, Math.max(1, f.lines));
    let to = Math.min(a.data.end_line ?? from + 499, f.lines, from + 499);
    // 控制单次返回体积
    let text = numbered(f, from, to);
    while (text.length > 48000 && to > from) {
      to = from + Math.floor((to - from) / 2);
      text = numbered(f, from, to);
    }
    const more = to < f.lines ? `\n…（还有 ${f.lines - to} 行，可用 start_line=${to + 1} 继续读取）` : '';
    return { ok: true, content: `已读取 ${f.path} 第 ${from}–${to} 行（共 ${f.lines} 行）\n${text}${more}` };
  }

  if (name === 'search_code') {
    const a = SearchCodeZ.safeParse(input);
    if (!a.success) return { ok: false, content: '参数校验失败：\n' + z.prettifyError(a.error) };
    let re: RegExp;
    try {
      const flags = a.data.case_sensitive ? '' : 'i';
      re = a.data.regex ? new RegExp(a.data.query, flags) : new RegExp(a.data.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch (e) {
      return { ok: false, content: '正则表达式无效：' + (e instanceof Error ? e.message : String(e)) };
    }
    const inScope = pathFilter(a.data.path, p);
    const hits: string[] = [];
    let total = 0;
    for (const f of p.files.values()) {
      if (!inScope(f.path)) continue;
      const lines = f.text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        total++;
        if (hits.length < 80) hits.push(`${f.path}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
      }
    }
    if (!total) return { ok: true, content: `搜索「${a.data.query}」没有结果。` };
    return {
      ok: true,
      content: `搜索「${a.data.query}」共 ${total} 处匹配${total > hits.length ? `，显示前 ${hits.length} 处` : ''}：\n${hits.join('\n')}`,
    };
  }

  return { ok: false, content: `未知工具 ${name}` };
}

// ---------- 节点 ref 校验 ----------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 校验并校正节点的代码位置：路径必须存在；有 symbol 时以符号实际所在行为准 */
export function resolveRef(raw: CodeRefInput, p: LoadedProject | null): { ref?: CodeRef; warning?: string } {
  const note = raw.note?.trim() || undefined;
  const symbol = raw.symbol?.trim() || undefined;
  if (!p) {
    // 项目未加载时无法校验，原样保留
    const path = raw.path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    return { ref: { path, line: raw.line, endLine: raw.end_line, symbol, note } };
  }
  const r = resolvePath(raw.path, p);
  if (!r) return { warning: `ref 路径 "${raw.path}" 在项目中不存在，已忽略该节点的代码位置` };
  if (r.isDir) return { ref: { path: r.path, note } };

  const f = p.files.get(r.path)!;
  const lines = f.text.split('\n');
  let line = raw.line && raw.line >= 1 && raw.line <= f.lines ? raw.line : undefined;
  let warning: string | undefined;
  if (symbol) {
    const bare = symbol.replace(/\(\)$/, '').split(/[.:#]/).pop()!;
    const word = new RegExp(`\\b${escapeRe(bare)}\\b`);
    if (!line || !word.test(lines[line - 1] ?? '')) {
      const sym = f.symbols.find((s) => s.name === bare);
      let found = sym?.line;
      if (!found) {
        // 优先找像定义的行，其次任意出现
        const decl = new RegExp(`(function|def|class|fn|func|interface|type|struct|enum|const|let|var|trait|impl)\\s+${escapeRe(bare)}\\b|\\b${escapeRe(bare)}\\s*[:=(]`);
        const i = lines.findIndex((t) => decl.test(t));
        const j = i >= 0 ? i : lines.findIndex((t) => word.test(t));
        if (j >= 0) found = j + 1;
      }
      if (found) line = found;
      else if (raw.line) warning = `在 ${f.path} 中没有找到符号 "${symbol}"，保留了给出的行号`;
    }
  }
  if (!line && raw.line) line = Math.min(Math.max(1, raw.line), f.lines);
  let endLine = raw.end_line && line && raw.end_line >= line ? Math.min(raw.end_line, f.lines) : undefined;
  if (line && !endLine) {
    const e = blockEnd(f, line);
    if (e > line) endLine = e;
  }
  return { ref: { path: f.path, line, endLine, symbol, note }, warning };
}
