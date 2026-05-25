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
}

export interface SKUPerformance {
  sku: string;
  storeId: string;
  history: WeeklyData[];
  currentStock?: number;
  inTransitStock?: number;     // 在途库存
  leadTimeDays?: number;       // 头程时间 (天)
  safetyStockDays?: number;     // 安全库存天数
  restockInsight?: RestockInsight; // AI 备货预测与计算产出
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
