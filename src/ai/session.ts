import type { BetaContentBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from 'zod';
import { buildOutline } from '../code/outline';
import { useCode } from '../code/store';
import { CODE_TOOL_NAMES, CODE_TOOLS, resolveRef, runCodeTool } from '../code/tools';
import { useEditor } from '../store';
import { runTurn, TurnError } from './agent';
import { buildUserText, CODE_SYSTEM_PROMPT, SYSTEM_PROMPT } from './prompt';
import { CreateDiagramZ, diagramForPrompt, EditDiagramZ, runCreate, runEdit, TOOLS, type RefResolver } from './tools';
import type { ChatItem, Settings, ToolActivity } from './types';

export interface ImageAttachment {
  dataUrl: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  base64: string;
}

let controller: AbortController | null = null;

export function stopGeneration() {
  controller?.abort();
}

async function executeTool(name: string, input: unknown): Promise<{ ok: boolean; content: string }> {
  const s = useEditor.getState();
  const current = s.getDiagram();
  const resolve: RefResolver = (r) => resolveRef(r, useCode.getState().project);
  try {
    if (CODE_TOOL_NAMES.has(name)) return runCodeTool(name, input, useCode.getState().project);
    if (name === 'create_diagram') {
      const p = CreateDiagramZ.safeParse(input);
      if (!p.success) return { ok: false, content: '参数校验失败，请修正后重试：\n' + z.prettifyError(p.error) };
      const out = await runCreate(p.data, current, resolve);
      s.setDiagram(out.diagram, { fit: true });
      return { ok: true, content: out.summary + (out.warnings.length ? '\n警告：\n- ' + out.warnings.join('\n- ') : '') };
    }
    if (name === 'edit_diagram') {
      const p = EditDiagramZ.safeParse(input);
      if (!p.success) return { ok: false, content: '参数校验失败，请修正后重试：\n' + z.prettifyError(p.error) };
      const out = await runEdit(p.data, current, resolve);
      s.setDiagram(out.diagram, { fit: out.fit });
      return { ok: true, content: out.summary + (out.warnings.length ? '\n警告：\n- ' + out.warnings.join('\n- ') : '') };
    }
    return { ok: false, content: `未知工具 ${name}` };
  } catch (e) {
    return { ok: false, content: '执行失败：' + (e instanceof Error ? e.message : String(e)) };
  }
}

/** 把高频的流式增量合并到每一帧，避免逐字触发渲染 */
function frameBatcher(apply: (fn: (a: ChatItem) => ChatItem) => void) {
  let text = '';
  let thinking = '';
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (!text && !thinking) return;
    const t = text, th = thinking;
    text = thinking = '';
    apply((a) => ({ ...a, text: a.text + t, thinking: th ? (a.thinking ?? '') + th : a.thinking }));
  };
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  };
  return {
    text(d: string) {
      text += d;
      schedule();
    },
    thinking(d: string) {
      thinking += d;
      schedule();
    },
    flush,
  };
}

const newId = () => Math.random().toString(36).slice(2, 10);

/** 项目大纲只需在对话里出现一次（新对话或换了项目时重新附带） */
function outlineSent(history: BetaMessageParam[], name: string) {
  const mark = `<project_outline name="${name}"`;
  return history.some(
    (m) => m.role === 'user' && typeof m.content !== 'string' && m.content.some((b) => b.type === 'text' && b.text.startsWith(mark)),
  );
}

