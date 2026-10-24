// 极简语法着色：注释、字符串、关键字、数字。逐行处理，只跟踪 /* */ 块注释的跨行状态。

export type Token = { t: string; c?: 'c' | 's' | 'k' | 'n' };

const KEYWORDS = new Set(
  (
    'abstract as async await break case catch class const continue def default defer del do elif else enum export extends ' +
    'false final finally fn for from func function go if impl implements import in instanceof interface is lambda let ' +
    'match mod module mut new nil none null object of override package pass private protected pub public raise readonly ' +
    'return self static struct super switch this throw throws trait true try type typeof undefined use val var void ' +
    'where while with yield True False None and or not elif except global nonlocal assert crate dyn ref unsafe extern ' +
    'select chan map range fallthrough goto namespace using template typename virtual sealed internal suspend when fun'
  ).split(' '),
);

const HASH_COMMENT = new Set(['py', 'shell', 'ruby', 'yaml', 'toml', 'ini', 'make', 'docker', 'r', 'elixir', 'powershell', 'cmake', 'hcl']);
const NO_SLASH = new Set(['py', 'shell', 'ruby', 'yaml', 'toml', 'ini', 'make', 'docker', 'markdown', 'text', 'r', 'elixir', 'html', 'xml', 'json']);

export function highlight(lines: string[], lang: string): Token[][] {
  if (lang === 'markdown' || lang === 'text') return lines.map((t) => [{ t }]);
  const hash = HASH_COMMENT.has(lang);
  const slash = !NO_SLASH.has(lang);
  const parts = [
    slash ? '\\/\\/.*$' : null,
    hash ? '#.*$' : null,
    lang === 'sql' || lang === 'lua' || lang === 'haskell' ? '--.*$' : null,
    slash ? '\\/\\*.*?(?:\\*\\/|$)' : null,
    lang === 'html' || lang === 'xml' || lang === 'vue' || lang === 'svelte' ? '<!--.*?(?:-->|$)' : null,
    '"(?:\\\\.|[^"\\\\])*"',
    "'(?:\\\\.|[^'\\\\])*'",
    '`(?:\\\\.|[^`\\\\])*`',
    '\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b|\\b0x[\\da-f]+\\b',
    '\\b[A-Za-z_]\\w*\\b',
  ].filter(Boolean);
  const re = new RegExp(parts.join('|'), 'gi');
  let inBlock = false;

  return lines.map((line) => {
    const out: Token[] = [];
    let i = 0;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) return [{ t: line, c: 'c' }];
      out.push({ t: line.slice(0, end + 2), c: 'c' });
      i = end + 2;
      inBlock = false;
    }
    re.lastIndex = i;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (m.index > i) out.push({ t: line.slice(i, m.index) });
      const t = m[0];
      const ch = t[0];
      let c: Token['c'];
      if (t.startsWith('//') || (hash && ch === '#') || t.startsWith('--') || t.startsWith('<!--')) c = 'c';
      else if (t.startsWith('/*')) {
        c = 'c';
        if (!t.endsWith('*/') || t.length < 4) inBlock = true;
      } else if (ch === '"' || ch === "'" || ch === '`') c = 's';
      else if (/\d/.test(ch)) c = 'n';
      else if (KEYWORDS.has(t)) c = 'k';
      out.push(c ? { t, c } : { t });
      i = m.index + t.length;
      if (t.length === 0) re.lastIndex++;
    }
    if (i < line.length) out.push({ t: line.slice(i) });
    return out;
  });
}
