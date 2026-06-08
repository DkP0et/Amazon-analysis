import React, { useState, useEffect } from "react";
import { XCircle, Bot, CheckCircle2, AlertTriangle, Eye, EyeOff, Plus, Trash2, Zap } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { AIProvider } from "../../types";
import { cn } from "../../lib/utils";

interface ProviderInfo {
  model: string;
  baseUrl: string;
  apiKeyMasked: string;
}

interface ConfigStatus {
  activeProvider: AIProvider | null;
  providers: Partial<Record<AIProvider, ProviderInfo>>;
  updatedAt: string;
}

interface Props {
  onClose: () => void;
}

const PROVIDER_META: Record<AIProvider, { label: string; description: string; defaultModel: string; needsBaseUrl: boolean; modelPlaceholder: string; defaultBaseUrl?: string }> = {
  claude: {
    label: 'Claude (Anthropic)',
    description: '高质量推理，适合复杂分析',
    defaultModel: 'claude-sonnet-4-6',
    needsBaseUrl: false,
    modelPlaceholder: 'claude-sonnet-4-6 / claude-opus-4-8 / claude-haiku-4-5-20251001'
  },
  deepseek: {
    label: 'DeepSeek',
    description: '中文理解强，性价比高',
    defaultModel: 'deepseek-chat',
    needsBaseUrl: true,
    modelPlaceholder: 'deepseek-chat / deepseek-reasoner',
    defaultBaseUrl: 'https://api.deepseek.com/v1'
  },
  gemini: {
    label: 'Gemini (Google)',
    description: '谷歌大模型，多模态',
    defaultModel: 'gemini-2.0-flash',
    needsBaseUrl: false,
    modelPlaceholder: 'gemini-2.0-flash / gemini-2.5-pro'
  },
  openai: {
    label: 'OpenAI (GPT)',
    description: 'GPT 系列模型',
    defaultModel: 'gpt-4o-mini',
    needsBaseUrl: false,
    modelPlaceholder: 'gpt-4o-mini / gpt-4o / o4-mini'
  },
  custom: {
    label: '自定义 (OpenAI 兼容)',
    description: '任意兼容 OpenAI 格式的接口',
    defaultModel: '',
    needsBaseUrl: true,
    modelPlaceholder: '填写对应模型名称'
  }
};

const ALL_PROVIDERS = Object.keys(PROVIDER_META) as AIProvider[];