export async function sendMessage(text: string, images: ImageAttachment[], settings: Settings) {
  const s = useEditor.getState();
  if (s.busy || (!text.trim() && !images.length)) return;

  const selection = [...s.nodes.filter((n) => n.selected).map((n) => n.id), ...s.edges.filter((e) => e.selected).map((e) => e.id)];
  const meta = s.project;
  const loaded = useCode.getState().project;
  const codeMode = !!meta;
  const outline = meta && loaded?.name === meta.name && !outlineSent(s.apiHistory, meta.name) ? buildOutline(loaded) : null;
  const userContent: BetaContentBlockParam[] = [
    ...(outline ? [{ type: 'text' as const, text: outline }] : []),
    ...images.map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 } })),
    { type: 'text', text: buildUserText(text.trim() || '请把图片里的内容还原成可编辑的图表。', diagramForPrompt(s.getDiagram()), selection) },
  ];

  const userItem: ChatItem = { id: newId(), role: 'user', text, images: images.map((i) => i.dataUrl), createdAt: Date.now() };
  const asstId = newId();
  const asst: ChatItem = { id: asstId, role: 'assistant', text: '', tools: [], status: 'streaming', createdAt: Date.now() };
  s.setChat((c) => [...c, userItem, asst]);
  s.setBusy(true);

  const patch = (fn: (a: ChatItem) => ChatItem) => useEditor.getState().setChat((c) => c.map((x) => (x.id === asstId ? fn(x) : x)));
  const patchTool = (id: string, fn: (t: ToolActivity) => ToolActivity) =>
    patch((a) => ({ ...a, tools: (a.tools ?? []).map((t) => (t.id === id ? fn(t) : t)) }));
  const batch = frameBatcher(patch);
  const lastTick = new Map<string, number>();
  controller = new AbortController();

  try {
    const res = await runTurn({
      settings,
      history: s.apiHistory,
      userContent,
      signal: controller.signal,
      execute: executeTool,
      system: codeMode ? [SYSTEM_PROMPT, CODE_SYSTEM_PROMPT] : [SYSTEM_PROMPT],
      tools: codeMode ? [...TOOLS, ...CODE_TOOLS] : TOOLS,
      maxRounds: codeMode ? 40 : 10,
      cb: {
        onRound() {
          batch.flush();
          patch((a) => (a.text && !a.text.endsWith('\n\n') ? { ...a, text: a.text + '\n\n' } : a));
        },
        onThinking: batch.thinking,
        onText: batch.text,
        onToolStart(id, name) {
          batch.flush();
          patch((a) => ({ ...a, tools: [...(a.tools ?? []), { id, name, status: 'running', chars: 0, at: a.text.length }] }));
        },
        onToolInput(id, chars) {
          // 进度只需粗略更新
          const now = performance.now();
          if (now - (lastTick.get(id) ?? 0) < 120) return;
          lastTick.set(id, now);
          patchTool(id, (t) => ({ ...t, chars }));
        },
        onToolResult(id, ok, summary) {
          patchTool(id, (t) => ({ ...t, status: ok ? 'done' : 'error', summary: summary.split('\n')[0] }));
        },
        onServedBy(model) {
          patch((a) => ({ ...a, servedBy: model }));
        },
      },
    });
    batch.flush();
    useEditor.getState().setApiHistory(res.history);
    patch((a) => ({
      ...a,
      text: a.text.trimEnd(),
      status: res.stop === 'refused' ? 'refused' : 'done',
      error: res.stop === 'refused' ? res.refusal : undefined,
    }));
  } catch (e) {
    batch.flush();
    const te = e instanceof TurnError ? e : null;
    if (te) useEditor.getState().setApiHistory(te.history);
    patch((a) => ({
      ...a,
      text: a.text.trimEnd(),
      status: te?.aborted ? 'stopped' : 'error',
      error: te ? te.message : String(e),
      tools: (a.tools ?? []).map((t) => (t.status === 'running' ? { ...t, status: 'error' } : t)),
    }));
  } finally {
    controller = null;
    useEditor.getState().setBusy(false);
  }
}

/** 重试：去掉失败的那一问一答，重新发送 */
export function retry(assistantId: string, settings: Settings) {
  const s = useEditor.getState();
  const i = s.chat.findIndex((c) => c.id === assistantId);
  const user = s.chat[i - 1];
  if (i < 1 || user?.role !== 'user') return;
  const images: ImageAttachment[] = (user.images ?? []).map(parseDataUrl).filter((x): x is ImageAttachment => !!x);
  s.setChat((c) => c.filter((x) => x.id !== assistantId && x.id !== user.id));
  return sendMessage(user.text, images, settings);
}

export function parseDataUrl(dataUrl: string): ImageAttachment | null {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(dataUrl);
  return m ? { dataUrl, mediaType: m[1] as ImageAttachment['mediaType'], base64: m[2] } : null;
}

/** 读取图片并把长边限制在 1568px（Claude 推荐的上限），减少体积 */
export async function fileToAttachment(file: File): Promise<ImageAttachment> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const max = 1568;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const dataUrl = canvas.toDataURL(type, 0.9);
    return parseDataUrl(dataUrl)!;
  } finally {
    URL.revokeObjectURL(url);
  }
}
