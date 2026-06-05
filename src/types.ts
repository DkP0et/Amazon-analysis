export interface Store {
  id: string;
  name: string;
  createdAt: string;
}

export interface WeeklyData {
  date: string;
  sku: string;
  sessions: number;
  orders: number;
  conversionRate: number; // Unit Session Percentage
  totalSales: number;
  notes?: string;
}

export interface InventoryData {
  sku: string;
  stockLevel: number;
}

export interface InTransitBatch {
  id: string;
  quantity: number;
  arriveDays: number; // 预计到达天数
  remark?: string;    // 批次备注 (如海运第一批、空运补充等)
}

export interface RestockInsight {
  avgDailySales: number;       // Average daily sales calculated across history
  leadTimeDemand: number;      // Demand during lead time (Average daily sales * Lead time days)
  safetyStock: number;         // Safety stock volume (Average daily sales * Safety stock days)
  reorderPoint: number;        // Reorder Point = Lead Time Demand + Safety Stock
  daysOfSupply: number;        // Days of Supply left = (Current Stock + In-Transit) / Average Daily Sales
  suggestedQuantity: number;   // Recommended replenishment qty to cover target days (e.g., 60 days)
  targetCoverageDays: number;  // The supply coverage period used (e.g. 60 or 90 days)
  explanation: string;         // Professional AI-generated analysis of demand and delivery logic
  analyzedAt: string;          // Timestamp of calculations
  // ===== 两段式补货决策的两个核心产出 =====
  shipToFbaQty?: number;        // 【本期发往 FBA 数量】从本地成品里这次该补多少去亚马逊
  shipToFbaConstrained?: boolean; // 若本地成品不足以发出建议量, 为 true (提示需先采购)
  procureQty?: number;          // 【本期采购回仓数量】本地仓库需补采购多少成品
  daysUntilFbaStockout?: number; // FBA 端真实断货日 (逐日仿真, -1 表示覆盖期内不断货)
  // 以下字段为计算时记录的库存快照与仿真数据，运行时可能为 undefined
  currentStock?: number;        // FBA 可售快照
  localStock?: number;          // 本地仓库成品快照
  rawMaterialStock?: number;    // 兼容旧快照
  inTransitStock?: number;
  inTransitArriveDays?: number;
  inTransitBatches?: InTransitBatch[];
  timelineSim?: { day: number; [key: string]: any }[];
}

export interface SKUPerformance {
  sku: string;
  storeId: string;
  history: WeeklyData[];
  // ===== 两段式库存模型 =====
  // 采购 --[procurementLeadDays]--> 本地仓库成品(localStock) --[发货]--> 去FBA在途(inTransitStock) --[inTransitArriveDays]--> FBA可售(currentStock)
  currentStock?: number;        // 【FBA 可售库存】亚马逊端实货可售数量 (历史数据迁移：旧的"当前在库"字段沿用为此值)
  localStock?: number;          // 【本地仓库成品库存】已包装好、随时可发往 FBA 的成品。复用旧 rawMaterialStock 数据迁移而来
  rawMaterialStock?: number;    // 【已废弃/兼容】旧的"原材料折合成品"字段，仅用于读取旧数据迁移到 localStock，新逻辑不再使用
  procurementLeadDays?: number;  // 【采购到可发货天数】从下采购单到货物可发往 FBA 的合并前置天数 (默认沿用 leadTimeDays)
  localStockCycles?: number;     // 【本地常备周期数】本地仓库希望常备多少个发货周期的成品 (每个 SKU 单独设, 默认 1 = 滚动补货不囤; 长尾手动调高)
  inTransitStock?: number;     // 【去 FBA 在途】已发出、运往 FBA 途中的货
  inTransitArriveDays?: number; // 去 FBA 在途预计到达/上架天数 (默认 15)
  inTransitBatches?: InTransitBatch[]; // 多批次去 FBA 在途货件
  leadTimeDays?: number;       // 头程/采购及打包组装提前天数 (与 procurementLeadDays 同义, 保留向后兼容)
  safetyStockDays?: number;     // 安全天数
  shipmentCycleDays?: number;   // 发货间隔/发货周期天数 (默认 30 天)
  forecastedDailySales?: number; // 预期未来日销量 (件/天，支持自定义)
  restockInsight?: RestockInsight; // AI 备货预测与计算产出
  restockInsights?: { [key: string]: any }; // 缓存不同策略计算结果以避免重复请求 (Id: simulated/exclude/include)
  insight?: AIInsight;
  analysisLoading?: boolean;
  analysisStatus?: 'idle' | 'success' | 'error';
  analysisErrorMessage?: string;
  name?: string; // product remark / custom name
  actions?: OperationAction[];
}

export interface OperationAction {
  id: string;
  sku: string;
  storeId: string;
  date: string; // Action week date (e.g. "2026-05-15")
  type: 'PRICING' | 'ADVERTISING' | 'LISTING_OPTIMIZATION' | 'REPLENISHMENT' | 'PROMOTION' | 'OTHER';
  title: string;
  details?: string;
  status: 'planned' | 'executed' | 'completed';
  executedAt?: string;
  results?: {
    sessionsBefore: number;
    sessionsAfter: number;
    cvrBefore: number;
    cvrAfter: number;
    salesBefore: number;
    salesAfter: number;
    efficiencyRating: 'excellent' | 'good' | 'no_effect' | 'negative' | 'observing';
    analysisText?: string;
  };
}

export interface AIInsight {
  summary: string;
  diagnosis: string;
  pros: string[];
  cons: string[];
  recommendations: string[];
  provider?: string;
  tokenSavingsPct?: number;
  compressedWeeksCount?: number;
  // Robust funnel attribution diagnostics computed by server
  attribution?: {
    sessionsBase: number;
    sessionsCurr: number;
    cvrBase: number;
    cvrCurr: number;
    salesBase: number;
    salesCurr: number;
    sessionsEffect: number;
    cvrEffect: number;
    aovEffect: number;
    totalEffect: number;
    primaryDriver: string;
    commentary: string;
  };
}

export interface SKUAnomaly {
  sku: string;
  type: 'SALES_DROP' | 'CVR_DROP' | 'TRAFFIC_SPIKE_NO_SALES' | 'LOW_STOCK';
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  changeValue?: string;
}
