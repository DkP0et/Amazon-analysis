import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { readDb, writeDb } from "./server/db";

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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

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

  // 7. Clear all data
  app.post("/api/clear", async (req, res) => {
    try {
      await writeDb({ stores: [], skus: [] });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: "清除数据失败", message: error.message });
    }
  });

  // AI analysis endpoint - Pure DeepSeek
  app.post("/api/analyze", async (req, res) => {
    const { skuData } = req.body;

    if (!skuData) {
      return res.status(400).json({ error: "Missing SKU data" });
    }

    const prompt = `
      你是一位资深的亚马逊运营专家。请通过以下提供的 SKU 数据（包含日期、会话数、订单量、转化率、销售额）及相关计算进行深度分析。
      
      待分析数据:
      ${JSON.stringify(skuData, null, 2)}
      
      分析重点:
      1. 波动与多维归因 (重要): 
         如果在数据中提供了 "attribution" (归因分解数)，请密切关注这些数学拆解结果。
         - "sessionsEffect" 代表销量/流量变动的业绩贡献额。
         - "cvrEffect" 代表页面转化率提升/下滑的业绩贡献额。
         - "aovEffect" 代表客单价变动的业绩贡献额。
         - "totalEffect" 代表总销售额变动。
         请在 "diagnosis" 里直接、科学地结合这些贡献金额进行多维归因推断，向运营人员道破主要拖累项或增长推动项。
      2. 漏斗漏洞诊断: 审视 Sessions -> Orders 的漏斗层级。分析广告流失、 Listing 跳失、或备货脱节可能引发的问题。
      3. 行动建议: 提供 3 条具体、可执行的改进步骤（需紧密对应诊断出的归因主因）。
      
      输出要求:
      - 结果必须 be 合法的 JSON 对象。
      - 语言风格：资深、克制、直切要害、不拖泥带水。不要吹牛、不要自我表扬。
      
      输出格式:
      {
        "summary": "一句话概括本期业绩现状及主导因素。",
        "diagnosis": "详细的核心漏斗指标波动诊断，科学引用归因分解结果并推断底层根因。",
        "pros": ["做得好的地方或利好因子"],
        "cons": ["面临的风险、流量漏洞或转化瓶颈"],
        "recommendations": ["具体的下一步运营行动建议（如广告调优、提价/折让、Listing精修、高时效干线补货等）"]
      }
    `;

    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        throw new Error("请在 .env 文件中配置 DEEPSEEK_API_KEY。");
      }

      const apiBase = process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1";
      const apiModel = process.env.DEEPSEEK_API_MODEL || "deepseek-chat";

      const response = await fetch(`${apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: apiModel,
          messages: [
            {
              role: "system",
              content: "You are a professional Amazon merchant advisor. You must output the analysis strictly in valid JSON format matching the requested schema."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          response_format: {
            type: "json_object"
          },
          temperature: 0.2
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek 接口返回错误 (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error("DeepSeek API 未返回任何文本内容。");
      }

      const parsed = JSON.parse(content);
      parsed.provider = "DeepSeek";
      return res.json(parsed);
    } catch (deepseekError: any) {
      let friendlyMessage = "DeepSeek AI 分析请求失败";
      const errorStr = String(deepseekError);
      
      if (errorStr.includes("fetch failed") || errorStr.includes("TIMEOUT") || errorStr.includes("UND_ERR") || errorStr.includes("503") || errorStr.includes("busy")) {
        friendlyMessage = `提示：DeepSeek 官方接口当前极其繁忙 (返回 503 错误/服务器过载)。
建议您：
1. 避开高峰期，稍候几分钟再尝试点击“AI 分析”；
2. 检查您的网络与终端代理配置（如已配置 PROXY_URL）。`;
      } else if (errorStr.includes("401") || errorStr.includes("API key")) {
        friendlyMessage = "API Key 无效：请检查 .env 中配置的 DEEPSEEK_API_KEY 是否正确。";
      } else if (errorStr.includes("JSON")) {
        friendlyMessage = "解析 AI 返回数据失败，请重试。";
      } else {
        friendlyMessage = `AI 分析出错：${deepseekError.message || errorStr}`;
      }

      return res.status(500).json({ 
        error: friendlyMessage, 
        details: deepseekError.message || errorStr 
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
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
