import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { GoogleGenAI } from "@google/genai";
import { readDb, writeDb, getAIConfig, saveAIConfig, AIConfig, ProviderSettings, deleteSkus } from "./server/db";
import fs from "fs";

dotenv.config();

// Setup Proxy if PROXY_URL is provided in .env
if (process.env.PROXY_URL) {
  try {
    const proxyUrl = process.env.PROXY_URL.trim();
    if (proxyUrl) {
      const proxyAgent = new ProxyAgent(proxyUrl);
      setGlobalDispatcher(proxyAgent);
      console.log(`[Proxy Successful] Global dispatcher set to: ${proxyUrl}`);
    }
  } catch (e) {
    console.error(`[Proxy Error] Failed to initialize ProxyAgent:`, e);
  }
}

// ── In-memory AI config cache ────────────────────────────────────────────
let cachedAIConfig: AIConfig | null = null;

async function loadAIConfigCache() {
  try {
    cachedAIConfig = await getAIConfig();
  } catch (e) {
    console.warn("[AI Config] Failed to load from DB, using env vars:", e);
  }
}

// ── Provider implementations ─────────────────────────────────────────────

async function callOpenAICompatible(
  apiKey: string,
  baseUrl: string,
  model: string,
  systemInstruction: string,
  prompt: string,
  providerName: string
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${providerName} API ${response.status}: ${errText}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${providerName} 返回空内容`);
    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callClaudeAPI(
  apiKey: string,
  model: string,
  systemInstruction: string,
  prompt: string
): Promise<string> {
  const TIMEOUT_MS = 60000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemInstruction,
        messages: [{ role: "user", content: prompt }]
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API ${response.status}: ${errText}`);
    }
    const data = await response.json();
    const content = data.content?.[0]?.text;
    if (!content) throw new Error("Claude 返回空内容");
    return content;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError' || err.message?.includes('aborted')) {
      throw new Error(`Claude API 请求超时（>${TIMEOUT_MS / 1000}秒）。请检查：① 代理是否能访问 api.anthropic.com ② .env 里的 PROXY_URL 与 TUN 模式是否冲突（开了 TUN 可将 PROXY_URL 注释掉）`);
    }
    throw err;
  }
}

async function callGeminiAPI(
  apiKey: string,
  model: string,
  systemInstruction: string,
  prompt: string
): Promise<string> {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
  });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Gemini API 响应超时（30秒）")), 30000)
  );
  const geminiCall = ai.models.generateContent({
    model: model || "gemini-2.0-flash",
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      temperature: 0.3
    }
  });
  const response = await Promise.race([geminiCall, timeoutPromise]);
  const content = response.text;
  if (!content) throw new Error("Gemini 返回空内容");
  return content;
}

function extractJSON(raw: string): string {
  let s = raw.trim();

  // Strip ```json ... ``` or ``` ... ``` fences
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (fenced) s = fenced[1].trim();

  // Try direct parse first
  try { JSON.parse(s); return s; } catch {}

  // Extract the outermost { ... } block
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const candidate = s.slice(start, end + 1);
    try { JSON.parse(candidate); return candidate; } catch {}
    // Try repairing the candidate
    const repaired = repairJSON(candidate);
    try { JSON.parse(repaired); return repaired; } catch {}
  }

  // Last resort: repair the whole string
  return repairJSON(s);
}

function repairJSON(s: string): string {
  // Walk char-by-char tracking string boundaries.
  // Fixes two common AI JSON generation issues:
  //   1. Literal newlines/tabs inside string values
  //   2. Unescaped double-quotes inside string values
  //
  // For (2) we use a lookahead heuristic: when we see " inside a string,
  // peek at the first non-whitespace char after it. If that char is a JSON
  // structural separator (, } ]) we treat this " as the closing quote;
  // otherwise we escape it as \".
  let out = '';
  let inString = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (inString) {
      if (ch === '\\') {
        // Keep existing escape sequence intact
        out += ch + (s[i + 1] ?? '');
        i += 2;
        continue;
      } else if (ch === '"') {
        // Lookahead: skip whitespace and check what follows
        let j = i + 1;
        while (j < s.length && /[\s]/.test(s[j])) j++;
        const next = s[j] ?? '';
        if (next === '' || next === ',' || next === '}' || next === ']' || next === ':') {
          // Looks like a proper closing quote
          inString = false;
          out += ch;
        } else {
          // Unescaped inner quote — escape it
          out += '\\"';
        }
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        out += '\\r';
      } else if (ch === '\t') {
        out += '\\t';
      } else {
        out += ch;
      }
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
    i++;
  }

  // Remove trailing commas before } or ]
  out = out.replace(/,(\s*[}\]])/g, '$1');

  return out;
}

