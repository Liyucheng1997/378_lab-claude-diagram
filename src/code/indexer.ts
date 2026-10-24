import type { CodeSymbol, ProjectFile, SymbolKind } from './types';

// 轻量静态索引：用正则提取符号与本地 import，只求"足够让 AI 定位"，不追求完整解析。

const EXT_LANG: Record<string, string> = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', vue: 'vue', svelte: 'svelte',
  py: 'py', pyi: 'py', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', cs: 'csharp',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', m: 'objc', mm: 'objc',
  swift: 'swift', rb: 'ruby', php: 'php', dart: 'dart', lua: 'lua', r: 'r', ex: 'elixir', exs: 'elixir', erl: 'erlang',
  hs: 'haskell', clj: 'clojure', zig: 'zig', sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', bat: 'bat',
  sql: 'sql', html: 'html', htm: 'html', css: 'css', scss: 'css', sass: 'css', less: 'css', md: 'markdown', mdx: 'markdown',
  rst: 'text', txt: 'text', json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml', ini: 'ini',
  cfg: 'ini', conf: 'ini', gradle: 'gradle', proto: 'proto', graphql: 'graphql', gql: 'graphql', prisma: 'prisma',
  tf: 'hcl', cmake: 'cmake', mk: 'make', env: 'ini',
};

const NAME_LANG: Record<string, string> = {
  dockerfile: 'docker', makefile: 'make', 'cmakelists.txt': 'cmake', gemfile: 'ruby', rakefile: 'ruby', procfile: 'text',
  '.gitignore': 'text', '.env.example': 'ini', license: 'text', readme: 'text',
};

export function langOf(path: string): string | null {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (NAME_LANG[base]) return NAME_LANG[base];
  const dot = base.lastIndexOf('.');
  if (dot < 0) return null;
  return EXT_LANG[base.slice(dot + 1)] ?? null;
}

/** 参与符号提取与依赖分析的编程语言（配置、文档类文件只做全文搜索） */
export const CODE_LANGS = new Set([
  'ts', 'js', 'vue', 'svelte', 'py', 'go', 'rust', 'java', 'kotlin', 'scala', 'csharp', 'c', 'cpp', 'objc', 'swift', 'ruby', 'php', 'dart', 'lua',
]);

type Rule = [RegExp, SymbolKind, { method?: boolean }?];

const JS_ID = '[A-Za-z_$][\\w$]*';
const JS_RULES: Rule[] = [
  [new RegExp(`^(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${JS_ID})`), 'function'],
  [new RegExp(`^(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?class\\s+(${JS_ID})`), 'class'],
  [new RegExp(`^(?:export\\s+)?(?:declare\\s+)?interface\\s+(${JS_ID})`), 'interface'],
  [new RegExp(`^(?:export\\s+)?(?:declare\\s+)?type\\s+(${JS_ID})\\s*(?:<[^=]*>)?\\s*=`), 'type'],
  [new RegExp(`^(?:export\\s+)?(?:declare\\s+)?(?:const\\s+)?enum\\s+(${JS_ID})`), 'enum'],
  [new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+(${JS_ID})\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>|${JS_ID}\\s*=>)`), 'function'],
  [new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+(${JS_ID})\\s*(?::[^=]+)?=\\s*(?:create|defineStore|createSlice|createContext|memo|forwardRef|styled|React\\.memo)\\b`), 'const'],
  [new RegExp(`^export\\s+(?:const|let|var)\\s+(${JS_ID})`), 'const'],
  // 类方法与对象字面量方法（缩进 2–4，行尾是 {），如 zustand store 里的 action
  [
    new RegExp(`^\\s{2,4}(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\\s+)*(\\*?${JS_ID})\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)?\\s*(?::\\s*[^{=]+)?\\{\\s*$`),
    'method',
    { method: true },
  ],
];

const PY_RULES: Rule[] = [
  [/^class\s+(\w+)/, 'class'],
  [/^(?:async\s+)?def\s+(\w+)/, 'function'],
  [/^\s{2,8}(?:async\s+)?def\s+(\w+)/, 'method', { method: true }],
];

const GO_RULES: Rule[] = [
  [/^func\s+(\w+)/, 'function'],
  [/^type\s+(\w+)\s+struct\b/, 'struct'],
  [/^type\s+(\w+)\s+interface\b/, 'interface'],
  [/^type\s+(\w+)\b/, 'type'],
];