export function AISettingsModal({ onClose }: Props) {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Add-form state
  const [addingProvider, setAddingProvider] = useState<AIProvider | null>(null);
  const [formApiKey, setFormApiKey] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const loadStatus = async () => {
    try {
      const data: ConfigStatus = await fetch('/api/ai-config').then(r => r.json());
      setStatus(data);
    } catch {
      setStatus({ activeProvider: null, providers: {}, updatedAt: '' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, []);

  const openAddForm = (p: AIProvider) => {
    const meta = PROVIDER_META[p];
    setAddingProvider(p);
    setFormApiKey('');
    setFormModel(meta.defaultModel);
    setFormBaseUrl(meta.defaultBaseUrl || '');
    setShowKey(false);
    setFeedback(null);
  };

  const handleSave = async () => {
    if (!addingProvider || !formApiKey.trim()) {
      setFeedback({ type: 'err', msg: '请填写 API Key' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const resp = await fetch('/api/ai-config/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: addingProvider,
          apiKey: formApiKey.trim(),
          model: formModel.trim() || PROVIDER_META[addingProvider].defaultModel || undefined,
          baseUrl: formBaseUrl.trim() || undefined
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || data.error);
      setFeedback({ type: 'ok', msg: '保存成功！' });
      setAddingProvider(null);
      await loadStatus();
    } catch (e: any) {
      setFeedback({ type: 'err', msg: e.message || '未知错误' });
    } finally {
      setSaving(false);
    }
  };

  const handleSetActive = async (p: AIProvider) => {
    try {
      await fetch('/api/ai-config/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: p })
      });
      await loadStatus();
    } catch (e: any) {
      setFeedback({ type: 'err', msg: '切换失败：' + e.message });
    }
  };

  const handleDelete = async (p: AIProvider) => {
    if (!window.confirm(`确认删除 ${PROVIDER_META[p].label} 的配置？`)) return;
    await fetch(`/api/ai-config/provider/${p}`, { method: 'DELETE' });
    await loadStatus();
  };

  const configuredProviders = status ? (Object.keys(status.providers) as AIProvider[]) : [];
  const unconfiguredProviders = ALL_PROVIDERS.filter(p => !configuredProviders.includes(p));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />

      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center">
              <Bot size={18} className="text-white" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-900">AI 模型配置</h3>
              <p className="text-[11px] text-slate-400">配置多个 Provider，随时一键切换</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <XCircle size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading && (
            <div className="text-center py-8 text-slate-400 text-sm">加载中...</div>
          )}

          {/* Configured providers */}
          {!loading && configuredProviders.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">已配置的 Provider</p>
              {configuredProviders.map(p => {
                const meta = PROVIDER_META[p];
                const info = status!.providers[p]!;
                const isActive = status!.activeProvider === p;
                return (
                  <div key={p} className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl border transition-all",
                    isActive ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"
                  )}>
                    <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", isActive ? "bg-indigo-600" : "bg-slate-300")} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-sm text-slate-900">{meta.label}</p>
                        {isActive && (
                          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded-full">当前激活</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono truncate max-w-[200px]">
                        {info.apiKeyMasked}{info.model ? ` · ${info.model}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!isActive && (
                        <button
                          onClick={() => handleSetActive(p)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors"
                        >
                          <Zap size={11} /> 激活
                        </button>
                      )}
                      <button
                        onClick={() => openAddForm(p)}
                        className="px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                      >
                        更新
                      </button>
                      <button
                        onClick={() => handleDelete(p)}
                        className="p-1.5 text-rose-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add new provider */}
          {!loading && unconfiguredProviders.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">添加 Provider</p>
              <div className="grid grid-cols-1 gap-2">
                {unconfiguredProviders.map(p => (
                  <button key={p}
                    onClick={() => openAddForm(p)}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 text-left transition-all group"
                  >
                    <Plus size={14} className="text-slate-300 group-hover:text-indigo-400 shrink-0" />
                    <div>
                      <p className="font-semibold text-sm text-slate-700 group-hover:text-indigo-700">{PROVIDER_META[p].label}</p>
                      <p className="text-[11px] text-slate-400">{PROVIDER_META[p].description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Add/Edit form */}
          <AnimatePresence>
            {addingProvider && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                className="space-y-4 p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-sm text-slate-800">
                    {configuredProviders.includes(addingProvider) ? '更新' : '配置'} {PROVIDER_META[addingProvider].label}
                  </p>
                  <button onClick={() => setAddingProvider(null)} className="text-slate-400 hover:text-slate-600">
                    <XCircle size={16} />
                  </button>
                </div>

                {/* API Key */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">API Key</label>
                  <div className="relative">
                    <input
                      type={showKey ? "text" : "password"}
                      value={formApiKey}
                      onChange={e => setFormApiKey(e.target.value)}
                      placeholder={configuredProviders.includes(addingProvider) ? "输入新 Key 以替换..." : "粘贴 API Key..."}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                      autoFocus
                    />
                    <button type="button" onClick={() => setShowKey(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                {/* Model */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    模型 <span className="text-slate-300 font-normal normal-case">(留空用默认)</span>
                  </label>
                  <input type="text" value={formModel} onChange={e => setFormModel(e.target.value)}
                    placeholder={PROVIDER_META[addingProvider].modelPlaceholder}
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>

                {/* Base URL */}
                {PROVIDER_META[addingProvider].needsBaseUrl && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      Base URL <span className="text-slate-300 font-normal normal-case">(可选)</span>
                    </label>
                    <input type="text" value={formBaseUrl} onChange={e => setFormBaseUrl(e.target.value)}
                      placeholder={PROVIDER_META[addingProvider].defaultBaseUrl || 'https://your-api/v1'}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none" />
                  </div>
                )}

                {feedback && (
                  <div className={cn("flex items-center gap-2 p-2.5 rounded-xl text-xs font-medium",
                    feedback.type === 'ok' ? "bg-emerald-50 border border-emerald-100 text-emerald-700" : "bg-rose-50 border border-rose-100 text-rose-700")}>
                    {feedback.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    {feedback.msg}
                  </div>
                )}

                <div className="flex gap-2">
                  <button onClick={() => setAddingProvider(null)}
                    className="flex-1 px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl text-sm font-bold transition-all">
                    取消
                  </button>
                  <button onClick={handleSave} disabled={saving || !formApiKey.trim()}
                    className={cn("flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-all",
                      saving || !formApiKey.trim()
                        ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                        : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-100 active:scale-95")}>
                    {saving ? "保存中..." : "保存"}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Network hint for Claude */}
          {status?.activeProvider === 'claude' && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
              <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 leading-relaxed">
                Claude API (<code className="font-mono">api.anthropic.com</code>) 在中国大陆需要代理。
                请确保 <code className="font-mono">.env</code> 里的 <code className="font-mono">PROXY_URL</code> 已配置并能访问该域名。
              </p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 shrink-0">
          <button onClick={onClose}
            className="w-full px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-sm font-bold transition-all">
            关闭
          </button>
        </div>
      </motion.div>
    </div>
  );
}
