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
| 界面 | `src/components/` |

- 每次请求都在用户消息里附上当前画布的 JSON 快照，因此你在两轮对话之间手动改过的内容 Claude 都能看到；对话历史只追加不改写，系统提示固定以命中提示缓存。
- 默认开启自适应思考（adaptive thinking）与服务端拒答回退（`fallbacks: "default"`，Haiku 不支持，使用代理时可在设置中关闭）。
- 工具参数开启流式（`eager_input_streaming`），并在执行前用 Zod 校验；校验失败会把错误返回给模型让它自行修正。

技术栈：Vite + React 19 + TypeScript、@xyflow/react、elkjs、Zod、zustand、jsPDF、lucide-react。界面遵循"苹果式简约"设计语言（`src/styles/tokens.css`）。
