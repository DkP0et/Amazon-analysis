import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { GoogleGenAI } from "@google/genai";
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

async function generateAIChatCompletion(systemInstruction: string, prompt: string) {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    try {
      const apiBase = process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1";
      const apiModel = process.env.DEEPSEEK_API_MODEL || "deepseek-chat";
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds timeout
      
      const response = await fetch(`${apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${deepseekKey}`
        },
        body: JSON.stringify({
          model: apiModel,
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

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          return { content, provider: "DeepSeek" };
        }
      } else {
        const errText = await response.text();
        console.warn(`DeepSeek API failed with status ${response.status}: ${errText}. Falling back to Gemini...`);
      }
    } catch (err) {
      console.warn("DeepSeek API call error, falling back to Gemini:", err);
    }
  }

  // Use Gemini as the default & fallback
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    throw new Error("请在 Settings > Secrets 或 .env 中配置 GEMINI_API_KEY 以驱动 AI 分析 (DeepSeek Key 有缺)");
  }

  const ai = new GoogleGenAI({
    apiKey: geminiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  const geminiCall = ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: prompt,
    config: {
      systemInstruction: systemInstruction,
      responseMimeType: "application/json",
      temperature: 0.3
    }
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Gemini API 响应超时（15秒）")), 15000);
  });

  const response = await Promise.race([geminiCall, timeoutPromise]);

  const content = response.text;
  if (!content) {
    throw new Error("Gemini API 返回了空内容。");
  }
  return { content, provider: "Gemini" };
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

  // AI analysis endpoint - DeepSeek with Gemini fallback
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
      - **排版与换行 (极其重要)**：为了极大地增加可读性，在 "diagnosis" (详细核心诊断) 中，必须写出分段、分层次或分点的内容，并使用 "\\n" (换行符) 明确换行切分。例如：每谈到一个维度就换行并用 "1. 2. 3." 标出，让各点诊断逻辑排版错落有致，在前端完美渲染。
      
      输出格式:
      {
        "summary": "一句话概括本期业绩现状及主导因素。",
        "diagnosis": "详细的核心漏斗指标波动诊断，科学引用归因分解结果并推断底层根因。请根据逻辑使用换行符 '\\n' 分割多段或分点描述，不要堆砌成一个不换行的大长段。",
        "pros": ["做得好的地方或利好因子"],
        "cons": ["面临的风险、流量漏洞或转化瓶颈"],
        "recommendations": ["具体的下一步运营行动建议（如广告调优、提价/折让、Listing精修、高时效干线补货等）"]
      }
    `;

    try {
      const { content, provider } = await generateAIChatCompletion(
        "You are a professional Amazon merchant advisor. You must output the analysis strictly in valid JSON format matching the requested schema.",
        prompt
      );

      const parsed = JSON.parse(content);
      parsed.provider = provider;
      return res.json(parsed);
    } catch (apiError: any) {
      let friendlyMessage = "AI 深度分析服务暂时不可用";
      const errorStr = String(apiError);
      
      if (errorStr.includes("fetch failed") || errorStr.includes("TIMEOUT") || errorStr.includes("UND_ERR")) {
        friendlyMessage = `提示：AI 官方接口解析超时或网络繁忙。建议检视您的代理配置 (PROXY_URL) 或稍后刷新再试。`;
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
      const { skuPerformance, targetCoverageDays: passedCoverageDays } = req.body;

      if (!skuPerformance || !skuPerformance.sku) {
        return res.status(400).json({ error: "缺少SKU性能数据" });
      }

      const sku = skuPerformance.sku;
      const history = skuPerformance.history || [];
      const currentStock = skuPerformance.currentStock !== undefined ? skuPerformance.currentStock : 0;
      const inTransitStock = skuPerformance.inTransitStock !== undefined ? skuPerformance.inTransitStock : 0;
      const leadTimeDays = skuPerformance.leadTimeDays !== undefined ? skuPerformance.leadTimeDays : 30;
      const safetyStockDays = skuPerformance.safetyStockDays !== undefined ? skuPerformance.safetyStockDays : 15;
      const targetCoverageDays = passedCoverageDays || 60;

      // Mathematical calculations for baseline reference
      const totalOrders = history.reduce((sum: number, h: any) => sum + (h.orders || 0), 0);
      const totalDays = history.length * 7;
      
      // Calculate average daily sales in recent history
      const avgDailySales = totalDays > 0 ? Math.max(0.01, Number((totalOrders / totalDays).toFixed(2))) : 1;
      const leadTimeDemand = Number((avgDailySales * leadTimeDays).toFixed(2));
      const safetyStock = Number((avgDailySales * safetyStockDays).toFixed(2));
      const reorderPoint = Number((leadTimeDemand + safetyStock).toFixed(2));
      const daysOfSupply = avgDailySales > 0 ? Number(((currentStock + inTransitStock) / avgDailySales).toFixed(1)) : 999;
      const suggestedQuantity = Math.max(0, Math.ceil((avgDailySales * targetCoverageDays) - currentStock - inTransitStock));

      const prompt = `
        您是资深亚马逊供应链规划师与物流采购专家。请根据以下提供的 SKU 历史销售数据与当前库存参数，利用供应链管理科学（Reorder Point, Safety Stock 等），给出专业的备货分析与备货天数/数量建议。

        【商品基础数据】
        - SKU 编码: ${sku}
        - 实物现货库存 (Current Stock): ${currentStock} 件
        - 在途及入仓中库存 (In-Transit Stock): ${inTransitStock} 件
        - 规划目标可售天数 (Target Coverage Days): ${targetCoverageDays} 天

        【供应参数】
        - 采购与运输头程天数 (Lead Time): ${leadTimeDays} 天
        - 缓冲安全库存天数 (Safety Stock Days): ${safetyStockDays} 天

        【历史销售表现】
        ${JSON.stringify(history.map((h: any) => ({ date: h.date, orders: h.orders, sessions: h.sessions })), null, 2)}

        【初步拟定供应链指标】
        - 算术日均销量 (Average Daily Sales): ${avgDailySales} 件/日 (基于 ${history.length} 周历史数据)
        - 头程期需求量 (Lead Time Demand): ${leadTimeDemand} 件
        - 安全库存量 (Safety Stock): ${safetyStock} 件
        - 科学再订货点 (Reorder Point): ${reorderPoint} 件
        - 当前加上在途总存货可维持天数 (Days of Supply): ${daysOfSupply} 天
        - 基准建议补货量: ${suggestedQuantity} 件 (公式: (日均销量 * 目标可售天数) - 现货库存 - 在途库存)

        【您的专业任务】
        1. 检查或校妥以上初步指标。若历史销售有明显的上升/下降/季节性波动趋势，请适当调整并决定最终的 "avgDailySales"（即预测日销量）。
        2. 深入剖析该 SKU 的供需匹配度：目前总水位（现货+在途）是否低于再订货点？是否有断货断档风险？
        3. 运用供应链理论，给出专业的、具有落地执行价值的 "explanation" 备货决策理由（包括对当前库存的可维持天数、备货紧急程度、下一批采购的最佳下单节点、科学补货量的计算过程等）。
        4. **排版格式要求（极度重要）**：为了极大增强可读性，在 "explanation" 文字描述中，必须分层段论述，并显式运用 "\\n" (换行符) 来切分不同的分析要点和计算逻辑段落，不要叠在一起，使前端配合 whitespace-pre-wrap 完美呈现优秀排版。
        5. 输出必须是严格的合法的 JSON 格式。

        【输出 JSON 格式要求】
        {
          "avgDailySales": 最终预测日销量 (数字),
          "leadTimeDemand": 头程期需求量 (数字),
          "safetyStock": 缓冲安全库存量 (数字),
          "reorderPoint": 最终科学再订货点 (数字),
          "daysOfSupply": 当前加在途存货可售天数 (数字),
          "suggestedQuantity": 最终建议备货数量 (数字，非负整数),
          "targetCoverageDays": 目标可售天数 (数字),
          "explanation": "备货决策理由，不少于 150 字的专业中文深度逻辑解析。必须根据论述分段、分块或按分点明显含有 '\\n' 换行符以使编排美观可读。"
        }
      `;

      const { content, provider } = await generateAIChatCompletion(
        "You are a professional Amazon supply chain optimizer. You must output raw JSON strictly matching the requested schema and only return valid JSON, without any markdown formatting wrappers.",
        prompt
      );

      let parsed;
      try {
        let cleanText = content.trim();
        if (cleanText.startsWith("```")) {
          cleanText = cleanText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        }
        parsed = JSON.parse(cleanText);
      } catch (jsonErr) {
        console.error("JSON parse failed, raw content:", content);
        throw new Error("AI 返回数据格式不正确，无法解析为 JSON。");
      }

      // Safeguard returned values with realistic fallbacks
      parsed.avgDailySales = parsed.avgDailySales !== undefined ? Number(parsed.avgDailySales) : avgDailySales;
      parsed.leadTimeDemand = parsed.leadTimeDemand !== undefined ? Number(parsed.leadTimeDemand) : leadTimeDemand;
      parsed.safetyStock = parsed.safetyStock !== undefined ? Number(parsed.safetyStock) : safetyStock;
      parsed.reorderPoint = parsed.reorderPoint !== undefined ? Number(parsed.reorderPoint) : reorderPoint;
      parsed.daysOfSupply = parsed.daysOfSupply !== undefined ? Number(parsed.daysOfSupply) : daysOfSupply;
      parsed.suggestedQuantity = parsed.suggestedQuantity !== undefined ? Math.max(0, Math.round(Number(parsed.suggestedQuantity))) : suggestedQuantity;
      parsed.targetCoverageDays = parsed.targetCoverageDays !== undefined ? Number(parsed.targetCoverageDays) : targetCoverageDays;
      parsed.analyzedAt = new Date().toISOString();
      parsed.provider = provider;

      return res.json(parsed);
    } catch (deepseekError: any) {
      console.error("Restock AI analysis failed, falling back to local calculation:", deepseekError);
      
      const { skuPerformance, targetCoverageDays: passedCoverageDays } = req.body;
      const history = skuPerformance?.history || [];
      const currentStock = skuPerformance?.currentStock !== undefined ? skuPerformance.currentStock : 0;
      const inTransitStock = skuPerformance?.inTransitStock !== undefined ? skuPerformance.inTransitStock : 0;
      const leadTimeDays = skuPerformance?.leadTimeDays !== undefined ? skuPerformance.leadTimeDays : 30;
      const safetyStockDays = skuPerformance?.safetyStockDays !== undefined ? skuPerformance.safetyStockDays : 15;
      const targetCoverageDays = passedCoverageDays || 60;

      const totalOrders = history.reduce((sum: number, h: any) => sum + (h.orders || 0), 0);
      const totalDays = history.length * 7;
      const avgDailySales = totalDays > 0 ? Math.max(0.01, Number((totalOrders / totalDays).toFixed(2))) : 1;
      const leadTimeDemand = Number((avgDailySales * leadTimeDays).toFixed(2));
      const safetyStock = Number((avgDailySales * safetyStockDays).toFixed(2));
      const reorderPoint = Number((leadTimeDemand + safetyStock).toFixed(2));
      const daysOfSupply = avgDailySales > 0 ? Number(((currentStock + inTransitStock) / avgDailySales).toFixed(1)) : 999;
      const suggestedQuantity = Math.max(0, Math.ceil((avgDailySales * targetCoverageDays) - currentStock - inTransitStock));

      const fallbackResult = {
        avgDailySales,
        leadTimeDemand,
        safetyStock,
        reorderPoint,
        daysOfSupply,
        suggestedQuantity,
        targetCoverageDays,
        explanation: `[AI 线路繁忙，系统已自动转换为本地供应链物理逻辑计算] 

科学备货详情诊断报告：
1. 【日周转速度】：该 SKU 历史累计销量为 ${totalOrders} 件，科学折算日均销量（Average Daily Sales）为 ${avgDailySales.toFixed(2)} 件/天。
2. 【头程期消耗】：当前配置采购与派送头程 (Lead Time) 天数为 ${leadTimeDays} 天，对应整个运输期的必需库存周转量为 ${leadTimeDemand} 件。
3. 【安全容错层】：设置了 ${safetyStockDays} 天安全天数备份（用于对冲船期延误、厂家排产延迟等异常），安全备用基水位为 ${safetyStock} 件。
4. 【再订货触发点（ROP）】：科学核定再订货点为 ${reorderPoint} 件。当前“现货 + 在途总库存” ${currentStock + inTransitStock} 件，若该总和已低于其再订货点，代表随时有缺货断档之虞，需要立即下单！
5. 【存量维持周期】：实物现货 ${currentStock} 件，加上在途在运 ${inTransitStock} 件，总库存水位为 ${currentStock + inTransitStock} 件，以当前的平均订单流速，可维持约 ${daysOfSupply} 天。
6. 【精准建议采购量】：针对设定的采购目标期天数 ${targetCoverageDays} 天，除去现有存量基础外，本批次的最适科学建议订货量为 ${suggestedQuantity} 件，协助您在平滑周转、杜绝断货的前提下，竭力降低长期仓配周转费用与积压风险。`,
        analyzedAt: new Date().toISOString()
      };

      return res.json(fallbackResult);
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
