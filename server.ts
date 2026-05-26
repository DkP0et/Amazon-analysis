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
      const inTransitBatches = skuPerformance.inTransitBatches || [];
      const leadTimeDays = skuPerformance.leadTimeDays !== undefined ? skuPerformance.leadTimeDays : 30;
      const safetyStockDays = skuPerformance.safetyStockDays !== undefined ? skuPerformance.safetyStockDays : 15;
      const shipmentCycleDays = skuPerformance.shipmentCycleDays !== undefined ? skuPerformance.shipmentCycleDays : 30;

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
          
          // Apply shipments arriving on day d
          if (hasBatches) {
            inTransitBatches.forEach((batch: any) => {
              if (Number(batch.arriveDays) === d) {
                currentSim += (Number(batch.quantity) || 0);
              }
            });
          } else {
            // 到达第 Y 天，单批次在途到达
            if (d === inTransitArriveDays) {
              currentSim += inTransitStock;
            }
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
          // 在库结存最低点记录
          minInventory = Math.min(minInventory, currentSim);
        }
      }

      let suggestedQuantity = 0;
      if (restockMode === "exclude") {
        const existingTotal = currentStock + rawMaterialStock;
        suggestedQuantity = Math.max(0, Math.ceil((avgDailySales * targetCoverageDays) - existingTotal));
      } else if (restockMode === "include") {
        const existingTotal = currentStock + rawMaterialStock + activeInTransitStock;
        suggestedQuantity = Math.max(0, Math.ceil((avgDailySales * targetCoverageDays) - existingTotal));
      } else {
        // "simulated" 时间轴投射模式：使覆盖期内最低极值minInventory维持在安全库存safetyStock水位
        suggestedQuantity = Math.max(0, Math.ceil(safetyStock - minInventory));
      }

      // Effective in-transit stock display
      const effectiveInTransit = restockMode === "exclude" ? 0 : activeInTransitStock;
      const existingTotalSelected = currentStock + rawMaterialStock + effectiveInTransit;
      const daysOfSupply = avgDailySales > 0 ? Number((existingTotalSelected / avgDailySales).toFixed(1)) : 999;

      const batchesDescription = hasBatches 
        ? inTransitBatches.map((b: any, index: number) => `批次 ${index + 1}: ${b.remark || '未命名'} (${b.quantity}件，预计在未来第 ${b.arriveDays} 天到达上架)`).join("\n        - ")
        : `无多分批 (传统单批次: ${inTransitStock} 件，预计在第 ${inTransitArriveDays} 天到仓。)`;

      const prompt = `
        您是资深亚马逊供应链规划师与物流采购专家。请根据以下提供的 SKU 历史销售数据与当前库存参数，结合用户本案例下的特定流程（提前采购材料分装打包回仓库、按月合并统计发货），给出专业的备货与原材料采购分析建议。
        
        【重要特性：防刻舟求剑的“库存动态时间轴模拟”已激活】
        - 模拟模式：${restockMode === "simulated" ? "科学时间轴投影仿真模式 (Simulated Dynamic Projection)" : restockMode === "exclude" ? "保守排除在途模式 (Exclude In-transit)" : "常规计入在途模式 (Include In-transit)"}
        - 我们不再认为“在途库存是瞬间落袋或合并在单一日期到达”的静态数值。系统已经连续每日仿真模拟了未来 90 天内、甚至是多批次细分成品在不同天数到达并入上架的库存流向！
        - 现有成品在库: ${currentStock} 件，现有可折成品的在库材料: ${rawMaterialStock} 件。
        - 已经在途总库存: ${activeInTransitStock} 件。
        - 已经分批在途到仓详情：
        - ${batchesDescription}
        - 日销售速度：${avgDailySales.toFixed(2)} 件/日
        - 采购在仓分装周期（Lead Time）: ${leadTimeDays} 天。即今天拍板采购的备份，理应在 ${leadTimeDays} 天内打包分装完毕并出货。
        - 整个模拟中，若没有任何新发采购：
          * 极低点可用库存为：${minInventory.toFixed(1)} 件 ${minInventory < 0 ? "(出现负值，代表现有在库根本顶不住后续各批次在途货，或是各批次在途到达也补不齐前期的连续断货真空漏洞！)" : ""}
          * 期间是否会发生断货：${isOutOfStockEver ? `是的，预计将在未来第 ${outOfStockDayStart} 天到第 ${outOfStockDayEnd} 天（共 ${outOfStockDaysCount} 天）发生断货真空期。` : "否，可用库存可全段平移覆盖。"}
        - 目标总安全备备足天数: ${targetCoverageDays} 天
        - 根据您选择的模式：本次建议最科学的原材料采购量为: ${suggestedQuantity} 件（本数值已由多波段时间流精密结存推算得出）。

        【历史销售表现】
        ${JSON.stringify(history.map((h: any) => ({ date: h.date, orders: h.orders, sessions: h.sessions })), null, 2)}

        【供应链核心指标结果】
        - 材料配送打包期需求 (LTD): ${leadTimeDemand} 件
        - 安全库存水位 (SS): ${safetyStock} 件
        - 再订货触发点 (ROP): ${reorderPoint} 件
        - 当前可用维持周期: ${daysOfSupply} 天
        - 建议本次采购备货数: ${suggestedQuantity} 件

        【您的专业分析任务】
        1. 深入剖析该 SKU 在这种“时间轴动态模拟（在途大货分为多批陆续到达，可能前期库存由于销量流速大面临中断、今天分装加工需要 ${leadTimeDays} 天前置期）”下的动态周转安全。
        2. 特别针对“由于多批次在途到货时间间隔很大，在各批次到达入仓前，现有在库成品和材料是否足够支撑，以及是否会产生临时脱销真空期”进行针对性的双向交叉剖析！点出在途虽好但“远水不解近渴”的时间脱节点。如果存在临时断货，给卖家具体的提速或加急发快递合并解决脱销的对策。
        3. 自适应输出采购排程指导：即在多长天数内必须完成在仓分装，或者应该在哪天之前提前买好下一批货，以使未来的各批次无缝连接，周转库存安全可控。
        4. 务必严格以以下 JSON 形式返回结果，无需任何 code markdown 包装，JSON 格式如下：
        {
          "avgDailySales": 0,
          "leadTimeDemand": 0,
          "safetyStock": 0,
          "reorderPoint": 0,
          "daysOfSupply": 0,
          "suggestedQuantity": 0,
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
        parsed.targetCoverageDays = parsed.targetCoverageDays !== undefined ? Number(parsed.targetCoverageDays) : targetCoverageDays;
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
          targetCoverageDays,
          timelineSim,
          restockMode,
          inTransitArriveDays,
          inTransitBatches,
          explanation: `【⚠️ 提示：AI 详细服务在线解析超时，系统已自动触发高阶时间轴模拟器进行离线推算，分析结论如下】\n\n1. **动态销售评估**：根据历史销售记录，当前预测日销售均速为 **${avgDailySales.toFixed(2)}件/日**。安全库存警戒线（SS）设在 **${safetyStock}件** 对应的安全在库水平。\n\n2. **多批次在途仿真推演**：${fallbackInTransitDescription} 仿真曲线表明，结合您当前的成品及原材料在库总量，在接下来的 ${simDaysLimit} 天中：\n   * ${isOutOfStockEver ? `🚨 **异常断货预警**：系统研判可用库存无法形成闭环覆盖！在**未来第 ${outOfStockDayStart} 到 ${outOfStockDayEnd} 天（共 ${outOfStockDaysCount} 天）**将面临库存见底，产生临时中断亏空。` : "✅ **安全绿灯**：科学推演表明，成品及多波段到货可无断档平稳过渡，未出现断货亏空状态。"}\n   * 在此期间，预估最低可用在库结存（包含可拆材料）极低谷值跌至 **${Math.round(minInventory)}件**。\n\n3. **精准MRP备货排程建议**：\n   * 为使此目标覆盖期（${targetCoverageDays}天）内的在库最低结存维持在安全警戒线（SS: ${safetyStock}件）的水准上，本次最科学的成品打包下单量应为：**${suggestedQuantity} 件**。\n   * ${suggestedQuantity > 0 ? `该批备货下单后，请务必保证从采购、打包到出库的总周转时间（Lead Time）在 **${leadTimeDays} 天**之内，这批多出的货件方能在时间轴真空期产生对齐保护，帮助您的整个物流网络恢复健康的良性防断货周转曲线！` : "当前在途和在库非常安全充足，在当前流速下暂时无需额外打包和发起补货采购。请维持日常巡查。"}`
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
