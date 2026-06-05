import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { GoogleGenAI } from "@google/genai";
import { readDb, writeDb } from "./server/db";
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

    const prompt = `
      你是一位资深的亚马逊运营专家。请分析以下提供的 SKU 财务和流量数据。
      
      【特别提醒 方案一 历史数据多维压缩技术生效中】
      - "recentWeeks5" 代表最新的第 1 至 5 周的高解析核心详情数据（包含日常转化、会话 and 销量），您需以此重点辨析最新的趋势变动。
      - "historicalBaselineCompared" 代表 5 周之前的历史记录的周度聚合均值，提供了长期基础业绩水位线背景，可作为对比长期变动的底色基准。
      
      待分析数据:
      ${JSON.stringify(compactedSkuData, null, 2)}
      
      分析重点:
      1. 波动与多维归因 (重要): 如果是在数据中发现明显的趋势，请进行分析。
      
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
            
        务必严格以以下 JSON 形式返回结果，无需任何 code markdown 包装，JSON 格式如下：
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
          "You are a professional Amazon merchant advisor. You must output the analysis strictly in valid JSON format matching the requested schema.",
          prompt
        );

        const parsed = JSON.parse(content);
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