async function callProvider(providerName: string, settings: ProviderSettings, systemInstruction: string, prompt: string): Promise<{ content: string; provider: string }> {
  let content: string;
  let label: string;
  switch (providerName) {
    case 'claude': {
      const model = settings.model || "claude-sonnet-4-6";
      content = await callClaudeAPI(settings.apiKey, model, systemInstruction, prompt);
      label = `Claude (${model})`;
      break;
    }
    case 'openai': {
      const baseUrl = settings.baseUrl || "https://api.openai.com/v1";
      const model = settings.model || "gpt-4o-mini";
      content = await callOpenAICompatible(settings.apiKey, baseUrl, model, systemInstruction, prompt, "OpenAI");
      label = `OpenAI (${model})`;
      break;
    }
    case 'deepseek': {
      const baseUrl = settings.baseUrl || "https://api.deepseek.com/v1";
      const model = settings.model || "deepseek-chat";
      content = await callOpenAICompatible(settings.apiKey, baseUrl, model, systemInstruction, prompt, "DeepSeek");
      label = `DeepSeek (${model})`;
      break;
    }
    case 'gemini': {
      const model = settings.model || "gemini-2.0-flash";
      content = await callGeminiAPI(settings.apiKey, model, systemInstruction, prompt);
      label = `Gemini (${model})`;
      break;
    }
    default: {
      // custom or unknown — treat as OpenAI-compatible
      const baseUrl = settings.baseUrl || "https://api.openai.com/v1";
      const model = settings.model || "gpt-4o-mini";
      content = await callOpenAICompatible(settings.apiKey, baseUrl, model, systemInstruction, prompt, providerName);
      label = `${providerName} (${model})`;
      break;
    }
  }
  return { content, provider: label };
}

async function generateAIChatCompletion(systemInstruction: string, prompt: string) {
  // 1. Use DB-configured active provider
  const cfg = cachedAIConfig;
  if (cfg?.activeProvider && cfg.providers?.[cfg.activeProvider]?.apiKey) {
    const settings = cfg.providers[cfg.activeProvider];
    try {
      return await callProvider(cfg.activeProvider, settings, systemInstruction, prompt);
    } catch (err) {
      console.warn(`[AI] Active provider (${cfg.activeProvider}) failed:`, err instanceof Error ? err.message : err);
      throw err; // don't silently fall back — surface the real error to the user
    }
  }

  // 2. Fall back to env var DeepSeek
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    try {
      const baseUrl = process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1";
      const model = process.env.DEEPSEEK_API_MODEL || "deepseek-chat";
      const content = await callOpenAICompatible(deepseekKey, baseUrl, model, systemInstruction, prompt, "DeepSeek");
      return { content, provider: "DeepSeek (.env)" };
    } catch (err) {
      console.warn("DeepSeek .env key failed, falling back to Gemini:", err);
    }
  }

  // 3. Fall back to env var Gemini
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    throw new Error("未配置任何 AI Provider。请在前台「AI 模型配置」中填写 API Key，或在 .env 中配置 DEEPSEEK_API_KEY / GEMINI_API_KEY。");
  }
  const content = await callGeminiAPI(geminiKey, "gemini-2.0-flash", systemInstruction, prompt);
  return { content, provider: "Gemini (.env)" };
}

