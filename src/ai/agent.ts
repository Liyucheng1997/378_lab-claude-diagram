import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaTextBlockParam,
  BetaToolUnion,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Settings } from './types';

export interface TurnCallbacks {
  /** 每次向 API 发起一轮请求（工具循环中会有多轮） */
  onRound(): void;
  onThinking(delta: string): void;
  onText(delta: string): void;
  onToolStart(id: string, name: string): void;
  onToolInput(id: string, chars: number): void;
  onToolResult(id: string, ok: boolean, summary: string): void;
  onServedBy(model: string): void;
}

export type ToolExecutor = (name: string, input: unknown) => Promise<{ ok: boolean; content: string }>;

export interface TurnResult {
  history: BetaMessageParam[];
  stop: 'done' | 'refused';
  refusal?: string;
}

/** 失败时携带"最后一个一致的历史"，调用方据此恢复，保证历史只追加、不改写 */
export class TurnError extends Error {
  constructor(
    message: string,
    public history: BetaMessageParam[],
    public aborted = false,
  ) {
    super(message);
  }
}

export function makeClient(s: Settings) {
  return new Anthropic({
    apiKey: s.apiKey.trim(),
    baseURL: s.baseURL.trim() || undefined,
    // 用户在自己的浏览器里使用自己的 Key，请求直接发往 Anthropic（或用户填写的代理）
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
  });
}

/** Haiku 没有服务端回退；其余当前模型都支持 fallbacks: "default" */
function supportsFallback(model: string) {
  return !/haiku/i.test(model);
}

export async function runTurn(opts: {
  settings: Settings;
  history: BetaMessageParam[];
  userContent: BetaContentBlockParam[];
  signal: AbortSignal;
  cb: TurnCallbacks;
  execute: ToolExecutor;
  system: string[];
  tools: BetaToolUnion[];
  /** 工具循环的最大轮数（代码分析需要多轮阅读） */
  maxRounds?: number;
}): Promise<TurnResult> {
  const { settings, signal, cb } = opts;
  const client = makeClient(settings);
  let consistent = opts.history; // 出错时回退到这里
  const working: BetaMessageParam[] = [...opts.history, { role: 'user', content: opts.userContent }];
  const fallback = settings.fallback && supportsFallback(settings.model);
  let jsonRetries = 0;
  // 缓存断点放在最后一段系统提示上
  const system: BetaTextBlockParam[] = opts.system.map((text, i) =>
    i === opts.system.length - 1 ? { type: 'text', text, cache_control: { type: 'ephemeral' } } : { type: 'text', text },
  );
  const maxRounds = opts.maxRounds ?? 10;

  try {
    for (let round = 0; round < maxRounds; round++) {
      const params: BetaMessageStreamParams = {
        model: settings.model,
        max_tokens: 64000,
        system,
        tools: opts.tools,
        // 最后一轮不再允许调用工具，让模型先给出阶段性结论
        ...(round === maxRounds - 1 ? { tool_choice: { type: 'none' as const } } : {}),
        messages: working,
        thinking: { type: 'adaptive', display: settings.showThinking ? 'summarized' : 'omitted' },
        output_config: { effort: settings.effort },
        cache_control: { type: 'ephemeral' },
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      };

      cb.onRound();
      const stream = client.beta.messages.stream(params, { signal });
      const tools = new Map<number, { id: string; chars: number }>();
      let message;
      try {
        for await (const ev of stream) {
          if (ev.type === 'content_block_start') {
            if (ev.content_block.type === 'tool_use') {
              tools.set(ev.index, { id: ev.content_block.id, chars: 0 });
              cb.onToolStart(ev.content_block.id, ev.content_block.name);
            }
          } else if (ev.type === 'content_block_delta') {
            const d = ev.delta;
            if (d.type === 'text_delta') cb.onText(d.text);
            else if (d.type === 'thinking_delta') cb.onThinking(d.thinking);
            else if (d.type === 'input_json_delta') {
              const t = tools.get(ev.index);
              if (t) {
                t.chars += d.partial_json.length;
                cb.onToolInput(t.id, t.chars);
              }
            }
          }
        }
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        // 开启流式工具参数后，残缺的 JSON 会让解析失败：只重试这一种情况
        if (err instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= 2) throw err;
        console.warn('工具参数 JSON 解析失败，重新请求本轮', err);
        continue;
      }

      for (const b of message.content) if (b.type === 'fallback') cb.onServedBy(b.to.model);

      if (message.stop_reason === 'refusal') {
        const sd = message.stop_details;
        return { history: consistent, stop: 'refused', refusal: sd?.explanation ?? sd?.category ?? undefined };
      }

      working.push({ role: 'assistant', content: message.content });

      if (message.stop_reason === 'pause_turn') continue;

      const uses = message.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
      if (uses.length === 0) return { history: working, stop: 'done' };
      if (message.stop_reason === 'max_tokens') {
        throw new Error('模型输出超过长度上限，图表参数被截断。请把需求拆小一些再试。');
      }

      const results: BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        const r = await opts.execute(u.name, u.input);
        cb.onToolResult(u.id, r.ok, r.content);
        results.push({ type: 'tool_result', tool_use_id: u.id, content: r.content, ...(r.ok ? {} : { is_error: true }) });
      }
      // 所有工具结果放进同一条 user 消息
      working.push({ role: 'user', content: results });
      consistent = [...working];
    }
    throw new Error(`工具调用超过 ${maxRounds} 轮仍未完成，已停止。可以让 Claude 缩小范围后继续。`);
  } catch (err) {
    const aborted = err instanceof Anthropic.APIUserAbortError || signal.aborted;
    throw new TurnError(aborted ? '已停止' : describeError(err), consistent, aborted);
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'API Key 无效或已过期，请在「设置」中检查。';
  if (err instanceof Anthropic.PermissionDeniedError) return '当前 Key 没有权限使用该模型（403）。';
  if (err instanceof Anthropic.NotFoundError) return '找不到该模型或接口（404），请检查模型名称与 Base URL。';
  if (err instanceof Anthropic.RateLimitError) return '请求过于频繁或额度不足（429），请稍后再试。';
  if (err instanceof Anthropic.BadRequestError) return '请求被拒绝（400）：' + apiMessage(err);
  if (err instanceof Anthropic.APIConnectionError)
    return '无法连接到 Claude API。请检查网络；如果所在地区无法直连，可在「设置」中填写可用的代理 Base URL。';
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529 || (err.status ?? 0) >= 500) return 'Claude 服务暂时繁忙，请稍后重试。';
    return `API 错误 ${err.status ?? ''}：` + apiMessage(err);
  }
  return err instanceof Error ? err.message : String(err);
}

function apiMessage(err: InstanceType<typeof Anthropic.APIError>) {
  const body = err.error as { error?: { message?: string } } | undefined;
  return body?.error?.message ?? err.message;
}

/** 设置页"测试连接"：读取模型信息，不消耗生成额度 */
export async function testConnection(s: Settings): Promise<string> {
  const client = makeClient(s);
  const m = await client.models.retrieve(s.model);
  return m.display_name ?? m.id;
}
