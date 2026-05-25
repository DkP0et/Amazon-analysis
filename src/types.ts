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

export interface SKUPerformance {
  sku: string;
  storeId: string;
  history: WeeklyData[];
  currentStock?: number;
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
