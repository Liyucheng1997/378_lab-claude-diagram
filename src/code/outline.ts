import { CODE_LANGS } from './indexer';
import type { CodeSymbol, LoadedProject } from './types';

// 发给模型的项目大纲：目录树 + 行数 + 符号@行号 + 本地依赖。控制总长度，超出部分让模型用工具自行查看。

const TREE_BUDGET = 24000;
const SYMBOL_BUDGET = 56000;

function fmtSymbol(s: CodeSymbol) {
  const star = s.exported ? '*' : '';
  switch (s.kind) {
    case 'function':
      return `${star}${s.name}()@${s.line}`;
    case 'method':
      return `${s.parent ? s.parent + '.' : '.'}${s.name}()@${s.line}`;
    default:
      return `${star}${s.kind} ${s.name}@${s.line}`;
  }
}

function tree(p: LoadedProject): string {
  const children = new Map<string, { dirs: Set<string>; files: string[] }>();
  const node = (d: string) => {
    if (!children.has(d)) children.set(d, { dirs: new Set(), files: [] });
    return children.get(d)!;
  };
  node('');
  for (const d of p.dirs) {
    const parent = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '';
    node(parent).dirs.add(d);
    node(d);
  }
  for (const f of p.files.keys()) node(f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '').files.push(f);

  const count = (d: string): number => {
    const n = children.get(d)!;
    return n.files.length + [...n.dirs].reduce((a, c) => a + count(c), 0);
  };
  const out: string[] = [];
  let size = 0;
  let cut = false;
  const walk = (d: string, depth: number) => {
    const n = children.get(d)!;
    const pad = '  '.repeat(depth);
    for (const sub of [...n.dirs].sort()) {
      const name = sub.slice(sub.lastIndexOf('/') + 1);
      if (size > TREE_BUDGET) {
        cut = true;
        out.push(`${pad}${name}/ （${count(sub)} 个文件，已折叠）`);
        continue;
      }
      out.push(`${pad}${name}/`);
      size += pad.length + name.length;
      walk(sub, depth + 1);
    }
    const files = n.files.sort();
    if (size > TREE_BUDGET && files.length) {
      cut = true;
      out.push(`${pad}…${files.length} 个文件`);
      return;
    }
    for (const f of files) {
      const line = `${pad}${f.slice(f.lastIndexOf('/') + 1)} ${p.files.get(f)!.lines}`;
      out.push(line);
      size += line.length;
    }
  };
  walk('', 0);
  return out.join('\n') + (cut ? '\n（部分目录已折叠，可用 list_files 查看）' : '');
}

export function buildOutline(p: LoadedProject): string {
  const langs = new Map<string, number>();
  for (const f of p.files.values()) langs.set(f.lang, (langs.get(f.lang) ?? 0) + f.lines);
  const langLine = [...langs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([l, n]) => `${l} ${n} 行`)
    .join('，');

  const parts: string[] = [];
  let size = 0;
  let omitted = 0;
  // 先列被依赖多的文件，预算不足时省略的是边缘文件
  const inbound = new Map<string, number>();
  for (const f of p.files.values()) for (const i of f.imports) inbound.set(i, (inbound.get(i) ?? 0) + 1);
  const code = [...p.files.values()].filter((f) => CODE_LANGS.has(f.lang) && (f.symbols.length || f.imports.length));
  const ranked = [...code].sort((a, b) => (inbound.get(b.path) ?? 0) - (inbound.get(a.path) ?? 0) || a.path.localeCompare(b.path));
  const keep = new Set<string>();
  for (const f of ranked) {
    const est = f.path.length + f.symbols.length * 18 + f.imports.join(', ').length + 20;
    if (size + est > SYMBOL_BUDGET) {
      omitted++;
      continue;
    }
    size += est;
    keep.add(f.path);
  }
  for (const f of code) {
    if (!keep.has(f.path)) continue;
    let s = f.path;
    if (f.imports.length) s += `  → ${f.imports.join(', ')}`;
    if (f.symbols.length) s += '\n  ' + f.symbols.slice(0, 80).map(fmtSymbol).join(', ') + (f.symbols.length > 80 ? ` …共 ${f.symbols.length} 个` : '');
    parts.push(s);
  }

  return `<project_outline name="${p.name}" files="${p.files.size}" lines="${p.totalLines}">
语言：${langLine}${p.truncated ? '\n注意：项目过大，只读取了部分文件。' : ''}

## 目录树（文件名后的数字是行数；已忽略 node_modules、构建产物等）
${tree(p)}

## 符号与依赖（静态扫描，行号从 1 开始；* 为导出，Foo.bar() 为方法，→ 后是该文件导入的项目内文件）
${parts.join('\n') || '（没有识别到符号）'}${omitted ? `\n（另有 ${omitted} 个文件的符号因篇幅省略，可用 read_file / search_code 查看）` : ''}
</project_outline>`;
}
