import { SKUPerformance, InTransitBatch } from "../types";

/**
 * 两段式库存模型 —— 全局唯一计算来源。
 *
 * 业务链路：
 *   采购 ──[采购到可发货天数]──> 本地仓库成品 ──[手动发货]──> 去FBA在途 ──[在途到仓天数]──> FBA可售
 *
 * 每次补货要算两个互相独立的决策：
 *   1) 本期发往 FBA 数量 (shipToFbaQty)  —— 从本地成品发多少去亚马逊
 *   2) 本期采购回仓数量 (procureQty)      —— 本地仓库补采购多少成品
 */

export interface TwoStageParams {
  avgDailySales: number;
  fbaStock: number;          // FBA 可售
  fbaInTransit: number;      // 去 FBA 在途 (合并各批次)
  inTransitArriveDays: number;
  inTransitBatches: InTransitBatch[];
  localStock: number;        // 本地仓库成品
  shipmentCycleDays: number; // 发货周期
  inboundLeadDays: number;   // 去 FBA 在途到仓天数 (= inTransitArriveDays, 用于 FBA 补货覆盖)
  procurementLeadDays: number; // 采购到可发货天数
  safetyStockDays: number;
  localStockCycles: number;  // 本地常备周期数
}

export interface TwoStageResult {
  shipToFbaQty: number;
  shipToFbaConstrained: boolean; // 本地成品不足以发出建议量
  procureQty: number;
  daysUntilFbaStockout: number;  // -1 = 仿真期内不断货
  fbaTimeline: { day: number; stock: number; safetyLine: number }[];
}

/** 从历史销量推算日均销量；优先用人工预测值。 */
export function resolveAvgDailySales(s: SKUPerformance): number {
  if (s.forecastedDailySales !== undefined && s.forecastedDailySales > 0) {
    return Number(s.forecastedDailySales);
  }
  const history = s.history || [];
  const totalOrders = history.reduce((sum, h) => sum + (h.orders || 0), 0);
  const totalDays = history.length * 7;
  return totalDays > 0 ? Math.max(0.01, totalOrders / totalDays) : 0.01;
}

/**
 * 把一个 SKU 解析成两段式模型的标准参数。
 * 这里集中处理“旧字段迁移”：旧 rawMaterialStock -> 本地成品 localStock。
 */
export function resolveParams(s: SKUPerformance): TwoStageParams {
  const batches = s.inTransitBatches || [];
  const hasBatches = batches.length > 0;
  const fbaInTransit = hasBatches
    ? batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0)
    : (s.inTransitStock ?? 0);

  // 数据迁移：localStock 未设时回落到旧的 rawMaterialStock。
  const localStock = s.localStock ?? s.rawMaterialStock ?? 0;
  const procurementLeadDays = s.procurementLeadDays ?? s.leadTimeDays ?? 30;

  return {
    avgDailySales: resolveAvgDailySales(s),
    fbaStock: s.currentStock ?? 0,
    fbaInTransit,
    inTransitArriveDays: s.inTransitArriveDays ?? 15,
    inTransitBatches: batches,
    localStock,
    shipmentCycleDays: s.shipmentCycleDays ?? 30,
    inboundLeadDays: s.inTransitArriveDays ?? 15,
    procurementLeadDays,
    safetyStockDays: s.safetyStockDays ?? 15,
    localStockCycles: s.localStockCycles ?? 1, // 默认 1 = 滚动补货不囤; 长尾 SKU 手动调高以一次囤几批
  };
}

/**
 * 逐日仿真 FBA 端物理库存，得到“距离断货还有几天”。
 *
 * 关键修复：物理库存一旦归零就停在零，断货流失的销量绝不结转进物理余额，
 * 否则后续到货会被这部分虚假欠账抵消（这是之前曲线把负库存算进去的根因）。
 */
export function simulateFbaTimeline(p: TwoStageParams, horizonDays: number) {
  const safetyStock = p.avgDailySales * p.safetyStockDays;
  const timeline: { day: number; stock: number; safetyLine: number }[] = [];
  const hasBatches = p.inTransitBatches.length > 0;

  let physical = p.fbaStock; // 物理可售库存(封底)
  let daysUntilStockout = -1;

  for (let d = 0; d <= horizonDays; d++) {
    if (d > 0) {
      // 1) 先把昨天结转的库存封底为 0
      if (physical < 0) physical = 0;
      // 2) 扣减当日销量
      physical -= p.avgDailySales;
      // 3) 当日到货补充
      if (hasBatches) {
        p.inTransitBatches.forEach((b) => {
          if (Number(b.arriveDays) === d) physical += Number(b.quantity) || 0;
        });
      } else if (d === p.inTransitArriveDays) {
        physical += p.fbaInTransit;
      }
    }

    const shown = Math.max(0, physical);
    if (daysUntilStockout === -1 && d > 0 && shown <= 0) {
      daysUntilStockout = d;
    }
    timeline.push({ day: d, stock: Math.round(shown), safetyLine: Math.round(safetyStock) });
  }

  return { timeline, daysUntilStockout };
}

/**
 * 计算两个补货决策。
 */
export function computeTwoStage(p: TwoStageParams, horizonDays?: number): TwoStageResult {
  const horizon = Math.max(90, horizonDays ?? 90);
  const { timeline, daysUntilStockout } = simulateFbaTimeline(p, horizon);

  // ---- 决策 1：本期发往 FBA ----
  // 让 FBA 端撑过 (发货周期 + 到仓天数 + 安全缓冲) 的需求。
  // 现有可用 = FBA可售 + 去FBA在途。差额从本地成品发出。
  const fbaCoverDays = p.shipmentCycleDays + p.inboundLeadDays + p.safetyStockDays;
  const fbaTargetUnits = p.avgDailySales * fbaCoverDays;
  const fbaAvailable = p.fbaStock + p.fbaInTransit;
  const fbaNeed = Math.max(0, Math.ceil(fbaTargetUnits - fbaAvailable));

  // 受本地成品约束：最多只能发本地现有的量。
  const shipToFbaQty = Math.min(fbaNeed, Math.max(0, Math.floor(p.localStock)));
  const shipToFbaConstrained = fbaNeed > p.localStock;

  // ---- 决策 2：本期采购回仓 ----
  // 发货后本地成品 = localStock - shipToFbaQty。
  // 目标水位 = 常备 N 个发货周期 + 覆盖采购前置期的消耗。
  const localAfterShip = p.localStock - shipToFbaQty;
  const localTargetUnits =
    p.avgDailySales * (p.localStockCycles * p.shipmentCycleDays + p.procurementLeadDays);
  const procureQty = Math.max(0, Math.ceil(localTargetUnits - localAfterShip));

  return {
    shipToFbaQty,
    shipToFbaConstrained,
    procureQty,
    daysUntilFbaStockout: daysUntilStockout,
    fbaTimeline: timeline,
  };
}

/** 列表行用的轻量计算：直接给两个数 + 断货天数。 */
export function computeRowMetrics(s: SKUPerformance, targetDays?: number) {
  const p = resolveParams(s);
  return computeTwoStage(p, targetDays);
}
