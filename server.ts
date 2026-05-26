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
        status: "5周前的历史报告已自动汇总压缩，为您极大地节省了 Token 指数消耗并提升了 AI 响应吞吐和速度。"
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
      const inTransitStock = skuPerformance.inTransitStock !== undefined ? skuPerformance.inTransitStock : 0;
      const inTransitArriveDays = skuPerformance.inTransitArriveDays !== undefined ? Number(skuPerformance.inTransitArriveDays) : 15;
      const leadTimeDays = skuPerformance.leadTimeDays !== undefined ? skuPerformance.leadTimeDays : 30;
      const safetyStockDays = skuPerformance.safetyStockDays !== undefined ? skuPerformance.safetyStockDays : 15;
      const shipmentCycleDays = skuPerformance.shipmentCycleDays !== undefined ? skuPerformance.shipmentCycleDays : 30;

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
      const shipmentCycleDemand = Number((avgDailySales * shipmentCycleDays).toFixed(2));
      const reorderPoint = Number((leadTimeDemand + safetyStock).toFixed(2));

      // ====== 科学库存推演模拟算法 ======
      const timelineSim = [];
      let currentSim = currentStock + rawMaterialStock;
      let minInventory = currentSim; // 最低在库结存极值
      let outOfStockDayStart = -1;   // 开始断货天
      let outOfStockDayEnd = -1;     // 结束断货天
      let isOutOfStockEver = false;
      let outOfStockDaysCount = 0;   // 累计断货天数

      // 模拟未来 Math.max(90, targetCoverageDays) 天
      const simDaysLimit = Math.max(90, targetCoverageDays);
      for (let d = 0; d <= simDaysLimit; d++) {
        if (d > 0) {
          currentSim -= avgDailySales;
          // 到达第 Y 天，在途到达
          if (d === inTransitArriveDays) {
            currentSim += inTransitStock;
          }
        }
        
        const roundedStock = Math.round(currentSim);
        timelineSim.push({
          day: d,
          stock: roundedStock,
          safetyLine: Math.round(safetyStock),
        });

        if (d > 0) {
          if (currentSim < 0) {
            outOfStockDaysCount++;
            if (!isOutOfStockEver) {
              outOfStockDayStart = d;
              isOutOfStockEver = true;
            }
            outOfStockDayEnd = d;
          }
          // 在覆盖度限制内，跟踪极小值
          if (d <= targetCoverageDays) {
            if (currentSim < minInventory) {
              minInventory = currentSim;
            }
          }
        }
      }

      // Calculate suggested replenish quantity based on mode
      let suggestedQuantity = 0;
      if (restockMode === "exclude") {
        const existingTotal = currentStock + rawMaterialStock;
        suggestedQuantity = Math.max(0, Math.ceil((avgDailySales * targetCoverageDays) - existingTotal));
      } else if (restockMode === "include") {
        const existingTotal = currentStock + rawMaterialStock + inTransitStock;
        suggestedQuantity = Math.max(0, Math.ceil((avgDailySales * targetCoverageDays) - existingTotal));
      } else {
        // "simulated" 时间轴投射模式：使覆盖期内最低极值minInventory维持在安全库存safetyStock水位
        suggestedQuantity = Math.max(0, Math.ceil(safetyStock - minInventory));
      }

      // Effective in-transit stock display
      const effectiveInTransit = restockMode === "exclude" ? 0 : inTransitStock;
      const existingTotalSelected = currentStock + rawMaterialStock + effectiveInTransit;
      const daysOfSupply = avgDailySales > 0 ? Number((existingTotalSelected / avgDailySales).toFixed(1)) : 999;

      const prompt = `
        您是资深亚马逊供应链规划师与物流采购专家。请根据以下提供的 SKU 历史销售数据与当前库存参数，结合用户本案例下的特定流程（提前采购材料分装打包回仓库、按月合并统计发货），给出专业的备货与原材料采购分析建议。
        
        【重要特性：防刻舟求剑的“库存动态时间轴模拟”已激活】
        - 模拟模式：${restockMode === "simulated" ? "科学时间轴投影耗竭模拟 (Simulated Projection)" : restockMode === "exclude" ? "保守排除在途模式 (Exclude In-transit)" : "常规计入在途模式 (Include In-transit)"}
        - 我们不再认为“在途库存是瞬间落袋或完全不来”的静态数值。系统已经连续每日仿真模拟了未来 90 天内的库存流向！
        - 现有成品在库: ${currentStock} 件，现有可折成品的在库材料: ${rawMaterialStock} 件。
        - 已发出在途库存: ${inTransitStock} 件，预计在第 ${inTransitArriveDays} 天到达并上架亚马逊。
        - 日销售速度：${avgDailySales.toFixed(2)} 件/日
        - 采购在仓分装周期（Lead Time）: ${leadTimeDays} 天。即今天拍板采购的备份，理应在 ${leadTimeDays} 天内打包分装完毕并出货。
        - 在途到仓天数：${inTransitArriveDays} 天（在这 ${inTransitArriveDays} 天里，库存靠当前在库支撑）。
        - 整个模拟中，若没有任何新发采购：
          * 极低点可用库存为：${minInventory.toFixed(1)} 件 ${minInventory < 0 ? "(出现负值，代表在途尚未到仓或在途到仓也补不齐前期的断货漏洞！)" : ""}
          * 期间是否会发生断货：${isOutOfStockEver ? `是的，预计将在未来第 ${outOfStockDayStart} 天到第 ${outOfStockDayEnd} 天（共 ${outOfStockDaysCount} 天）发生断货真空期。` : "否，可用库存可全段平移覆盖。"}
        - 目标总安全备备足天数: ${targetCoverageDays} 天
        - 根据您选择的模式：本次建议最科学的原材料采购量为: ${suggestedQuantity} 件（本数值已由时间流精密结存推算得出）。

        【历史销售表现】
        ${JSON.stringify(history.map((h: any) => ({ date: h.date, orders: h.orders, sessions: h.sessions })), null, 2)}

        【供应链核心指标结果】
        - 材料配送打包期需求 (LTD): ${leadTimeDemand} 件
        - 安全库存水位 (SS): ${safetyStock} 件
        - 再订货触发点 (ROP): ${reorderPoint} 件
        - 当前可用维持周期: ${daysOfSupply} 天
        - 建议本次采购备货数: ${suggestedQuantity} 件

        【您的专业分析任务】
        1. 深入剖析该 SKU 在这种“时间轴动态模拟（在途货物在第 ${inTransitArriveDays} 天才能解渴、在此之前需依靠当前在库、今天买新耗需要 ${leadTimeDays} 天前置期）”下的动态周转安全。
        2. 特别针对“预计在第 ${inTransitArriveDays} 天在途库到达前，在库成品和材料是否足够，以及是否会产生临时脱销真空期”进行针对性剖析！点出在途虽好但“远水不解近渴”的时间脱节点，若有断货真空期则提出紧急在分拣分装上加速或启用快船的指导。
        3. 自适应输出采购排程指导：即在多长天数内必须完成在仓分装，或者应该在哪天之前提前买好下一批货，以使未来的库存安全可控。
        4. 务必严格以以下 JSON 形式返回结果，无需任何 code markdown 包装，JSON 格式如下：
        {
          "avgDailySales": 0,
          "leadTimeDemand": 0,
          "safetyStock": 0,
          "reorderPoint": 0,
          "daysOfSupply": 0,
          "suggestedQuantity": 0,
          "targetCoverageDays": 0,
          "explanation": "您的详细供应链分析、诊断结论、时间错差警示、以及未来的下单与加工排程建议。"
        }
      `;

      try {
        const { content, provider } = await generateAIChatCompletion(
          "You are a professional Amazon merchant advisor. You must output the analysis strictly in valid JSON format matching the requested schema.",
          prompt
        );

        const parsed = JSON.parse(content);
        parsed.targetCoverageDays = parsed.targetCoverageDays !== undefined ? Number(parsed.targetCoverageDays) : targetCoverageDays;
        parsed.analyzedAt = new Date().toISOString();
        parsed.provider = provider;
        parsed.timelineSim = timelineSim; // 传回时间轴供前端折线绘制
        parsed.restockMode = restockMode;
        parsed.inTransitArriveDays = inTransitArriveDays;

        return res.json(parsed);
      } catch (apiError: any) {
        console.warn("Restock AI analysis API failed, falling back to local calculation logic:", apiError);
        const fallbackResult = {
          avgDailySales,
          leadTimeDemand,
          safetyStock,
          reorderPoint,
          daysOfSupply,
          suggestedQuantity,
          targetCoverageDays,
          timelineSim,
          restockMode,
          inTransitArriveDays,
          explanation: `[AI 模块由于网络瞬时繁忙，系统已无缝启动本地一流水准的时间轴动态物理数学运算模型]

【科学库存与在途动态仿真报告】

1. 【销量流速监测】：该 SKU 精算日均销量达 ${avgDailySales.toFixed(2)} 件/日。
2. 【时间流耗察】：当前在库成品+可拆材料折合共 ${(currentStock + rawMaterialStock)} 件。由于已出发在途的 ${inTransitStock} 件预计需要 ${inTransitArriveDays} 天后才能抵达入仓。
   ${isOutOfStockEver 
     ? `🚨 【断货真空期红色警讯】：由于现有在库仅够维持 ${Math.floor((currentStock + rawMaterialStock) / (avgDailySales || 1))} 天，而在途大货要在 ${inTransitArriveDays} 天后才到，因此预计在“未来第 ${outOfStockDayStart} 天至第 ${outOfStockDayEnd} 天（共 ${outOfStockDaysCount} 天）”期间将出现严重的临时缺货断档断崖！这是传统的‘直接计入在途合并计算’根本无法发现的时间差盲点！`
     : `🟢 【供应链在库无缝覆盖】：现有在库实物足以支撑 ${(currentStock + rawMaterialStock) / (avgDailySales || 1)} 天销售，能够安全顶到第 ${inTransitArriveDays} 天在途货物到仓上架，前置周期完全闭合，无任何断货风险！`
   }
3. 【最精准补货（备原料）计划】：
   - 选择模式：${restockMode === "simulated" ? "科学时间轴投影仿真（极力避开断货点）" : restockMode === "exclude" ? "保守排除在途模式" : "静态包含在途模式"}
   - 为了确保在您期望的 ${targetCoverageDays} 天良性周转覆盖期内，哪怕在途大货可能存在时间错开，也绝不掉入在库警戒线（保障最低库存不低于安全基数 ${safetyStock.toFixed(0)} 件），本批次最佳精密订货/备好原料建议量为：${suggestedQuantity} 件。
4. 【订单与排产排程指导】：
   - 采购加分装共需 ${leadTimeDays} 天。考虑到您的当前可用断库缓冲，建议最迟应在 ${Math.max(1, Math.floor(daysOfSupply - leadTimeDays))} 天内下单采购原材料并启动入库加工，以对冲头程 and 原料交期的耗时！`,
          analyzedAt: new Date().toISOString()
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
