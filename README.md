# Claude 绘图 · AI Diagram Studio

一个类似 draw.io 的在线绘图网站：用对话让 Claude 画流程图、架构图、网络拓扑、组织架构、状态机，并能继续用自然语言修改配色和细节，也可以像 draw.io 一样手动拖拽编辑，最后导出成多种格式。

## 快速开始

```bash
npm install
npm run dev
```

打开 <http://localhost:5178>，点右上角 ⚙ 填入你的 Claude API Key 即可。默认模型为 **Claude Opus 5.5**（`claude-opus-5-5`）。

生产构建：

```bash
npm run build
```

`dist/` 是纯静态文件，可以部署到任意静态托管（Nginx、Vercel、GitHub Pages 等）。

## 功能

**AI 对话绘图**
- 一句话生成整张图；之后说"把数据库换成绿色""改成从左到右""加一个缓存层"就能局部修改，其余元素和位置保持不变
- 选中元素后再提要求，Claude 只改选中的部分
- 上传或粘贴草图 / 白板照片 / 截图，还原成可编辑的图
- 流式显示思考摘要与绘制进度，可随时停止；失败可一键重试
- 模型可选 Opus 5.5（默认）、Fable 5.1、Sonnet 5.5、Haiku 5.5 或自定义模型 ID；可调思考深度（effort）
- 支持自定义 API 地址（代理需要允许浏览器跨域）

**AI 分析项目代码**
- 点顶栏「分析代码」选择本地项目文件夹：整体架构、模块依赖、核心流程（调用链）、数据模型、目录导览，或自定义要求
- 先在浏览器本地扫描出目录树、符号（函数 / 类 / 接口及行号）和文件间 import 关系，再让 Claude 用 `read_file` / `search_code` / `list_files` 按需阅读代码后画图
- 图中每个代码节点都带有代码位置（右上角蓝色 `</>` 标记）：单击节点在右侧代码面板中打开对应文件并高亮这段代码；分组节点可指向目录
- 填写项目的本机路径后可一键在 VS Code / Cursor / JetBrains 中打开（Alt+单击节点直接打开）；回复里的 `路径:行号` 也可点击跳转
- 可继续对话："展开 xx 模块""画出 xx 功能的调用链"；Chrome / Edge 下刷新后一键重新连接文件夹
- 代码只在浏览器内存中读取，不经过中间服务器；发给 Claude API 的是项目大纲（目录树、符号名与行号）和 Claude 主动读取 / 搜索到的代码

**2D / 3D 视图**
- 工具栏左侧一键切换 2D 平面图与 3D 等轴测立体图，同一份图表、随图表保存
- 3D 下分组变成分层平台，子节点立在平台上；图形按轮廓挤出成立体（圆形为球体、三角形为四棱锥、数据库为圆柱），带明暗与投影
- 24 种 3D 素材：服务器机柜、数据库、存储阵列、云、用户 / 用户组、显示器、笔记本、手机、地球、纸箱、集装箱、芯片、路由器、交换机、消息队列、邮件、文件、文件夹、大楼、工厂、商店、房屋、分层等；其余图标显示为印有图标的立体方块
- 可拖动节点、旋转视角（90° 步进）、缩放平移；样式面板可调每个节点的「3D 高度」
- 对 Claude 说"做成 3D 效果"即可切换并自动选用 3D 素材；导出 PNG / SVG / PDF 时所见即所得

**画布编辑（draw.io 式）**
- 15 种图形 + 70 多个图标节点，拖入或点击添加
- 拖动连接点连线，连线自动贴合最近的边；4 种线型、箭头方向、虚线、流动动画
- 双击编辑文字，拖拽缩放，框选多选，拖进分组容器自动归组
- 撤销/重做、复制粘贴、自动布局（ELK 分层布局，支持嵌套分组）、一键配色方案
- 深色模式；所有图表自动保存在本机浏览器，可在标题旁的下拉菜单里切换

**导出 / 打开**
- 图片：PNG（2x，可透明背景）、JPG、SVG（纯矢量，可在 Figma/Illustrator 中编辑）、PDF
- 可编辑格式：`.drawio`（可用 draw.io / diagrams.net 继续编辑）、JSON、Mermaid
- 复制为图片、复制 Mermaid 代码
- 可打开 `.json` 与 `.drawio` 文件（含 draw.io 压缩格式）

## 关于 API Key 与隐私

API Key 只保存在当前浏览器的 localStorage 中，请求由浏览器直接发往 Claude API（使用官方 `@anthropic-ai/sdk` 的浏览器模式），不经过任何中间服务器。请不要在公共电脑上保存 Key。

## 实现要点

| 模块 | 位置 |
| --- | --- |
| AI 调用循环（流式、工具调用、拒答回退、错误处理） | `src/ai/agent.ts` |
| 工具定义（`create_diagram` / `edit_diagram`，Zod 校验） | `src/ai/tools.ts` |
| 系统提示 | `src/ai/prompt.ts` |
| 对话会话与画布联动 | `src/ai/session.ts` |
| 图表模型 ↔ React Flow 转换 | `src/lib/convert.ts` |
| 自动布局（ELK） | `src/lib/layout.ts` |
| 导出 / 导入 | `src/lib/exporters.ts`、`src/lib/importers.ts` |
| 3D 等轴测渲染（投影、挤出、光影、3D 素材，画布与导出共用） | `src/lib/iso.ts` |
| 3D 画布交互 | `src/components/IsoCanvas.tsx` |
| 代码分析：读取文件夹、静态索引、项目大纲、只读代码工具 | `src/code/` |
| 代码面板与分析对话框 | `src/components/CodePeek.tsx`、`src/components/CodeAnalysisDialog.tsx` |
| 界面 | `src/components/` |

- 每次请求都在用户消息里附上当前画布的 JSON 快照，因此你在两轮对话之间手动改过的内容 Claude 都能看到；对话历史只追加不改写，系统提示固定以命中提示缓存。
- 默认开启自适应思考（adaptive thinking）与服务端拒答回退（`fallbacks: "default"`，Haiku 不支持，使用代理时可在设置中关闭）。
- 工具参数开启流式（`eager_input_streaming`），并在执行前用 Zod 校验；校验失败会把错误返回给模型让它自行修正。

技术栈：Vite + React 19 + TypeScript、@xyflow/react、elkjs、Zod、zustand、jsPDF、lucide-react。界面遵循"苹果式简约"设计语言（`src/styles/tokens.css`）。