async function startServer() {
  // Load AI config into memory cache at startup
  await loadAIConfigCache();

  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // --- AI CONFIG ENDPOINTS ---

  const maskKey = (key: string) =>
    key.length > 4 ? "••••••••" + key.slice(-4) : "••••";

  app.get("/api/ai-config", async (req, res) => {
    try {
      const cfg = cachedAIConfig || { activeProvider: undefined, providers: {} };
      const maskedProviders: Record<string, any> = {};
      for (const [name, s] of Object.entries(cfg.providers || {})) {
        maskedProviders[name] = {
          model: s.model || "",
          baseUrl: s.baseUrl || "",
          apiKeyMasked: maskKey(s.apiKey)
        };
      }
      res.json({ activeProvider: cfg.activeProvider || null, providers: maskedProviders, updatedAt: cfg.updatedAt || "" });
    } catch (error: any) {
      res.status(500).json({ error: "读取 AI 配置失败", message: error.message });
    }
  });

  // Save/update a single provider's settings
  app.post("/api/ai-config/provider", async (req, res) => {
    try {
      const { provider, apiKey, model, baseUrl } = req.body;
      if (!provider || !apiKey) return res.status(400).json({ error: "缺少 provider 或 apiKey" });
      const cfg: AIConfig = cachedAIConfig || { providers: {} };
      cfg.providers = cfg.providers || {};
      cfg.providers[provider] = { apiKey, model: model || undefined, baseUrl: baseUrl || undefined };
      if (!cfg.activeProvider) cfg.activeProvider = provider; // auto-activate first saved provider
      await saveAIConfig(cfg);
      cachedAIConfig = cfg;
      console.log(`[AI Config] Saved provider=${provider}, active=${cfg.activeProvider}`);
      res.json({ success: true, activeProvider: cfg.activeProvider });
    } catch (error: any) {
      console.error("[AI Config] Save failed:", error);
      res.status(500).json({ error: "保存失败", message: error.message });
    }
  });

  // Switch active provider
  app.post("/api/ai-config/active", async (req, res) => {
    try {
      const { provider } = req.body;
      const cfg: AIConfig = cachedAIConfig || { providers: {} };
      if (!cfg.providers?.[provider]) return res.status(400).json({ error: "该 Provider 未配置" });
      cfg.activeProvider = provider;
      await saveAIConfig(cfg);
      cachedAIConfig = cfg;
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: "切换失败", message: error.message });
    }
  });

  // Delete a provider's config
  app.delete("/api/ai-config/provider/:name", async (req, res) => {
    try {
      const name = req.params.name;
      const cfg: AIConfig = cachedAIConfig || { providers: {} };
      delete cfg.providers[name];
      if (cfg.activeProvider === name) {
        cfg.activeProvider = Object.keys(cfg.providers)[0] || undefined;
      }
      await saveAIConfig(cfg);
      cachedAIConfig = cfg;
      res.json({ success: true, activeProvider: cfg.activeProvider || null });
    } catch (error: any) {
      res.status(500).json({ error: "删除失败", message: error.message });
    }
  });

  // --- DATABASE ENDPOINTS ---

  // 1. Get all stores
  app.get("/api/stores", async (req, res) => {
    try {
      const db = await readDb();
      res.json(db.stores || []);
    } catch (error: any) {
      res.status(500).json({ error: "读取店铺数据失败", message: error.message });
    }
  });

  // 2. Save or update store
  app.post("/api/stores", async (req, res) => {
    try {
      const store = req.body;
      if (!store || !store.id) {
        return res.status(400).json({ error: "缺少店铺数据或ID" });
      }
      const db = await readDb();
      const index = db.stores.findIndex((s) => s.id === store.id);
      if (index >= 0) {
        db.stores[index] = store;
      } else {
        db.stores.push(store);
      }
      await writeDb(db);
      res.json({ success: true, store });
    } catch (error: any) {
      res.status(500).json({ error: "保存店铺数据失败", message: error.message });
    }
  });

  // 3. Delete a store and its associated SKUs
  app.delete("/api/stores/:id", async (req, res) => {
    try {
      const storeId = req.params.id;
      if (!storeId) {
        return res.status(400).json({ error: "缺少店铺ID" });
      }
      const db = await readDb();
      db.stores = db.stores.filter((s) => s.id !== storeId);
      db.skus = db.skus.filter((sku) => sku.storeId !== storeId);
      await writeDb(db);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: "删除店铺失败", message: error.message });
    }
  });

  // 4. Get SKUs (with optional storeId filtering)
  app.get("/api/skus", async (req, res) => {
    try {
      const db = await readDb();
      const { storeId } = req.query;
      if (storeId) {
        const filtered = db.skus.filter((sku) => sku.storeId === storeId);
        return res.json(filtered);
      }
      res.json(db.skus || []);
    } catch (error: any) {
      res.status(500).json({ error: "读取SKU数据失败", message: error.message });
    }
  });

  // 5. Save or update a SKU
  app.post("/api/skus", async (req, res) => {
    try {
      const skuData = req.body;
      if (!skuData || !skuData.sku || !skuData.storeId) {
        return res.status(400).json({ error: "缺少SKU数据、SKU编码或店铺ID" });
      }
      const db = await readDb();
      const index = db.skus.findIndex(
        (sku) => sku.sku === skuData.sku && sku.storeId === skuData.storeId
      );

      const dataToSave = {
        ...skuData,
        lastUpdated: new Date().toISOString()
      };
      delete dataToSave.analysisLoading;

      if (index >= 0) {
        db.skus[index] = dataToSave;
      } else {
        db.skus.push(dataToSave);
      }

      await writeDb(db);
      res.json({ success: true, sku: dataToSave });
    } catch (error: any) {
      res.status(500).json({ error: "保存SKU数据失败", message: error.message });
    }
  });

  // 6. Bulk save SKUs
  app.post("/api/skus/bulk", async (req, res) => {
    try {
      const skus = req.body;
      if (!Array.isArray(skus)) {
        return res.status(400).json({ error: "数据格式不正确，应为SKU数组" });
      }
      const db = await readDb();
      const skuMap = new Map(db.skus.map((s) => [`${s.storeId}_${s.sku}`, s]));

      skus.forEach((s) => {
        if (!s.sku || !s.storeId) return;
        const dataToSave = {
          ...s,
          lastUpdated: new Date().toISOString()
        };
        delete dataToSave.analysisLoading;
        skuMap.set(`${s.storeId}_${s.sku}`, dataToSave);
      });

      db.skus = Array.from(skuMap.values());
      await writeDb(db);
      res.json({ success: true, count: skus.length });
    } catch (error: any) {
      res.status(500).json({ error: "批量保存SKU数据失败", message: error.message });
    }
  });

  // 7b. Delete specific SKUs from a store
  app.delete("/api/skus", async (req, res) => {
    try {
      const { storeId, skus } = req.body as { storeId: string; skus: string[] };
      if (!storeId || !Array.isArray(skus) || skus.length === 0) {
        return res.status(400).json({ error: "缺少 storeId 或 skus 列表" });
      }
      const deleted = await deleteSkus(storeId, skus);
      res.json({ success: true, deleted });
    } catch (error: any) {
      res.status(500).json({ error: "删除SKU失败", message: error.message });
    }
  });

  // 7. Clear all data
  app.post("/api/clear", async (req, res) => {
    try {
      await writeDb({ stores: [], skus: [] });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: "清除数据失败", message: error.message });
    }
  });

  function compressHistory(history: any[]): { recentWeeks: any[]; compressedHistory: any | null; tokenSavingsPct: number } {
    if (!Array.isArray(history) || history.length === 0) {
      return { recentWeeks: [], compressedHistory: null, tokenSavingsPct: 0 };
    }

    const sorted = [...history];
    const recentWeeks = sorted.slice(-5);
    const olderWeeks = sorted.slice(0, -5);

    if (olderWeeks.length === 0) {
      return { recentWeeks, compressedHistory: null, tokenSavingsPct: 0 };
    }

    const count = olderWeeks.length;
    let totalSessions = 0;
    let totalOrders = 0;
    let totalSales = 0;

    olderWeeks.forEach(w => {
      const sessions = parseFloat(w.sessions) || 0;
      const orders = parseFloat(w.orders) || 0;
      const salesStr = String(w.sales || w.totalSales || "0").replace(/[^-0-9.]/g, "");
      const sales = parseFloat(salesStr) || 0;

      totalSessions += sessions;
      totalOrders += orders;
      totalSales += sales;
    });

    const avgWeeklySessions = Number((totalSessions / count).toFixed(1));
    const avgWeeklyOrders = Number((totalOrders / count).toFixed(1));
    const avgWeeklySales = Number((totalSales / count).toFixed(2));
    const avgWeeklyCVR = totalSessions > 0 ? ((totalOrders / totalSessions) * 100).toFixed(2) + "%" : "0%";

    const dateRange = count > 1 
      ? `${olderWeeks[0].date} 至 ${olderWeeks[count - 1].date}`
      : `${olderWeeks[0].date}`;

    const originalRows = history.length;
    const compressedRows = 5 + 1;
    const tokenSavingsPct = originalRows > compressedRows
      ? Math.floor((1 - compressedRows / originalRows) * 100)
      : 0;

    return {
      recentWeeks,
      compressedHistory: {
        aggregatedDateRange: dateRange,
        compressedWeeksCount: count,
        avgWeeklySessions,
        avgWeeklyOrders,
        avgWeeklySales,
        avgWeeklyCVR,
        status: "5周前的历史报告已自动汇总压缩，为您极大地节省了 Token 指数消耗并提升了 AI 响应吞吐 and 速度。"
      },
      tokenSavingsPct
    };
  }

  // AI analysis endpoint - DeepSeek with Gemini fallback
  app.post("/api/analyze", async (req, res) => {
    const { skuData } = req.body;

    if (!skuData) {
      return res.status(400).json({ error: "Missing SKU data" });
    }

    const { recentWeeks, compressedHistory, tokenSavingsPct } = compressHistory(skuData.history);

    const compactedSkuData = {
      sku: skuData.sku,
      currentStock: skuData.currentStock,
      recentWeeks5: recentWeeks,
      historicalBaselineCompared: compressedHistory,
      attribution: skuData.attribution
    };

    const recentActions: any[] = skuData.recentActions || [];
    const actionsSection = recentActions.length > 0
      ? `
      【近4周运营行动记录】
      以下是运营团队在近4周内执行的运营行动，请结合这些行动分析其对流量、转化率和销售额的实际影响：
      ${recentActions.map((a: any) =>
        `- [${a.type}] ${a.date}：${a.title}${a.details ? `（${a.details}）` : ''}`
      ).join('\n      ')}
      `
      : '';

    const prompt = `
      你是一位资深的亚马逊运营专家。请分析以下提供的 SKU 财务和流量数据。

      【特别提醒 方案一 历史数据多维压缩技术生效中】
      - "recentWeeks5" 代表最新的第 1 至 5 周的高解析核心详情数据（包含日常转化、会话 and 销量），您需以此重点辨析最新的趋势变动。
      - "historicalBaselineCompared" 代表 5 周之前的历史记录的周度聚合均值，提供了长期基础业绩水位线背景，可作为对比长期变动的底色基准。

      待分析数据:
      ${JSON.stringify(compactedSkuData, null, 2)}
      ${actionsSection}
      分析重点:
      1. 波动与多维归因 (重要): 如果在数据中发现明显趋势，请进行分析。
      2. 运营行动关联 (重要): 如有近期运营行动记录，请判断各行动是否与数据波动存在因果关联，并在 diagnosis 中点评行动效果。

      输出格式:
      {
        "summary": "一句话概括本期业绩现状及主导因素。",
        "diagnosis": "详细的核心漏斗指标波动诊断，科学引用归因分解结果并推断底层根因。如有运营行动，请评估其实际效果。请根据逻辑使用换行符 '\\n' 分割多段或分点描述，不要堆砌成一个不换行的大长段。",
        "pros": ["做得好的地方或利好因子"],
        "cons": ["面临的风险、流量漏洞或转化瓶颈"],
        "recommendations": ["具体的下一步运营行动建议（如广告调优、提价/折让、Listing精修、高时效干线补货等）"]
      }
    `;

    try {
      const { content, provider } = await generateAIChatCompletion(
        "You are a professional Amazon merchant advisor. Output ONLY a raw JSON object — no markdown, no code fences, no explanation outside the JSON. Critical rules for valid JSON: (1) Never use unescaped double-quote characters inside any string value — use Chinese punctuation「」or single quotes instead. (2) Use \\n for line breaks inside strings. (3) No trailing commas.",
        prompt
      );

      const parsed = JSON.parse(extractJSON(content));
      parsed.provider = provider;
      parsed.tokenSavingsPct = tokenSavingsPct;
      parsed.compressedWeeksCount = compressedHistory ? compressedHistory.compressedWeeksCount : 0;
      return res.json(parsed);
    } catch (apiError: any) {
      let friendlyMessage = "AI 深度分析服务暂时不可用";
      const errorStr = String(apiError);
      
      if (errorStr.includes("fetch failed") || errorStr.includes("TIMEOUT") || errorStr.includes("UND_ERR")) {
        friendlyMessage = `提示：AI 官方接口接口解析超时或网络繁忙。建议检视您的代理配置 (PROXY_URL) 或稍后刷新再试。`;
      } else if (errorStr.includes("GEMINI_API_KEY")) {
        friendlyMessage = "缺少 API 秘钥：请检查环境变量中的 GEMINI_API_KEY 是否配置。";
      } else {
        friendlyMessage = `AI 分析服务出错：${apiError.message || errorStr}`;
      }

      return res.status(500).json({ 
        error: friendlyMessage, 
        details: apiError.message || errorStr 
      });
    }
  });

  // AI scientific restocking analysis endpoint
  app.post("/api/restock-analyze", async (req, res) => {
    try {
      const { skuPerformance, targetCoverageDays: passedCoverageDays, excludeInTransit, restockMode: passedRestockMode } = req.body;

      if (!skuPerformance || !skuPerformance.sku) {
        return res.status(400).json({ error: "缺少SKU性能数据" });
      }

      const sku = skuPerformance.sku;
      const history = skuPerformance.history || [];
      const currentStock = skuPerformance.currentStock !== undefined ? skuPerformance.currentStock : 0;
      const rawMaterialStock = skuPerformance.rawMaterialStock !== undefined ? skuPerformance.rawMaterialStock : 0;
      const localStock = skuPerformance.localStock !== undefined ? skuPerformance.localStock : rawMaterialStock; // 迁移: 旧 rawMaterialStock -> 本地成品
      const inTransitStock = skuPerformance.inTransitStock !== undefined ? skuPerformance.inTransitStock : 0;
      const inTransitArriveDays = skuPerformance.inTransitArriveDays !== undefined ? Number(skuPerformance.inTransitArriveDays) : 15;
      const inTransitBatches = skuPerformance.inTransitBatches || [];
      const leadTimeDays = skuPerformance.leadTimeDays !== undefined ? skuPerformance.leadTimeDays : 30;
      const procurementLeadDays = skuPerformance.procurementLeadDays !== undefined ? skuPerformance.procurementLeadDays : leadTimeDays;
      const safetyStockDays = skuPerformance.safetyStockDays !== undefined ? skuPerformance.safetyStockDays : 15;
      const shipmentCycleDays = skuPerformance.shipmentCycleDays !== undefined ? skuPerformance.shipmentCycleDays : 30;
      const localStockCycles = skuPerformance.localStockCycles !== undefined ? skuPerformance.localStockCycles : 1;

      // Calculate total in-transit quantity
      const hasBatches = inTransitBatches && inTransitBatches.length > 0;
      const activeInTransitStock = hasBatches 
        ? inTransitBatches.reduce((sum: number, b: any) => sum + (Number(b.quantity) || 0), 0)
        : inTransitStock;

      // Ensure we resolve the active restockMode
      const restockMode = passedRestockMode || (excludeInTransit === true ? "exclude" : "simulated");

      // Mathematical calculations for baseline reference
      const totalOrders = history.reduce((sum: number, h: any) => sum + (h.orders || 0), 0);
      const totalDays = history.length * 7;
      const calculatedDailySales = totalDays > 0 ? Math.max(0.01, Number((totalOrders / totalDays).toFixed(2))) : 1;

      // Use user-defined future forecast sales velocity if given and positive
      const avgDailySales = skuPerformance.forecastedDailySales !== undefined && skuPerformance.forecastedDailySales > 0
        ? Number(skuPerformance.forecastedDailySales)
        : calculatedDailySales;

      const targetCoverageDays = passedCoverageDays || (leadTimeDays + shipmentCycleDays + safetyStockDays);
      const leadTimeDemand = Number((avgDailySales * leadTimeDays).toFixed(2));
      const safetyStock = Number((avgDailySales * safetyStockDays).toFixed(2));
      const reorderPoint = Number((leadTimeDemand + safetyStock).toFixed(2));

      // ====== 两段式库存推演 (FBA 端物理库存仿真) ======
      // 关键修复: 物理库存一旦归零就停在零, 断货流失不结转为负债, 否则后续到货会被虚假欠账抵消。
      const timelineSim: any[] = [];
      let physical = currentStock; // 仅 FBA 可售 (本地成品不直接卖, 需先发往 FBA)
      let outOfStockDayStart = -1;
      let outOfStockDayEnd = -1;
      let isOutOfStockEver = false;
      let outOfStockDaysCount = 0;
      let daysUntilFbaStockout = -1;

      const simDaysLimit = Math.max(90, targetCoverageDays);
      for (let d = 0; d <= simDaysLimit; d++) {
        if (d > 0) {
          if (physical < 0) physical = 0; // 先封底昨日结转
          physical -= avgDailySales;       // 扣当日销量
          if (hasBatches) {
            inTransitBatches.forEach((b: any) => {
              if (Number(b.arriveDays) === d) physical += Number(b.quantity) || 0;
            });
          } else if (inTransitArriveDays === d) {
            physical += inTransitStock;
          }
        }
        const currentPhysical = Math.max(0, physical);
        if (d > 0 && currentPhysical <= 0) {
          if (!isOutOfStockEver) { isOutOfStockEver = true; outOfStockDayStart = d; daysUntilFbaStockout = d; }
          outOfStockDayEnd = d;
          outOfStockDaysCount++;
        }
        timelineSim.push({ day: d, stock: Math.round(currentPhysical), safetyLine: Math.round(safetyStock) });
      }

      const physicalMinInventory = Math.min(...timelineSim.map(t => t.stock));

      const daysOfSupply = avgDailySales > 0 ? Number(((currentStock + localStock + activeInTransitStock) / avgDailySales).toFixed(1)) : 0;

      const batchesDescription = hasBatches
        ? inTransitBatches.map((b: any) => `${b.remark || '在途货件'}: ${b.quantity}件 (预计第 ${b.arriveDays} 天到仓)`).join(", ")
        : `单个在途批次: ${inTransitStock}件, 预计第 ${inTransitArriveDays} 天到仓`;

      // ===== 两个核心补货决策 (与列表/本地模型同源口径) =====
      // 决策1: 本期发往 FBA = 让 FBA 撑过(发货周期+到仓天数+安全缓冲), 受本地成品约束
      const fbaCoverDays = shipmentCycleDays + inTransitArriveDays + safetyStockDays;
      const fbaTargetUnits = avgDailySales * fbaCoverDays;
      const fbaAvailable = currentStock + activeInTransitStock;
      const fbaNeed = Math.max(0, Math.ceil(fbaTargetUnits - fbaAvailable));
      const shipToFbaQty = Math.min(fbaNeed, Math.max(0, Math.floor(localStock)));
      const shipToFbaConstrained = fbaNeed > localStock;

      // 决策2: 本期采购回仓 = 按常备周期数恢复本地水位 + 覆盖采购前置期
      const localAfterShip = localStock - shipToFbaQty;
      const localTargetUnits = avgDailySales * (localStockCycles * shipmentCycleDays + procurementLeadDays);
      const procureQty = Math.max(0, Math.ceil(localTargetUnits - localAfterShip));

      // suggestedQuantity 对外保持兼容: 以采购回仓量为准
      const suggestedQuantity = procureQty;

      const prompt = `
        您是资深亚马逊供应链规划师与物流采购专家。请根据以下提供的 SKU 历史销售数据与当前库存参数，给出极其专业、逻辑严密、多维度的备货与原材料采购分析建议。
        
        【重要特性：动态库存时间轴模拟 (Dynamic Timeline Simulation)】
        - 模拟模式：${restockMode === "simulated" ? "科学时间轴投影仿真模式 (Simulated Dynamic Projection)" : restockMode === "exclude" ? "保守排除在途模式 (Exclude In-transit)" : "常规计入在途模式 (Include In-transit)"}
        - 现有成品在库: ${currentStock} 件，现有可折成品的在库材料: ${rawMaterialStock} 件。
        - 已经出发并在途的物流总库存(去 FBA 在途): ${activeInTransitStock} 件。
        - 已经在途的多分批到仓详情：
          - ${batchesDescription}
        - 本地仓库成品库存: ${localStock} 件。
        - 日销售均速 (Average Daily Sales): ${avgDailySales.toFixed(2)} 件/日
        - 采购到可发货前置天数: ${procurementLeadDays} 天; 去 FBA 在途到仓天数: ${inTransitArriveDays} 天; 发货周期: ${shipmentCycleDays} 天; 本地常备周期数: ${localStockCycles}。
        - FBA 端逐日仿真(无新发货)结果：
          * FBA 物理库存最低降至：${physicalMinInventory.toFixed(0)} 件 
          * 是否会断货：${isOutOfStockEver ? `是。预计第 ${outOfStockDayStart} 到 ${outOfStockDayEnd} 天（共 ${outOfStockDaysCount} 天）FBA 端会卖空。` : "否。覆盖期内 FBA 端不会断货。"}
        - 两段式补货决策(系统已按统一口径算出，供你解读，不要改数字)：
          * 本期发往 FBA：${shipToFbaQty} 件${shipToFbaConstrained ? `（本地成品 ${localStock} 件不足以发满需求，需先采购）` : ""}
          * 本期采购回仓：${procureQty} 件

        请撰写一篇详尽实用的供应链报告作为 json 的 "explanation" 字段返回。请从以下方面剖析：
        1. **【FBA 端断货风险诊断】** 点评 FBA 可售 ${currentStock} 件 + 去 FBA 在途 ${activeInTransitStock} 件能撑多少天，结合到仓时点判断是否会出现断货真空期。
        2. **【本期发往 FBA 解读】** 解释为何建议发 ${shipToFbaQty} 件去 FBA（让 FBA 撑过发货周期+到仓+安全缓冲）。${shipToFbaConstrained ? "重点提示本地成品不足、需优先采购补充本地。" : ""}
        3. **【本期采购回仓解读】** 解释为何建议采购 ${procureQty} 件回本地仓库（按常备 ${localStockCycles} 个发货周期恢复水位 + 覆盖采购前置期）。
        4. **【下单排程与资金流平衡】** 采购到可发货需 ${procurementLeadDays} 天，给出最迟下单时点；并就资金占用与断货风险做简要权衡（常备周期越高资金压力越大）。
            
        务必严格以以下 JSON 形式返回结果，无需任何 code markdown 包装。explanation 字段必须是合法 JSON 字符串：不得包含未转义的双引号，换行用 \\n 表示，不得使用 markdown 格式。JSON 格式如下：
        {
          "avgDailySales": 0,
          "leadTimeDemand": 0,
          "safetyStock": 0,
          "reorderPoint": 0,
          "daysOfSupply": 0,
          "suggestedQuantity": 0,
          "shipToFbaQty": 0,
          "procureQty": 0,
          "targetCoverageDays": 0,
          "explanation": "您的详细供应链分析、多波段在途到达点评、诊断结论、交货时间差警示、以及未来的下单与加工排程建议。"
        }
      `;

      try {
        const { content, provider } = await generateAIChatCompletion(
          "You are a professional Amazon merchant advisor. Output ONLY a raw JSON object — no markdown, no code fences, no explanation outside the JSON. All string values must be valid JSON strings: escape double quotes as \\\" and use \\n for newlines.",
          prompt
        );

        const parsed = JSON.parse(extractJSON(content));
        parsed.avgDailySales = avgDailySales;
        parsed.leadTimeDemand = leadTimeDemand;
        parsed.safetyStock = safetyStock;
        parsed.reorderPoint = reorderPoint;
        parsed.daysOfSupply = daysOfSupply;
        parsed.suggestedQuantity = suggestedQuantity;
        parsed.shipToFbaQty = shipToFbaQty;
        parsed.shipToFbaConstrained = shipToFbaConstrained;
        parsed.procureQty = procureQty;
        parsed.daysUntilFbaStockout = daysUntilFbaStockout;
        parsed.targetCoverageDays = targetCoverageDays;

        parsed.analyzedAt = new Date().toISOString();
        parsed.provider = provider;
        parsed.timelineSim = timelineSim; 
        parsed.restockMode = restockMode;
        parsed.inTransitArriveDays = inTransitArriveDays;
        parsed.inTransitBatches = inTransitBatches;

        return res.json(parsed);
      } catch (apiError: any) {
        console.warn("Restock AI analysis API failed, falling back to local calculation logic:", apiError);
        
        const fallbackInTransitDescription = hasBatches
          ? `由于在途的 ${activeInTransitStock} 件细分为多批次（${inTransitBatches.map((b: any) => `${b.remark || '批次'}: ${b.quantity}件在第${b.arriveDays}天到`).join('; ')}），我们将模拟这些零散入库。`
          : `由于已出发在途的 ${inTransitStock} 件预计需要 ${inTransitArriveDays} 天后才能抵达入仓。`;

        const fallbackResult = {
          avgDailySales,
          leadTimeDemand,
          safetyStock,
          reorderPoint,
          daysOfSupply,
          suggestedQuantity,
          shipToFbaQty,
          shipToFbaConstrained,
          procureQty,
          daysUntilFbaStockout,
          targetCoverageDays,
          timelineSim,
          restockMode,
          inTransitArriveDays,
          inTransitBatches,
          explanation: `【AI 详细解析超时，已用本地两段式模型离线推算，数学口径与列表一致】\\n\\n1. 销量流速：日均约 ${avgDailySales.toFixed(2)} 件/天。\\n\\n2. FBA 端仿真：${fallbackInTransitDescription} ${isOutOfStockEver ? `🚨 预计第 ${outOfStockDayStart} 到 ${outOfStockDayEnd} 天（共 ${outOfStockDaysCount} 天）FBA 端会卖空，需尽快发货。` : "✅ 覆盖期内 FBA 端不会断货。"}\\n\\n3. 本期发往 FBA：建议发 **${shipToFbaQty} 件** 去亚马逊${shipToFbaConstrained ? `（本地成品 ${localStock} 件不足以发满，需先采购）` : ""}。\\n\\n4. 本期采购回仓：建议采购 **${procureQty} 件** 回本地仓库，按常备 ${localStockCycles} 个发货周期恢复水位。\\n\\n5. 下单时机：采购到可发货约 ${procurementLeadDays} 天，请在本地成品见底前留足前置期下单。`
        };
        return res.json(fallbackResult);
      }
    } catch (routeError: any) {
      console.error("Restock Endpoint error:", routeError);
      return res.status(500).json({ error: "服务器内部处理备货计算时出错", message: routeError.message });
    }
  });

  // Vite middleware for development
  const isProduction = process.env.NODE_ENV === "production";
  const hasDist = fs.existsSync(path.join(process.cwd(), "dist"));

  if (!isProduction || !hasDist) {
    console.log(`[Server] Starting in DEVELOPMENT mode (Vite Middleware) - NODE_ENV: ${process.env.NODE_ENV}, hasDist: ${hasDist}`);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("[Server] Starting in PRODUCTION mode (Serving static dist)");
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
