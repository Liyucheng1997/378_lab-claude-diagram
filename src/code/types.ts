// 代码分析：项目在浏览器里只读打开，文件内容只保存在内存中。

/** 图表节点指向的代码位置；path 相对项目根目录，用正斜杠 */
export interface CodeRef {
  path: string;
  /** 从 1 开始；目录或整文件可省略 */
  line?: number;
  endLine?: number;
  symbol?: string;
  /** 一句话职责说明，点击节点时展示 */
  note?: string;
}

/** 随图表一起保存的项目信息（不含文件内容） */
export interface ProjectMeta {
  name: string;
  /** 本机绝对路径，用于在 VS Code 等编辑器中打开；浏览器拿不到，需用户填写 */
  rootPath?: string;
}

export type SymbolKind = 'function' | 'method' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'struct' | 'trait' | 'module' | 'impl';

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
  exported?: boolean;
  /** 方法所属的类 / 对象 */
  parent?: string;
}

export interface ProjectFile {
  path: string;
  text: string;
  lines: number;
  size: number;
  lang: string;
  symbols: CodeSymbol[];
  /** 解析到项目内文件的本地依赖 */
  imports: string[];
}

export interface LoadedProject {
  name: string;
  files: Map<string, ProjectFile>;
  dirs: Set<string>;
  totalLines: number;
  /** 被忽略的文件数（依赖目录、二进制、过大等） */
  skipped: number;
  /** 达到上限而未读取 */
  truncated: boolean;
  loadedAt: number;
}

export type EditorKind = 'vscode' | 'cursor' | 'idea';
