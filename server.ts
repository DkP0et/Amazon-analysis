import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { ProxyAgent, setGlobalDispatcher } from "undici";

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

  // AI analysis endpoint
  app.post("/api/analyze", async (req, res) => {
    const { skuData } = req.body;

    if (!skuData) {
      return res.status(400).json({ error: "Missing SKU data" });
    }

    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        throw new Error("请在 .env 文件中配置 DEEPSEEK_API_KEY。");
      }

      const apiBase = process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1";
      const apiModel = process.env.DEEPSEEK_API_MODEL || "deepseek-chat";

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
        - 结果必须是合法的 JSON 对象。
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

      const analysisResult = JSON.parse(content);
      res.json(analysisResult);
    } catch (error: any) {
      console.error("AI Analysis Error Details:", error);
      
      let friendlyMessage = "DeepSeek AI 分析请求失败";
      const errorStr = String(error);
      
      if (errorStr.includes("fetch failed") || errorStr.includes("TIMEOUT") || errorStr.includes("UND_ERR")) {
        friendlyMessage = `网络连接异常：无法连接至 DeepSeek AI 服务。
如果您是在本地运行：
1. 请确保您的代理工具（如 Clash/V2Ray）已开启并允许局域网连接。
2. 检查 .env 文件中的 PROXY_URL 是否正确（如 http://127.0.0.1:7890）。
3. 如果是在 PowerShell 运行，请尝试执行：$env:HTTPS_PROXY='http://127.0.0.1:你的端口' 后再启动项目。
4. 如果使用的是国内/无防护环境，也可以在 .env 中设置自定义的 DEEPSEEK_API_BASE。`;
      } else if (errorStr.includes("401") || errorStr.includes("API key")) {
        friendlyMessage = "API Key 无效：请检查 .env 中配置的 DEEPSEEK_API_KEY 是否正确。";
      } else if (errorStr.includes("JSON")) {
        friendlyMessage = "解析 AI 返回数据失败，请重试。";
      } else {
        friendlyMessage = `AI 分析出错：${error.message || errorStr}`;
      }

      res.status(500).json({ 
        error: friendlyMessage, 
        details: error.message || errorStr 
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