const RUST_RULES: Rule[] = [
  [/^(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"\w+"\s+)?fn\s+(\w+)/, 'function'],
  [/^\s{4}(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/, 'method', { method: true }],
  [/^(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)/, 'struct'],
  [/^(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)/, 'enum'],
  [/^(?:pub(?:\([^)]*\))?\s+)?trait\s+(\w+)/, 'trait'],
  [/^(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)/, 'module'],
  [/^impl(?:<[^>]*>)?\s+(?:[\w:<>]+\s+for\s+)?([\w:]+)/, 'impl'],
];

const MODS = '(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|override|virtual|async|suspend|inline|synchronized|readonly|unsafe|extern|new)';
const OOP_RULES: Rule[] = [
  [new RegExp(`^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s+)*(?:${MODS}\\s+)*(?:class|interface|enum|record|struct|object|protocol|extension|trait)\\s+(\\w+)`), 'class'],
  [/^\s*(?:\w+\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)\s*\(/, 'method', { method: true }],
  [/^\s*(?:\w+\s+)*func\s+(\w+)/, 'method', { method: true }],
  [new RegExp(`^\\s+(?:${MODS}\\s+)+[\\w<>\\[\\],.?\\s]*?\\b(\\w+)\\s*\\([^;]*$`), 'method', { method: true }],
];

const C_RULES: Rule[] = [
  [/^(?:typedef\s+)?(?:struct|class|enum|union|namespace)\s+(\w+)\s*(?:[:{]|$)/, 'struct'],
  [/^(?!(?:if|for|while|switch|return|else|do|case)\b)(?:static\s+|inline\s+|extern\s+|virtual\s+|const\s+|unsigned\s+)*[\w:<>,]+[\s*&]+\**([A-Za-z_][\w:~]*)\s*\([^;]*$/, 'function'],
];

const RUBY_RULES: Rule[] = [
  [/^\s*class\s+([\w:]+)/, 'class'],
  [/^\s*module\s+([\w:]+)/, 'module'],
  [/^\s*def\s+(?:self\.)?(\w+[?!=]?)/, 'method', { method: true }],
];

const PHP_RULES: Rule[] = [
  [/^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+(\w+)/, 'class'],
  [/^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+(\w+)/, 'function'],
];

const LUA_RULES: Rule[] = [[/^\s*(?:local\s+)?function\s+([\w.:]+)/, 'function']];

const RULES: Record<string, Rule[]> = {
  ts: JS_RULES, js: JS_RULES, vue: JS_RULES, svelte: JS_RULES, py: PY_RULES, go: GO_RULES, rust: RUST_RULES,
  java: OOP_RULES, kotlin: OOP_RULES, scala: OOP_RULES, csharp: OOP_RULES, swift: OOP_RULES, dart: OOP_RULES,
  c: C_RULES, cpp: C_RULES, objc: C_RULES, ruby: RUBY_RULES, php: PHP_RULES, lua: LUA_RULES,
};

const NOT_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do', 'try', 'with', 'new', 'typeof', 'await', 'super', 'this', 'when', 'match', 'elif', 'until', 'unless', 'foreach', 'using', 'lock', 'sizeof']);
const GO_METHOD = /^func\s+\(\s*\w+\s+\*?([\w.]+)(?:\[[^\]]*\])?\s*\)\s*(\w+)/;

export function extractSymbols(text: string, lang: string): CodeSymbol[] {
  const rules = RULES[lang];
  if (!rules) return [];
  const out: CodeSymbol[] = [];
  const lines = text.split('\n');
  let container: string | undefined; // 最近的顶层类 / 对象，用作方法的归属
  // vue / svelte 只看 <script> 部分
  let inScript = lang !== 'vue' && lang !== 'svelte';
  for (let i = 0; i < lines.length && out.length < 400; i++) {
    const line = lines[i];
    if (!inScript) {
      if (/<script\b/.test(line)) inScript = true;
      continue;
    }
    if ((lang === 'vue' || lang === 'svelte') && /<\/script>/.test(line)) {
      inScript = false;
      continue;
    }
    if (line.length > 400 || !line.trim()) continue;
    if (lang === 'go') {
      const m = GO_METHOD.exec(line);
      if (m) {
        out.push({ name: m[2], kind: 'method', line: i + 1, parent: m[1], exported: /^[A-Z]/.test(m[2]) });
        continue;
      }
    }
    for (const [re, kind, opt] of rules) {
      const m = re.exec(line);
      if (!m) continue;
      const name = m[1].replace(/^\*/, '');
      if (NOT_NAMES.has(name)) break;
      if (opt?.method) {
        // 顶层的 "method" 规则命中其实是普通函数
        const indented = /^\s/.test(line);
        out.push({ name, kind: indented ? 'method' : 'function', line: i + 1, parent: indented ? container : undefined });
      } else {
        const exported = /^export\b/.test(line) || /^pub\b/.test(line) || (lang === 'go' && /^[A-Z]/.test(name));
        out.push({ name, kind, line: i + 1, exported: exported || undefined });
        if (!/^\s/.test(line) || kind === 'class' || kind === 'impl') container = name;
      }
      break;
    }
  }
  return out;
}

// ---------- 本地依赖 ----------

const JS_IMPORT = /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"\n]+)['"]/g;
const JS_DYNAMIC = /(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const JS_EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.d.ts', '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.vue'];

function joinRel(dir: string, rel: string): string {
  const parts = dir ? dir.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function resolveJs(from: string, spec: string, has: (p: string) => boolean): string | null {
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  let base: string;
  if (spec.startsWith('.')) base = joinRel(dir, spec);
  else if (spec.startsWith('@/') || spec.startsWith('~/')) base = 'src/' + spec.slice(2);
  else if (spec.startsWith('/')) base = spec.slice(1);
  else return null;
  const bases = [base];
  // TS 的 ESM 写法：import './a.js' 实际指向 a.ts
  if (/\.(m|c)?js$/.test(base)) bases.push(base.replace(/\.(m|c)?js$/, ''));
  for (const b of bases) for (const ext of JS_EXTS) if (has(b + ext)) return b + ext;
  return null;
}

function resolvePy(from: string, spec: string, has: (p: string) => boolean): string | null {
  let base: string;
  if (spec.startsWith('.')) {
    const dots = /^\.+/.exec(spec)![0].length;
    let dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    for (let i = 1; i < dots; i++) dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
    const rest = spec.slice(dots).replace(/\./g, '/');
    base = [dir, rest].filter(Boolean).join('/');
  } else base = spec.replace(/\./g, '/');
  for (const prefix of ['', 'src/']) for (const ext of ['.py', '/__init__.py']) if (has(prefix + base + ext)) return prefix + base + ext;
  return null;
}

export function extractImports(path: string, text: string, lang: string, has: (p: string) => boolean): string[] {
  const out = new Set<string>();
  if (lang === 'ts' || lang === 'js' || lang === 'vue' || lang === 'svelte') {
    for (const re of [JS_IMPORT, JS_DYNAMIC]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const r = resolveJs(path, m[1], has);
        if (r && r !== path) out.add(r);
      }
    }
  } else if (lang === 'py') {
    for (const line of text.split('\n')) {
      const m = /^\s*from\s+([.\w]+)\s+import\s+(.+)/.exec(line) ?? /^\s*import\s+([\w.]+)/.exec(line);
      if (!m) continue;
      const r = resolvePy(path, m[1], has);
      // from . import a, b → 分别指向子模块
      if (!r && m[2] && /^\.+$/.test(m[1])) {
        for (const name of m[2].split(',')) {
          const sub = resolvePy(path, m[1] + name.trim().split(/\s+/)[0], has);
          if (sub) out.add(sub);
        }
      }
      if (r && r !== path) out.add(r);
    }
  }
  return [...out];
}

/** 估算从 line 开始的代码块结束行：花括号配平，或 Python 式缩进 */
export function blockEnd(file: ProjectFile, line: number): number {
  const lines = file.text.split('\n');
  const start = line - 1;
  if (start < 0 || start >= lines.length) return line;
  const indentOf = (s: string) => /^\s*/.exec(s)![0].length;
  if (file.lang === 'py' || file.lang === 'ruby') {
    const base = indentOf(lines[start]);
    let end = start;
    for (let i = start + 1; i < Math.min(lines.length, start + 600); i++) {
      if (!lines[i].trim()) continue;
      if (indentOf(lines[i]) <= base) break;
      end = i;
    }
    return end + 1;
  }
  let depth = 0;
  let opened = false;
  for (let i = start; i < Math.min(lines.length, start + 800); i++) {
    // 去掉字符串和行注释，避免其中的括号干扰计数
    const s = lines[i].replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '').replace(/\/\/.*$/, '');
    for (const ch of s) {
      if (ch === '{') (depth++, (opened = true));
      else if (ch === '}') depth--;
    }
    if (opened && depth <= 0) return i + 1;
    // 头几行都没遇到 { 的，就当作单行定义
    if (!opened && i - start >= 3) return line;
  }
  return line;
}
