import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { describeError, testConnection } from '../ai/agent';
import { MODELS, type Effort, type Settings } from '../ai/types';
import { Modal, Seg } from './ui';

const EFFORTS: { value: Effort; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '很高' },
  { value: 'max', label: '最高' },
];

export function SettingsDialog(props: { settings: Settings; onSave(s: Settings): void; onClose(): void }) {
  const [s, setS] = useState(props.settings);
  const [reveal, setReveal] = useState(false);
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'error'; msg?: string }>({ state: 'idle' });
  const custom = !MODELS.some((m) => m.id === s.model);
  const [customMode, setCustomMode] = useState(custom);
  const up = (patch: Partial<Settings>) => setS({ ...s, ...patch });

  const runTest = async () => {
    setTest({ state: 'running' });
    try {
      const name = await testConnection(s);
      setTest({ state: 'ok', msg: `连接成功：${name}` });
    } catch (e) {
      setTest({ state: 'error', msg: describeError(e) });
    }
  };

  return (
    <Modal
      title="设置"
      onClose={props.onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              props.onSave({ ...s, apiKey: s.apiKey.trim(), baseURL: s.baseURL.trim(), model: s.model.trim() || 'claude-opus-5-5' });
              props.onClose();
            }}
          >
            保存
          </button>
        </>
      }
    >
      <div className="form settings-form">
        <div className="field">
          <label className="form-label" htmlFor="api-key">
            Claude API Key
          </label>
          <div className="key-input">
            <input
              id="api-key"
              className="input"
              type={reveal ? 'text' : 'password'}
              placeholder="sk-ant-..."
              autoComplete="off"
              spellCheck={false}
              value={s.apiKey}
              onChange={(e) => up({ apiKey: e.target.value })}
            />
            <button className="icon-btn" onClick={() => setReveal(!reveal)} aria-label={reveal ? '隐藏' : '显示'}>
              {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <div className="field-hint">
            <ShieldCheck size={13} /> Key 只保存在你这台电脑的浏览器里，请求由浏览器直接发往 Claude API。可在{' '}
            <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
              Claude 控制台
            </a>{' '}
            创建。
          </div>
        </div>

        <div className="field">
          <label className="form-label">模型</label>
          <div className="model-list">
            {MODELS.map((m) => (
              <button
                key={m.id}
                className={'model-opt' + (!customMode && s.model === m.id ? ' active' : '')}
                onClick={() => {
                  setCustomMode(false);
                  up({ model: m.id });
                }}
              >
                <span className="mo-name">{m.name}</span>
                <span className="mo-desc">{m.desc}</span>
              </button>
            ))}
            <button className={'model-opt' + (customMode ? ' active' : '')} onClick={() => setCustomMode(true)}>
              <span className="mo-name">自定义</span>
              <span className="mo-desc">填写其他模型 ID</span>
            </button>
          </div>
          {customMode && (
            <input className="input" placeholder="例如 claude-opus-5" value={s.model} onChange={(e) => up({ model: e.target.value })} spellCheck={false} />
          )}
        </div>

        <div className="field">
          <label className="form-label">思考深度（effort）</label>
          <Seg value={s.effort} options={EFFORTS} onChange={(v) => up({ effort: v })} />
          <div className="field-hint">越高越细致，但更慢、更费 token。日常画图用「中」即可，复杂架构可选「高」。</div>
        </div>

        <div className="field">
          <label className="form-label" htmlFor="base-url">
            API 地址（可选）
          </label>
          <input
            id="base-url"
            className="input"
            placeholder="默认 https://api.anthropic.com"
            value={s.baseURL}
            onChange={(e) => up({ baseURL: e.target.value })}
            spellCheck={false}
          />
          <div className="field-hint">使用自建代理或兼容网关时填写。代理需要允许浏览器跨域访问。</div>
        </div>

        <label className="form-check">
          <input type="checkbox" checked={s.showThinking} onChange={(e) => up({ showThinking: e.target.checked })} />
          显示思考过程摘要
        </label>
        <label className="form-check">
          <input type="checkbox" checked={s.fallback} onChange={(e) => up({ fallback: e.target.checked })} />
          被安全策略拒绝时自动回退到其他模型（服务端回退，使用代理不支持时请关闭）
        </label>

        <div className="test-row">
          <button className="btn btn-sm" onClick={runTest} disabled={!s.apiKey.trim() || test.state === 'running'}>
            {test.state === 'running' ? '测试中…' : '测试连接'}
          </button>
          {test.msg && (
            <span className={'status ' + (test.state === 'ok' ? 'ok' : 'err')}>
              <span className="dot" />
              {test.msg}
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}
