import React from "react";
import {
  TrendingUp, TrendingDown, Package, AlertCircle, ChevronRight, BrainCircuit,
  Loader2, Search, BarChart3, RefreshCw, Layers, CheckCircle2, XCircle,
  AlertTriangle, Zap, Eye, StickyNote, Trash2, Plus, PackageOpen, FileText, Download
} from "lucide-react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, AreaChart, Area, BarChart, Bar
} from "recharts";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../lib/utils";
import { InfoTooltip } from "../common/InfoTooltip";
import { skuService } from "../../lib/skuService";
import { SKUPerformance, OperationAction, SKUAnomaly } from "../../types";

type ActionType = 'PRICING' | 'ADVERTISING' | 'LISTING_OPTIMIZATION' | 'REPLENISHMENT' | 'PROMOTION' | 'OTHER';
type ActionStatus = 'planned' | 'executed' | 'completed';
type SortColumn = 'sku' | 'orders' | 'sessions' | 'cvr' | 'stock';

interface DashboardViewProps {
  skuPerformance: Record<string, SKUPerformance>;
  selectedSku: string | null;
  setSelectedSku: (s: string | null | ((prev: string | null) => string | null)) => void;
  sortedSkus: SKUPerformance[];
  anomalies: SKUAnomaly[];
  availableWeeks: string[];
  currentWeekIdx: number;
  currentWeekDate: string;
  chartMetric: 'totalSales' | 'orders';
  setChartMetric: React.Dispatch<React.SetStateAction<'totalSales' | 'orders'>>;
  isEditingRemark: boolean;
  setIsEditingRemark: React.Dispatch<React.SetStateAction<boolean>>;
  tempRemark: string;
  setTempRemark: React.Dispatch<React.SetStateAction<string>>;
  isAddingAction: boolean;
  setIsAddingAction: React.Dispatch<React.SetStateAction<boolean>>;
  actionType: ActionType;
  setActionType: React.Dispatch<React.SetStateAction<ActionType>>;
  actionTitle: string;
  setActionTitle: React.Dispatch<React.SetStateAction<string>>;
  actionDetails: string;
  setActionDetails: React.Dispatch<React.SetStateAction<string>>;
  actionStatus: ActionStatus;
  setActionStatus: React.Dispatch<React.SetStateAction<ActionStatus>>;
  analyzeSku: (sku: string) => Promise<void>;
  saveNote: (sku: string, date: string, noteText: string) => Promise<void>;
  formatWeekRange: (dateStr: string) => string;
  getFunnelAttribution: (skuData: SKUPerformance, currentDate: string) => any;
  getSortableDateValue: (dateStr: string) => number;
  evaluateActionPerformance: (skuData: SKUPerformance, action: OperationAction) => OperationAction["results"] | undefined;
  renderSortArrows: (column: SortColumn) => React.ReactNode;
  handleSaveRemark: () => void;
  handleAddAction: (sku: string, type: any, title: string, details: string, status: any, date: string) => void;
  handleDeleteAction: (sku: string, actionId: string) => void;
  handleUpdateActionStatus: (sku: string, actionId: string, status: ActionStatus) => void;
  handleAdoptRecommendation: (recommendationText: string) => void;
}

export function DashboardView({
  skuPerformance,
  selectedSku,
  setSelectedSku,
  sortedSkus,
  anomalies,
  availableWeeks,
  currentWeekIdx,
  currentWeekDate,
  chartMetric,
  setChartMetric,
  isEditingRemark,
  setIsEditingRemark,
  tempRemark,
  setTempRemark,
  isAddingAction,
  setIsAddingAction,
  actionType,
  setActionType,
  actionTitle,
  setActionTitle,
  actionDetails,
  setActionDetails,
  actionStatus,
  setActionStatus,
  analyzeSku,
  saveNote,
  formatWeekRange,
  getFunnelAttribution,
  getSortableDateValue,
  evaluateActionPerformance,
  renderSortArrows,
  handleSaveRemark,
  handleAddAction,
  handleDeleteAction,
  handleUpdateActionStatus,
  handleAdoptRecommendation,
}: DashboardViewProps) {
  return (
            <div className="p-8 space-y-8 max-w-[1650px] mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-transform hover:-translate-y-1 duration-300">
                  <div className="flex justify-between items-start mb-4">
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-wider">总会话数</p>
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><Layers size={14} /></div>
                  </div>
                  <p className="text-4xl font-extrabold text-slate-900 tracking-tight">
                    {(Object.values(skuPerformance) as SKUPerformance[]).reduce((acc, curr) => {
                      const target = curr.history.find(h => h.date === currentWeekDate);
                      return acc + (target?.sessions || 0);
                    }, 0).toLocaleString()}
                  </p>
                  {(() => {
                    if (currentWeekIdx < 0) return null;
                    const skus = Object.values(skuPerformance) as SKUPerformance[];
                    const last4Weeks = availableWeeks.slice(Math.max(0, currentWeekIdx - 3), currentWeekIdx + 1);
                    
                    const currentSessions = skus.reduce((acc, s) => acc + (s.history.find(h => h.date === currentWeekDate)?.sessions || 0), 0);
                    const avgSessions = skus.reduce((acc, s) => {
                      const history4 = s.history.filter(h => last4Weeks.includes(h.date));
                      return acc + (history4.reduce((sum, h) => sum + h.sessions, 0) / (last4Weeks.length || 1));
                    }, 0);

                    const diff = avgSessions > 0 ? ((currentSessions - avgSessions) / avgSessions) * 100 : 0;
                    
                    return (
                      <div className="mt-4 flex items-center gap-1.5">
                        <span className={cn(
                          "text-[10px] font-bold px-1.5 py-0.5 rounded",
                          diff >= 0 ? "text-emerald-600 bg-emerald-50" : "text-rose-600 bg-rose-50"
                        )}>
                          {diff >= 0 ? "+" : ""}{diff.toFixed(1)}%
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">对比月均 ({Math.round(avgSessions).toLocaleString()})</span>
                      </div>
                    );
                  })()}
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-transform hover:-translate-y-1 duration-300">
                  <div className="flex justify-between items-start mb-4">
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-wider">已订购商品数量</p>
                    <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><CheckCircle2 size={14} /></div>
                  </div>
                  <p className="text-4xl font-extrabold text-slate-900 tracking-tight">
                    {(Object.values(skuPerformance) as SKUPerformance[]).reduce((acc, curr) => {
                      const target = curr.history.find(h => h.date === currentWeekDate);
                      return acc + (target?.orders || 0);
                    }, 0).toLocaleString()}
                  </p>
                  {(() => {
                    if (currentWeekIdx < 0) return null;
                    const skus = Object.values(skuPerformance) as SKUPerformance[];
                    const last4Weeks = availableWeeks.slice(Math.max(0, currentWeekIdx - 3), currentWeekIdx + 1);
                    
                    const currentOrders = skus.reduce((acc, s) => acc + (s.history.find(h => h.date === currentWeekDate)?.orders || 0), 0);
                    const avgOrders = skus.reduce((acc, s) => {
                      const history4 = s.history.filter(h => last4Weeks.includes(h.date));
                      return acc + (history4.reduce((sum, h) => sum + h.orders, 0) / (last4Weeks.length || 1));
                    }, 0);

                    const diff = avgOrders > 0 ? ((currentOrders - avgOrders) / avgOrders) * 100 : 0;
                    
                    return (
                      <div className="mt-4 flex items-center gap-1.5">
                        <span className={cn(
                          "text-[10px] font-bold px-1.5 py-0.5 rounded",
                          diff >= 0 ? "text-emerald-600 bg-emerald-50" : "text-rose-600 bg-rose-50"
                        )}>
                          {diff >= 0 ? "+" : ""}{diff.toFixed(1)}%
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">对比月均 ({Math.round(avgOrders).toLocaleString()})</span>
                      </div>
                    );
                  })()}
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-transform hover:-translate-y-1 duration-300">
                  <div className="flex justify-between items-start mb-4">
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-wider">平均转化率 (CVR)</p>
                    <div className="p-2 bg-amber-50 text-amber-600 rounded-lg"><TrendingUp size={14} /></div>
                  </div>
                  <p className="text-4xl font-extrabold text-slate-900 tracking-tight">
                    {(() => {
                      const skus = Object.values(skuPerformance) as SKUPerformance[];
                      const relevantSkus = skus.filter(s => s.history.some(h => h.date === currentWeekDate));
                      const totalCvr = relevantSkus.reduce((acc, curr) => {
                        const target = curr.history.find(h => h.date === currentWeekDate);
                        return acc + (target?.conversionRate || 0);
                      }, 0);
                      return ((totalCvr / (relevantSkus.length || 1)) * 100).toFixed(2);
                    })()}%
                  </p>
                  {(() => {
                    if (currentWeekIdx <= 0) return null;
                    const prevWeekDate = availableWeeks[currentWeekIdx - 1];
                    const skus = Object.values(skuPerformance) as SKUPerformance[];
                    
                    const getCurrentAvg = () => {
                      const rel = skus.filter(s => s.history.some(h => h.date === currentWeekDate));
                      return rel.reduce((acc, s) => acc + (s.history.find(h => h.date === currentWeekDate)?.conversionRate || 0), 0) / (rel.length || 1);
                    };
                    const getPrevAvg = () => {
                      const rel = skus.filter(s => s.history.some(h => h.date === prevWeekDate));
                      return rel.reduce((acc, s) => acc + (s.history.find(h => h.date === prevWeekDate)?.conversionRate || 0), 0) / (rel.length || 1);
                    };

                    const currentAvg = getCurrentAvg();
                    const prevAvg = getPrevAvg();
                    const diff = (currentAvg - prevAvg) * 100;
                    
                    return (
                      <p className={cn(
                        "text-[10px] font-bold mt-2 flex items-center gap-1",
                        diff >= 0 ? "text-emerald-500" : "text-rose-500"
                      )}>
                        {diff >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        {diff >= 0 ? "↑" : "↓"} {Math.abs(diff).toFixed(2)}% vs prev
                      </p>
                    );
                  })()}
                </div>

                <div className="bg-indigo-600 p-6 rounded-2xl border border-indigo-500 shadow-xl shadow-indigo-100 transition-transform hover:-translate-y-1 duration-300">
                  <div className="flex justify-between items-start mb-4">
                    <p className="text-sm font-bold text-indigo-200 uppercase tracking-wider">库存缺货预警</p>
                    <div className="p-2 bg-white/20 text-white rounded-lg"><AlertCircle size={14} /></div>
                  </div>
                  <p className="text-4xl font-extrabold text-white tracking-tight">
                    {(Object.values(skuPerformance) as SKUPerformance[]).filter(s => {
                      const latest = s.history?.[s.history.length - 1];
                      const dailyVelo = Math.max(0.1, (latest?.orders || 0) / 7);
                      const daysLeft = Math.floor((s.currentStock || 0) / dailyVelo);
                      return daysLeft < 15;
                    }).length} SKUs
                  </p>
                  <p className="text-[10px] text-indigo-100 font-medium mt-2 opacity-80">预计 15 天内断货的 Listing</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-[calc(100vh-320px)] min-h-[500px]">
                {/* SKU Table Breakdown */}
                <div className="lg:col-span-7 flex flex-col gap-6 overflow-hidden">
                  <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
                    <div>
                      <h3 className="font-bold text-slate-900 text-xl tracking-tight">Listing 业绩详情</h3>
                      <p className="text-sm text-slate-400 font-medium">按 SKU 细分的每周运营指标</p>
                    </div>
                    <div className="bg-slate-100 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 uppercase tracking-widest border border-slate-200">
                      在线商品: {Object.keys(skuPerformance).length}
                    </div>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-[#F8FAFC] border-b border-slate-100 sticky top-0 z-10">
                        <tr>
                          <th className="px-6 py-4 text-xs uppercase text-slate-400 font-bold tracking-widest whitespace-nowrap">
                            <span className="align-middle">Listing 详情</span>
                            {renderSortArrows('sku')}
                          </th>
                          <th className="px-4 py-4 text-xs uppercase text-slate-400 font-bold tracking-widest text-center whitespace-nowrap">
                            <span className="align-middle">销量趋势 (单周/对比)</span>
                            {renderSortArrows('orders')}
                          </th>
                          <th className="px-4 py-4 text-xs uppercase text-slate-400 font-bold tracking-widest text-center whitespace-nowrap">
                            <span className="align-middle">会话趋势</span>
                            {renderSortArrows('sessions')}
                          </th>
                          <th className="px-4 py-4 text-xs uppercase text-slate-400 font-bold tracking-widest text-center whitespace-nowrap">
                            <span className="align-middle">转化率</span>
                            {renderSortArrows('cvr')}
                          </th>
                          <th className="px-6 py-4 text-xs uppercase text-slate-400 font-bold tracking-widest text-right whitespace-nowrap">
                            {renderSortArrows('stock')}
                            <span className="align-middle ml-1.5">库存与可售天数</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sortedSkus.map((sku) => {
                          const targetWeek = sku.history.find(h => h.date === currentWeekDate);
                          const isActive = selectedSku === sku.sku;
                          const hasAnomaly = anomalies.some(a => a.sku === sku.sku);
                          
                          if (!targetWeek) return null;
                          
                          return (
                            <motion.tr 
                              key={sku.sku}
                              onClick={() => setSelectedSku(sku.sku)}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className={cn(
                                "group cursor-pointer transition-colors duration-150",
                                isActive ? "bg-indigo-100/60 shadow-[inset_0_1px_0_0_rgba(165,180,252,0.4),_inset_0_-1px_0_0_rgba(165,180,252,0.4)]" : hasAnomaly ? "bg-rose-50/30" : "hover:bg-slate-50"
                              )}
                            >
                              <td className={cn("px-6 py-5 transition-all duration-150", isActive ? "border-l-4 border-indigo-600 pl-5" : "border-l-4 border-transparent pl-5")}>
                                <div className="flex items-center gap-4">
                                  <div className="relative">
                                    <div className={cn(
                                      "w-10 h-10 rounded-lg flex items-center justify-center border font-mono text-[10px] font-bold transition-all duration-300 shadow-sm",
                                      isActive ? "bg-indigo-600 border-indigo-700 text-white" : "bg-slate-50 border-slate-200 text-slate-400 group-hover:scale-105"
                                    )}>
                                      SKU
                                    </div>
                                    {hasAnomaly && (
                                      <div className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 rounded-full flex items-center justify-center text-white ring-2 ring-white animate-pulse">
                                        <AlertTriangle size={8} strokeWidth={3} />
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <p className={cn("font-bold text-sm tracking-tight mb-0.5", isActive ? "text-indigo-700" : "text-slate-900 group-hover:text-indigo-600")}>
                                        {sku.sku.length > 25 ? sku.sku.substring(0, 22) + '...' : sku.sku}
                                      </p>
                                      {hasAnomaly && (
                                        <span className="px-1.5 py-0.5 bg-rose-100 text-rose-600 text-[9px] font-bold rounded uppercase tracking-wider">
                                          异常
                                        </span>
                                      )}
                                    </div>
                                    {sku.name && (
                                      <p className="text-[11px] text-indigo-600/90 font-bold truncate max-w-[240px]" title={sku.name}>
                                        🏷️ {sku.name}
                                      </p>
                                    )}
                                    <p className="text-[10px] text-slate-400 font-medium">
                                      该周销售额: ${targetWeek.totalSales.toLocaleString()}
                                    </p>
                                  </div>
                                </div>
                              </td>
                              
                              {/* 单周销量 */}
                              <td className="px-4 py-5 text-center">
                                {(() => {
                                  const weeklyTotal = targetWeek.orders;
                                  const weeklyDaily = weeklyTotal / 7;
                                  const last4Entries = sku.history.filter(h => h.date <= currentWeekDate).slice(-4);
                                  const monthlyDaily = (last4Entries.reduce((acc, h) => acc + h.orders, 0) / (last4Entries.length * 7)) || 0.1;
                                  const diff = ((weeklyDaily - monthlyDaily) / monthlyDaily) * 100;
                                  
                                  return (
                                    <div className="flex flex-col items-center">
                                      <span className="font-mono text-sm font-bold text-slate-900">{weeklyTotal}</span>
                                      <div className="flex items-center gap-1 mt-0.5">
                                        <span className="text-xs text-slate-400 font-medium">{weeklyDaily.toFixed(1)}/日</span>
                                        <span className={cn(
                                          "text-[10px] font-bold flex items-center gap-0.5",
                                          diff > 0 ? "text-emerald-500" : diff < 0 ? "text-rose-500" : "text-slate-400"
                                        )}>
                                          {diff > 0 ? "+" : ""}{diff.toFixed(0)}%
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })()}
                              </td>

                              {/* 单周会话 */}
                              <td className="px-4 py-5 text-center">
                                {(() => {
                                  const weeklyTotal = targetWeek.sessions;
                                  const weeklyDaily = weeklyTotal / 7;
                                  const last4Entries = sku.history.filter(h => h.date <= currentWeekDate).slice(-4);
                                  const monthlyDaily = (last4Entries.reduce((acc, h) => acc + h.sessions, 0) / (last4Entries.length * 7)) || 0.1;
                                  const diff = ((weeklyDaily - monthlyDaily) / monthlyDaily) * 100;
                                  
                                  return (
                                    <div className="flex flex-col items-center">
                                      <span className="font-mono text-sm font-bold text-slate-900">{weeklyTotal}</span>
                                      <div className="flex items-center gap-1 mt-0.5">
                                        <span className="text-xs text-slate-400 font-medium">{weeklyDaily.toFixed(0)}/日</span>
                                        <span className={cn(
                                          "text-[10px] font-bold flex items-center gap-0.5",
                                          diff > 0 ? "text-emerald-500" : diff < 0 ? "text-rose-500" : "text-slate-400"
                                        )}>
                                          {diff > 0 ? "+" : ""}{diff.toFixed(0)}%
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })()}
                              </td>

                              {/* 转化率 */}
                              <td className="px-4 py-5 text-center">
                                {(() => {
                                  const weeklyCvr = targetWeek.conversionRate;
                                  const last4Entries = sku.history.filter(h => h.date <= currentWeekDate).slice(-4);
                                  const monthlyCvr = (last4Entries.reduce((acc, h) => acc + h.conversionRate, 0) / last4Entries.length) || 0.01;
                                  const diff = ((weeklyCvr - monthlyCvr) / monthlyCvr) * 100;
                                  
                                  return (
                                    <div className="flex flex-col items-center">
                                      <span className="font-mono text-sm font-bold text-slate-700">{(weeklyCvr * 100).toFixed(1)}%</span>
                                      <span className={cn(
                                        "text-[10px] font-bold flex items-center gap-0.5",
                                        diff > 0 ? "text-emerald-500" : diff < 0 ? "text-rose-500" : "text-slate-400"
                                      )}>
                                        {diff > 0 ? "+" : ""}{diff.toFixed(0)}%
                                      </span>
                                    </div>
                                  );
                                })()}
                              </td>

                              {/* 库存水平 & 可售天数 */}
                              <td className="px-6 py-5 text-right">
                                {sku.currentStock !== undefined ? (
                                  <div className="flex flex-col items-end">
                                    <span className={cn(
                                      "font-bold text-sm",
                                      sku.currentStock < 20 ? "text-rose-600" : "text-slate-900"
                                    )}>
                                      {sku.currentStock} 件
                                    </span>
                                    {(() => {
                                      const dailyVelo = Math.max(0.1, targetWeek.orders / 7);
                                      const daysLeft = Math.floor(sku.currentStock / dailyVelo);
                                      return (
                                        <span className={cn(
                                          "text-[10px] font-bold px-1.5 py-0.5 rounded mt-1",
                                          daysLeft < 15 ? "bg-rose-100 text-rose-700" : daysLeft < 30 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                                        )}>
                                          可售 {daysLeft} 天
                                        </span>
                                      );
                                    })()}
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-300 italic">未导入库存</span>
                                )}
                              </td>
                            </motion.tr>
                          );
                        })}
                      </tbody>


                    </table>
                  </div>
                </div>
              </div>

                {/* AI Insight Sidebar Dashboard View */}
                <div className="lg:col-span-5 space-y-6 flex flex-col h-full overflow-hidden">
                  {selectedSku && skuPerformance[selectedSku] ? (
                    <AnimatePresence mode="wait">
                      <motion.div 
                        key={selectedSku}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden"
                      >
                        {/* SKU Info */}
                        <div className="p-6 border-b border-slate-100 bg-[#F8FAFC] flex items-center justify-between shrink-0">
                          <div className="min-w-0 flex-1 mr-3 space-y-0.5">
                            <h3 className="font-bold text-slate-900 text-lg truncate mb-1" title={selectedSku}>{selectedSku}</h3>
                            
                            {/* SKU备注(商品别名)修改器 */}
                            {isEditingRemark ? (
                              <div className="flex items-center gap-1 mt-0.5">
                                <input
                                  type="text"
                                  className="text-xs border border-indigo-200 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white w-full max-w-[240px] font-medium"
                                  value={tempRemark}
                                  onChange={(e) => setTempRemark(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveRemark();
                                    if (e.key === 'Escape') setIsEditingRemark(false);
                                  }}
                                  autoFocus
                                  placeholder="输入商品备注/名称..."
                                />
                                <button 
                                  onClick={handleSaveRemark}
                                  className="text-emerald-600 hover:text-emerald-800 transition-colors p-0.5"
                                >
                                  <CheckCircle2 size={13} />
                                </button>
                                <button 
                                  onClick={() => setIsEditingRemark(false)}
                                  className="text-slate-400 hover:text-slate-600 transition-colors p-0.5"
                                >
                                  <XCircle size={13} />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 group/remark mt-0.5 mb-1.5">
                                <span className={cn(
                                  "text-[11px] font-medium truncate max-w-[260px] px-1.5 py-0.5 rounded",
                                  skuPerformance[selectedSku]?.name 
                                    ? "text-indigo-700 bg-indigo-50 font-bold" 
                                    : "text-slate-400 bg-slate-50 border border-slate-100"
                                )}>
                                  🏷️ {skuPerformance[selectedSku]?.name || "点击图标设置备注名..."}
                                </span>
                                <button
                                  onClick={() => {
                                    setTempRemark(skuPerformance[selectedSku]?.name || "");
                                    setIsEditingRemark(true);
                                  }}
                                  className="opacity-0 group-hover/remark:opacity-100 focus:opacity-100 transition-opacity p-0.5 text-slate-400 hover:text-indigo-600 cursor-pointer"
                                  title="点击修改商品备注"
                                >
                                  <StickyNote size={12} />
                                </button>
                              </div>
                            )}
                            
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">Listing 核心分析</p>
                          </div>
                          
                          <button 
                            onClick={() => analyzeSku(selectedSku)}
                            disabled={skuPerformance[selectedSku].analysisLoading}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 shadow-lg",
                              skuPerformance[selectedSku].analysisStatus === 'success' ? "bg-emerald-500 text-white shadow-emerald-100" :
                              skuPerformance[selectedSku].analysisStatus === 'error' ? "bg-rose-500 text-white shadow-rose-100" :
                              "bg-indigo-600 text-white shadow-indigo-100 hover:bg-indigo-700"
                            )}
                          >
                            {skuPerformance[selectedSku].analysisLoading ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : skuPerformance[selectedSku].analysisStatus === 'success' ? (
                              <CheckCircle2 size={12} />
                            ) : skuPerformance[selectedSku].analysisStatus === 'error' ? (
                              <RefreshCw size={12} />
                            ) : (
                              <BrainCircuit size={12} />
                            )}
                            {skuPerformance[selectedSku].analysisLoading ? "正在分析..." : 
                             skuPerformance[selectedSku].analysisStatus === 'success' ? "分析完成" : 
                             skuPerformance[selectedSku].analysisStatus === 'error' ? "重新分析" : 
                             "AI 分析"}
                          </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide space-y-8">
                          {/* Anomaly Alerts Specific to this SKU */}
                          {anomalies.some(a => a.sku === selectedSku) && (
                            <div className="space-y-3">
                              <p className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                <AlertTriangle size={16} className="text-rose-500" />
                                业务异常详情
                              </p>
                              <div className="space-y-2">
                                {anomalies.filter(a => a.sku === selectedSku).map((anomaly, idx) => (
                                  <div 
                                    key={idx}
                                    className={cn(
                                      "p-4 rounded-xl border flex flex-col gap-1 shadow-sm",
                                      anomaly.severity === 'high' ? "bg-rose-50 border-rose-100" : "bg-amber-50 border-amber-100"
                                    )}
                                  >
                                    <div className="flex justify-between items-center">
                                      <span className={cn(
                                        "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider",
                                        anomaly.severity === 'high' ? "bg-rose-500 text-white" : "bg-amber-500 text-white"
                                      )}>
                                        {anomaly.title}
                                      </span>
                                      <span className="font-mono text-xs font-bold text-slate-900">{anomaly.changeValue}</span>
                                    </div>
                                    <p className="text-xs font-medium text-slate-700 leading-relaxed">
                                      {anomaly.description}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 运营笔记 Section */}
                          {(() => {
                            const targetHistory = skuPerformance[selectedSku].history?.find(h => h.date === currentWeekDate);
                            if (!targetHistory) return null;
                            
                            return (
                              <div className="space-y-3">
                                <p className="text-sm font-bold text-slate-900 flex items-center justify-between">
                                  <span className="flex items-center gap-2">
                                    <StickyNote size={16} className="text-amber-500" />
                                    本周运营笔记
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-mono">{formatWeekRange(currentWeekDate)}</span>
                                </p>
                                <div className="relative group" key={`${selectedSku}-${currentWeekDate}`}>
                                  <textarea 
                                    defaultValue={targetHistory.notes || ""}
                                    placeholder="记录本周的分析、操作或是异常想法..."
                                    onBlur={(e) => saveNote(selectedSku, currentWeekDate, e.target.value)}
                                    className="w-full h-32 bg-amber-50/30 border border-amber-200/50 rounded-xl p-4 text-xs font-medium text-slate-700 leading-relaxed outline-none focus:ring-1 focus:ring-amber-500/30 focus:border-amber-400 transition-all placeholder:text-slate-300 resize-none shadow-inner"
                                  />
                                  <div className="absolute bottom-3 right-3 opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none">
                                    <span className="text-[9px] text-amber-500 font-bold uppercase tracking-widest">自动保存</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* 销售趋势图 */}
                          <div className="space-y-4">
                            <div className="flex justify-between items-center">
                              <p className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                <TrendingUp size={16} className="text-indigo-500" />
                                历史{chartMetric === 'totalSales' ? '销售额' : '订单量'}趋势
                              </p>
                              
                              <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                                <button 
                                  onClick={() => setChartMetric('totalSales')}
                                  className={cn(
                                    "px-2 py-1 text-[10px] font-bold rounded-md transition-all",
                                    chartMetric === 'totalSales' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                                  )}
                                >
                                  金额
                                </button>
                                <button 
                                  onClick={() => setChartMetric('orders')}
                                  className={cn(
                                    "px-2 py-1 text-[10px] font-bold rounded-md transition-all",
                                    chartMetric === 'orders' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                                  )}
                                >
                                  订单
                                </button>
                              </div>
                            </div>
                            <div className="h-48 w-full">
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={[...(skuPerformance[selectedSku]?.history || [])].sort((a, b) => getSortableDateValue(a.date) - getSortableDateValue(b.date))}>
                                  <defs>
                                    <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor={chartMetric === 'totalSales' ? "#6366f1" : "#10b981"} stopOpacity={0.1}/>
                                      <stop offset="95%" stopColor={chartMetric === 'totalSales' ? "#6366f1" : "#10b981"} stopOpacity={0}/>
                                    </linearGradient>
                                  </defs>
                                  <XAxis dataKey="date" hide />
                                  <Tooltip 
                                    content={({ active, payload }) => {
                                      if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        return (
                                          <div className="bg-slate-900 border border-slate-800 text-white p-2.5 rounded-lg shadow-xl text-[10px] space-y-1">
                                            <p className="font-bold border-b border-white/10 pb-1">{data.date}</p>
                                            <p>销售额: <span className="font-mono text-emerald-400">${data.totalSales.toLocaleString()}</span></p>
                                            <p>订单量: <span className="font-mono text-indigo-400">{data.orders} 单</span></p>
                                            <p>转化率: <span className="font-mono text-amber-400">{(data.conversionRate * 100).toFixed(1)}%</span></p>
                                          </div>
                                        );
                                      }
                                      return null;
                                    }}
                                  />
                                  <Area 
                                    type="monotone" 
                                    dataKey={chartMetric} 
                                    stroke={chartMetric === 'totalSales' ? '#6366f1' : '#10b981'} 
                                    strokeWidth={2} 
                                    fillOpacity={1} 
                                    fill="url(#colorMetric)" 
                                    name={chartMetric === 'totalSales' ? '销售额' : '订单量'}
                                  />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          </div>

                          {/* 核心指标快照 */}
                          <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                              <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">平均周销量</p>
                              <p className="text-xl font-bold text-slate-900">
                                {(skuPerformance[selectedSku].history.reduce((a, b) => a + b.orders, 0) / (skuPerformance[selectedSku].history.length || 1)).toFixed(0)}
                              </p>
                            </div>
                            <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                              <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">平均转化率</p>
                              <p className="text-xl font-bold text-slate-900">
                                {(skuPerformance[selectedSku].history.reduce((a, b) => a + b.conversionRate, 0) / (skuPerformance[selectedSku].history.length || 1) * 100).toFixed(1)}%
                              </p>
                            </div>
                          </div>

                          {/* 库存健康度 (优化自建议2) */}
                          <div className="p-5 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-4">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-0 leading-none">库存预警与补货管理</p>
                              <span className="text-[10px] text-slate-400 font-medium scale-90 origin-right whitespace-nowrap">依据14天标准到货期计算</span>
                            </div>
                            {(() => {
                              const targetWeek = skuPerformance[selectedSku].history?.find(h => h.date === currentWeekDate);
                              const dailyVelo = Math.max(0.1, (targetWeek?.orders || 0) / 7);
                              const currentStock = skuPerformance[selectedSku].currentStock || 0;
                              const daysLeft = Math.floor(currentStock / dailyVelo);
                              
                              // 目标周转天数（默认安全库存30天周转）
                              const targetDays = 30;
                              const recommendedReplenish = Math.max(0, Math.ceil(dailyVelo * targetDays - currentStock));
                              
                              const FBA_LEAD_TIME = 14; // standard FBA ocean/air lead time tracking
                              const daysToShip = daysLeft - FBA_LEAD_TIME;
                              
                              return (
                                <div className="space-y-4">
                                  <div className="flex justify-between items-end">
                                    <div>
                                      <p className="text-3xl font-extrabold text-slate-900 tracking-tight">{daysLeft || 0}</p>
                                      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">剩余可售天数</p>
                                    </div>
                                    <div className={cn(
                                      "px-3 py-1 rounded-full text-[10px] font-bold uppercase border",
                                      daysLeft > 30 ? "bg-emerald-50 text-emerald-600 border-emerald-100" : 
                                      daysLeft > 15 ? "bg-amber-50 text-amber-600 border-amber-100" :
                                      "bg-rose-50 text-rose-600 border-rose-100 animate-pulse"
                                    )}>
                                      {daysLeft > 30 ? "库存充足" : daysLeft > 15 ? "建议补货" : "断货告急"}
                                    </div>
                                  </div>
                                  
                                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                    <motion.div 
                                      initial={{ width: 0 }} 
                                      animate={{ width: `${Math.min(100, (daysLeft/60)*100)}%` }} 
                                      className={cn(
                                        "h-full",
                                        daysLeft > 30 ? "bg-emerald-500" : daysLeft > 15 ? "bg-amber-500" : "bg-rose-500"
                                      )}
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-3 pt-1">
                                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                      <p className="text-[10px] text-slate-400 font-bold uppercase mb-1 leading-normal">建议补货量 (30天周转)</p>
                                      <p className={cn(
                                        "text-sm font-extrabold",
                                        recommendedReplenish > 0 ? "text-indigo-600 font-black" : "text-slate-500"
                                      )}>
                                        {recommendedReplenish > 0 ? `+ ${recommendedReplenish.toLocaleString()} 件` : "无需补货"}
                                      </p>
                                    </div>
                                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                      <p className="text-[10px] text-slate-400 font-bold uppercase mb-1 leading-normal">发货倒计时</p>
                                      {daysToShip > 0 ? (
                                        <p className="text-sm font-extrabold text-amber-600">
                                          ⏳ {daysToShip} 天内发货
                                        </p>
                                      ) : (
                                        <p className="text-sm font-extrabold text-rose-600 animate-pulse">
                                          🚨 赶快安排发货
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  {/* 基于到货红线的智能警告卡片 */}
                                  {daysToShip <= 0 && daysLeft < 30 && (
                                    <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-[11px] leading-relaxed">
                                      <span className="font-bold">⚠️ 发货延迟警报：</span>
                                      商品FBA海空联运与仓库上架耗时约 14 天，你当前剩余库存仅支持售卖 <span className="font-bold">{daysLeft} 天</span>。
                                      已延误安排发货预计 <span className="font-bold">{Math.abs(daysToShip)} 天</span>。
                                      预计会形成约 <span className="font-bold">{14 - daysLeft} 天</span> 的彻底断货空白期，建议改为使用空运等快速物流紧急补齐。
                                    </div>
                                  )}
                                  
                                  {daysToShip > 0 && daysToShip <= 7 && (
                                    <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-amber-800 text-[11px] leading-relaxed">
                                      <span className="font-bold">⏰ 备货提醒：</span>
                                      距离最迟安全发货期仅剩 <span className="font-bold">{daysToShip} 天</span>。请在这个窗口期结束之前将补货发走，否则将在14天流程后产生实质断货！
                                    </div>
                                  )}

                                  <div className="bg-slate-50/50 p-2.5 rounded-lg text-center border border-dashed border-slate-200">
                                    <p className="text-[11px] text-slate-500 font-medium">
                                      当前库存: <span className="font-bold text-slate-700">{currentStock}</span> 件 | 日销售速: <span className="font-bold text-slate-700">{dailyVelo.toFixed(1)}</span> 件/日
                                    </p>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>

                          {/* 漏斗波动归因分解 (漏斗异动诊断模型化 - 强化归因) */}
                          {(() => {
                            const attr = getFunnelAttribution(skuPerformance[selectedSku], currentWeekDate);
                            if (!attr) return null;

                            const deltaSales = attr.salesCurr - attr.salesBase;
                            const isPositiveSales = deltaSales >= 0;

                            // Calculate relative percentage weights for visual bars
                            const absTotal = Math.max(0.1, Math.abs(attr.totalEffect));
                            const sessionsWeight = (Math.abs(attr.sessionsEffect) / absTotal) * 100;
                            const cvrWeight = (Math.abs(attr.cvrEffect) / absTotal) * 100;
                            const aovWeight = (Math.abs(attr.aovEffect) / absTotal) * 100;

                            return (
                              <div className="p-5 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-4">
                                <div className="flex justify-between items-center">
                                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-none">漏斗波动因数归因诊断</p>
                                  <span className="text-[10px] text-slate-400 font-mono">基准 (前4周均值) vs 本周</span>
                                </div>

                                <div className="space-y-4">
                                  {/* Result Summary Banner */}
                                  <div className={cn(
                                    "p-3 rounded-xl border flex justify-between items-center",
                                    isPositiveSales ? "bg-emerald-50 border-emerald-100 text-emerald-850" : "bg-rose-50 border-rose-100 text-rose-850"
                                  )}>
                                    <span className="text-xs font-bold">销售额周变动量 (&Delta; Sales)</span>
                                    <span className="text-sm font-black font-mono">
                                      {isPositiveSales ? "+" : ""}${Math.round(deltaSales).toLocaleString()}
                                    </span>
                                  </div>

                                  {/* Factors Breakdown */}
                                  <div className="space-y-4">
                                    {/* 1. Traffic Factor */}
                                    <div className="space-y-1">
                                      <div className="flex justify-between text-xs font-semibold text-slate-700">
                                        <span className="flex items-center gap-1.5">
                                          <span className="w-2.5 h-2.5 rounded bg-indigo-500 shrink-0" />
                                          流量因子 (Sessions Effect)
                                        </span>
                                        <span className="font-mono text-slate-900">
                                          {Math.round(attr.sessionsEffect) >= 0 ? "+" : ""}${Math.round(attr.sessionsEffect).toLocaleString()}
                                        </span>
                                      </div>
                                      <div className="text-[10px] text-slate-400 font-mono flex justify-between">
                                        <span>基准流量: {Math.round(attr.sessionsBase)} 次 &rarr; 本周: {attr.sessionsCurr} 次</span>
                                        <span className={cn(
                                          "font-bold",
                                          attr.sessionsEffect >= 0 ? "text-emerald-600" : "text-rose-500"
                                        )}>
                                          贡献 {(attr.sessionsEffect >= 0 ? 1 : -1) * Math.round(sessionsWeight)}%
                                        </span>
                                      </div>
                                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                        <div 
                                          className={cn("h-full rounded-full transition-all duration-500", attr.sessionsEffect >= 0 ? "bg-emerald-500" : "bg-rose-500")}
                                          style={{ width: `${Math.min(100, sessionsWeight)}%` }}
                                        />
                                      </div>
                                    </div>

                                    {/* 2. CVR Factor */}
                                    <div className="space-y-1">
                                      <div className="flex justify-between text-xs font-semibold text-slate-700">
                                        <span className="flex items-center gap-1.5">
                                          <span className="w-2.5 h-2.5 rounded bg-amber-500 shrink-0" />
                                          转化率因子 (CVR Effect)
                                        </span>
                                        <span className="font-mono text-slate-900">
                                          {Math.round(attr.cvrEffect) >= 0 ? "+" : ""}${Math.round(attr.cvrEffect).toLocaleString()}
                                        </span>
                                      </div>
                                      <div className="text-[10px] text-slate-400 font-mono flex justify-between">
                                        <span>基准 CVR: {(attr.cvrBase * 100).toFixed(1)}% &rarr; 本周: {(attr.cvrCurr * 100).toFixed(1)}%</span>
                                        <span className={cn(
                                          "font-bold",
                                          attr.cvrEffect >= 0 ? "text-emerald-600" : "text-rose-500"
                                        )}>
                                          贡献 {(attr.cvrEffect >= 0 ? 1 : -1) * Math.round(cvrWeight)}%
                                        </span>
                                      </div>
                                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                        <div 
                                          className={cn("h-full rounded-full transition-all duration-500", attr.cvrEffect >= 0 ? "bg-amber-500" : "bg-rose-500")}
                                          style={{ width: `${Math.min(100, cvrWeight)}%` }}
                                        />
                                      </div>
                                    </div>

                                    {/* 3. AOV Factor */}
                                    <div className="space-y-1">
                                      <div className="flex justify-between text-xs font-semibold text-slate-700">
                                        <span className="flex items-center gap-1.5">
                                          <span className="w-2.5 h-2.5 rounded bg-emerald-500 shrink-0" />
                                          客单价因子 (Price / AOV Effect)
                                        </span>
                                        <span className="font-mono text-slate-900">
                                          {Math.round(attr.aovEffect) >= 0 ? "+" : ""}${Math.round(attr.aovEffect).toLocaleString()}
                                        </span>
                                      </div>
                                      <div className="text-[10px] text-slate-400 font-mono flex justify-between">
                                        <span>基准 AOV: ${attr.aovBase.toFixed(1)} &rarr; 本周 AOV: ${attr.aovCurr.toFixed(1)}</span>
                                        <span className={cn(
                                          "font-bold",
                                          attr.aovEffect >= 0 ? "text-emerald-600" : "text-rose-500"
                                        )}>
                                          贡献 {(attr.aovEffect >= 0 ? 1 : -1) * Math.round(aovWeight)}%
                                        </span>
                                      </div>
                                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                        <div 
                                          className={cn("h-full rounded-full transition-all duration-500", attr.aovEffect >= 0 ? "bg-emerald-500" : "bg-rose-500")}
                                          style={{ width: `${Math.min(100, aovWeight)}%` }}
                                        />
                                      </div>
                                    </div>
                                  </div>

                                  {/* Dynamic Diagnostics Commentary box */}
                                  <div className="p-3.5 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-1">
                                    <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">多维归因推断结论</p>
                                    <p className="text-xs leading-relaxed text-slate-700 font-medium">{attr.commentary}</p>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* 运营行动智能闭环跟踪（智能闭环） */}
                          <div className="p-5 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-4">
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-none">运营行动智能闭环跟踪</p>
                                <p className="text-[10px] text-slate-400 mt-1">记录精细运营手段，系统将智能验证并在14天内自动评估效果</p>
                              </div>
                              <button
                                onClick={() => setIsAddingAction(!isAddingAction)}
                                className="px-2.5 py-1 bg-indigo-50 border border-indigo-200 text-indigo-600 rounded-lg text-[11px] font-bold hover:bg-indigo-100 transition-colors flex items-center gap-1"
                              >
                                {isAddingAction ? "收起" : "+ 记录行动"}
                              </button>
                            </div>

                            {/* Incremental Action Form */}
                            {isAddingAction && (
                              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3.5 text-xs">
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">行动大类</label>
                                    <select 
                                      value={actionType}
                                      onChange={(e: any) => setActionType(e.target.value)}
                                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500 font-semibold"
                                    >
                                      <option value="PRICING">售价调整 (Pricing)</option>
                                      <option value="ADVERTISING">广告调优 (Advertising)</option>
                                      <option value="LISTING_OPTIMIZATION">Listing详情精修 (Listing)</option>
                                      <option value="REPLENISHMENT">紧急发货补运 (Logistics)</option>
                                      <option value="PROMOTION">秒杀/大额提券 (Promotion)</option>
                                      <option value="OTHER">其他运营行动 (Other)</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">执行状态</label>
                                    <select 
                                      value={actionStatus === 'planned' ? 'planned' : 'executed'}
                                      onChange={(e: any) => setActionStatus(e.target.value)}
                                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500 font-semibold"
                                    >
                                      <option value="executed">已执行 (本周有效)</option>
                                      <option value="planned">计划中 (后续执行)</option>
                                    </select>
                                  </div>
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">行动内容</label>
                                  <input 
                                    type="text"
                                    placeholder="如：降低单价售价至 $19.99、优化详情添加买家视频等"
                                    value={actionTitle}
                                    onChange={(e) => setActionTitle(e.target.value)}
                                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-indigo-500 font-medium"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">详细描述 (可选)</label>
                                  <textarea 
                                    placeholder="补充说明：具体的关键词加价、特定折让区间、广告组名或干线快船编号..."
                                    value={actionDetails}
                                    onChange={(e) => setActionDetails(e.target.value)}
                                    className="w-full h-16 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-indigo-500 font-medium resize-none"
                                  />
                                </div>

                                <button
                                  onClick={() => handleAddAction(selectedSku!, actionType, actionTitle, actionDetails, actionStatus, currentWeekDate)}
                                  disabled={!actionTitle.trim()}
                                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-md shadow-indigo-100 transition-colors"
                                >
                                  提交并启动智能闭环追踪
                                </button>
                              </div>
                            )}

                            {/* Registered actions list */}
                            {(!skuPerformance[selectedSku].actions || skuPerformance[selectedSku].actions.length === 0) ? (
                              <div className="py-8 bg-slate-50/50 border border-dashed border-slate-200 rounded-xl text-center text-xs text-slate-400 font-medium">
                                🔌 暂无行动数据。快从下方 AI 运营建议中一键采纳，或点击右上角记录行动开始追踪吧！
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {skuPerformance[selectedSku].actions.map((action) => {
                                  // Compute post evaluation
                                  const evaluation = evaluateActionPerformance(skuPerformance[selectedSku], action);
                                  
                                  // Color schemes for action types
                                  const typeConfigs: Record<string, { label: string, color: string }> = {
                                    PRICING: { label: "价格调整", color: "bg-amber-50 text-amber-600 border-amber-100" },
                                    ADVERTISING: { label: "广告调优", color: "bg-indigo-50 text-indigo-600 border-indigo-100" },
                                    LISTING_OPTIMIZATION: { label: "Listing优化", color: "bg-sky-50 text-sky-600 border-sky-100" },
                                    REPLENISHMENT: { label: "紧急补货", color: "bg-purple-50 text-purple-600 border-purple-100" },
                                    PROMOTION: { label: "促销活动", color: "bg-rose-50 text-rose-600 border-rose-100" },
                                    OTHER: { label: "其他行动", color: "bg-slate-100 text-slate-600 border-slate-200" }
                                  };
                                  const config = typeConfigs[action.type] || typeConfigs.OTHER;

                                  return (
                                    <div key={action.id} className="p-4 bg-slate-50/70 border border-slate-100 rounded-xl space-y-3 hover:shadow-sm transition-shadow">
                                      <div className="flex justify-between items-start gap-2">
                                        <div className="space-y-1 min-w-0">
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border leading-none uppercase shrink-0", config.color)}>
                                              {config.label}
                                            </span>
                                            <span className="text-[10px] text-slate-400 font-mono tracking-wider shrink-0">
                                              🗓️ {action.date}
                                            </span>
                                          </div>
                                          <p className="text-xs font-bold text-slate-800 break-words leading-snug">{action.title}</p>
                                          {action.details && (
                                            <p className="text-[11px] text-slate-400 leading-relaxed font-medium break-words">{action.details}</p>
                                          )}
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                          {action.status === 'planned' && (
                                            <button 
                                              onClick={() => handleUpdateActionStatus(selectedSku!, action.id, 'executed')}
                                              className="px-2 py-1 bg-indigo-600 text-white hover:bg-indigo-700 text-[10px] font-bold rounded"
                                              title="设为已执行"
                                            >
                                              标记执行
                                            </button>
                                          )}
                                          <button 
                                            onClick={() => handleDeleteAction(selectedSku!, action.id)}
                                            className="text-slate-400 hover:text-rose-500 transition-colors p-0.5"
                                            title="删除行动"
                                          >
                                            <XCircle size={14} />
                                          </button>
                                        </div>
                                      </div>

                                      {/* Intelligent validation result block */}
                                      {action.status !== 'planned' && evaluation && (
                                        <div className="pt-2 border-t border-slate-100 space-y-2">
                                          <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">成效数学验真</span>
                                            
                                            {/* Rating badges */}
                                            {evaluation.efficiencyRating === 'excellent' && (
                                              <span className="bg-emerald-500 text-white font-extrabold text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider inline-flex items-center gap-1 shadow-sm leading-none">
                                                📈 效能爆发
                                              </span>
                                            )}
                                            {evaluation.efficiencyRating === 'good' && (
                                              <span className="bg-emerald-100 text-emerald-800 font-extrabold text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider inline-flex items-center gap-1 leading-none">
                                                ✅ 效果明显
                                              </span>
                                            )}
                                            {evaluation.efficiencyRating === 'negative' && (
                                              <span className="bg-rose-100 text-rose-800 font-extrabold text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider inline-flex items-center gap-1 leading-none animate-pulse">
                                                🚨 建议复盘
                                              </span>
                                            )}
                                            {evaluation.efficiencyRating === 'no_effect' && (
                                              <span className="bg-slate-200 text-slate-700 font-extrabold text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider inline-flex items-center gap-1 leading-none">
                                                ➖ 影响不著
                                              </span>
                                            )}
                                            {evaluation.efficiencyRating === 'observing' && (
                                              <span className="bg-amber-100 text-amber-800 font-extrabold text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider inline-flex items-center gap-1 leading-none">
                                                ⏳ 观察期
                                              </span>
                                            )}
                                          </div>

                                          {/* Pre vs Post metrics comparison table if available */}
                                          {evaluation.efficiencyRating !== 'observing' && (
                                            <div className="grid grid-cols-3 gap-2 p-2 bg-slate-100/50 rounded-lg text-center font-mono">
                                              <div className="space-y-0.5">
                                                <p className="text-[8px] text-slate-400 font-bold uppercase whitespace-nowrap">周均流量</p>
                                                <p className="text-[10px] font-bold text-slate-700">
                                                  {Math.round(evaluation.sessionsBefore)} &rarr; {Math.round(evaluation.sessionsAfter)}
                                                </p>
                                                <p className={cn(
                                                  "text-[8px] font-extrabold",
                                                  evaluation.sessionsAfter >= evaluation.sessionsBefore ? "text-emerald-600" : "text-rose-500"
                                                )}>
                                                  {evaluation.sessionsAfter >= evaluation.sessionsBefore ? "+" : ""}{evaluation.sessionsBefore > 0 ? (((evaluation.sessionsAfter - evaluation.sessionsBefore) / evaluation.sessionsBefore) * 100).toFixed(1) : 0}%
                                                </p>
                                              </div>
                                              <div className="space-y-0.5">
                                                <p className="text-[8px] text-slate-400 font-bold uppercase whitespace-nowrap">周均 CVR</p>
                                                <p className="text-[10px] font-bold text-slate-700">
                                                  {(evaluation.cvrBefore * 100).toFixed(1)}% &rarr; {(evaluation.cvrAfter * 100).toFixed(1)}%
                                                </p>
                                                <p className={cn(
                                                  "text-[8px] font-extrabold",
                                                  evaluation.cvrAfter >= evaluation.cvrBefore ? "text-emerald-600" : "text-rose-500"
                                                )}>
                                                  {evaluation.cvrAfter >= evaluation.cvrBefore ? "+" : ""}{evaluation.cvrBefore > 0 ? (((evaluation.cvrAfter - evaluation.cvrBefore) / evaluation.cvrBefore) * 100).toFixed(1) : 0}%
                                                </p>
                                              </div>
                                              <div className="space-y-0.5">
                                                <p className="text-[8px] text-slate-400 font-bold uppercase whitespace-nowrap">周均销售额</p>
                                                <p className="text-[10px] font-bold text-slate-700">
                                                  ${Math.round(evaluation.salesBefore).toLocaleString()} &rarr; ${Math.round(evaluation.salesAfter).toLocaleString()}
                                                </p>
                                                <p className={cn(
                                                  "text-[8px] font-extrabold",
                                                  evaluation.salesAfter >= evaluation.salesBefore ? "text-emerald-600" : "text-rose-500"
                                                )}>
                                                  {evaluation.salesAfter >= evaluation.salesBefore ? "+" : ""}{evaluation.salesBefore > 0 ? (((evaluation.salesAfter - evaluation.salesBefore) / evaluation.salesBefore) * 100).toFixed(1) : 0}%
                                                </p>
                                              </div>
                                            </div>
                                          )}

                                          <p className="text-[11px] text-slate-600 font-medium leading-relaxed bg-white p-2.5 rounded-lg border border-slate-150 shadow-sm">
                                            {evaluation.analysisText}
                                          </p>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* AI Insight Section */}
                          {skuPerformance[selectedSku].insight && (
                            <div className="space-y-4">
                              <div className="bg-indigo-900 p-6 rounded-2xl text-white shadow-xl shadow-indigo-100/30 space-y-4">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                  <div className="flex items-center gap-2">
                                    <BrainCircuit size={18} className="text-indigo-300" />
                                    <p className="text-xs font-bold uppercase tracking-widest text-indigo-200">AI 运营概览</p>
                                  </div>
                                  {skuPerformance[selectedSku].insight.tokenSavingsPct !== undefined && skuPerformance[selectedSku].insight.tokenSavingsPct > 0 && (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 shadow-sm">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                                      历史多维数据压缩中：已减少 {skuPerformance[selectedSku].insight.tokenSavingsPct}% Token 占用（归档旧数据 {skuPerformance[selectedSku].insight.compressedWeeksCount || 0} 周）
                                    </span>
                                  )}
                                </div>
                                <div className="space-y-4">
                                  <div>
                                    <p className="text-sm font-bold text-white mb-2 whitespace-pre-wrap">{skuPerformance[selectedSku].insight.summary}</p>
                                    <p className="text-xs leading-relaxed text-indigo-100 opacity-80 whitespace-pre-wrap">{skuPerformance[selectedSku].insight.diagnosis}</p>
                                  </div>
                                </div>
                              </div>
                              
                              <div className="grid grid-cols-1 gap-4">
                                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                                  <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-3">亮点与优势</p>
                                  <ul className="space-y-2">
                                    {skuPerformance[selectedSku].insight.pros.map((p, i) => (
                                      <li key={i} className="text-xs text-emerald-700 flex items-start gap-2">
                                        <span className="mt-1 w-1 h-1 bg-emerald-400 rounded-full shrink-0" />
                                        {p}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl">
                                  <p className="text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-3">风险与挑战</p>
                                  <ul className="space-y-2">
                                    {skuPerformance[selectedSku].insight.cons.map((c, i) => (
                                      <li key={i} className="text-xs text-rose-700 flex items-start gap-2">
                                        <span className="mt-1 w-1 h-1 bg-rose-400 rounded-full shrink-0" />
                                        {c}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>

                              <div className="p-4 bg-white border border-indigo-100 rounded-xl shadow-sm">
                                <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mb-3">建议改进步骤</p>
                                <ul className="space-y-3">
                                  {skuPerformance[selectedSku].insight.recommendations.map((r, i) => (
                                    <li key={i} className="text-xs text-slate-700 flex flex-col gap-2 bg-indigo-50/30 p-3 rounded-lg border border-indigo-50/50">
                                      <div className="flex items-start gap-2">
                                        <Zap size={14} className="text-indigo-400 shrink-0 mt-0.5" />
                                        <span className="font-medium leading-relaxed">{r}</span>
                                      </div>
                                      <div className="flex justify-end pt-1">
                                        <button
                                          onClick={() => handleAdoptRecommendation(r)}
                                          className="px-2.5 py-1 bg-white border border-indigo-200 text-indigo-600 rounded text-[10px] font-bold hover:bg-indigo-50 active:scale-95 transition-all flex items-center gap-1 shadow-sm shrink-0"
                                        >
                                          🚀 一键采纳并智能追踪效果
                                        </button>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          )}

                          {skuPerformance[selectedSku].analysisStatus === 'error' && (
                            <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl flex items-start gap-3">
                              <AlertCircle size={16} className="text-rose-500 shrink-0 mt-0.5" />
                              <div className="space-y-1">
                                <p className="text-xs font-bold text-rose-900">分析失败</p>
                                <p className="text-[10px] text-rose-700 leading-relaxed">{skuPerformance[selectedSku].analysisErrorMessage}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    </AnimatePresence>
                  ) : (
                    <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center p-12 border-dashed">
                      <div className="w-16 h-16 rounded-3xl bg-slate-50 flex items-center justify-center mb-6 text-slate-300 border border-slate-100">
                        <BarChart3 size={32} />
                      </div>
                      <p className="text-lg font-bold text-slate-900 mb-2">选择 SKU 进行分析</p>
                      <p className="text-sm text-slate-400 max-w-[200px] leading-relaxed">
                        从左侧列表中选取特定 SKU，查看其历史趋势曲线及库存预警。
                      </p>
                    </div>
                  )}
                </div>

              </div>
            </div>
  );
}
