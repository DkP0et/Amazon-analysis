import React from "react";
import {
  Package, AlertCircle, TrendingUp, TrendingDown, RefreshCw, Layers,
  Loader2, Search, BrainCircuit, Zap, PackageOpen, Trash2, Plus, CheckCircle2,
  AlertTriangle
} from "lucide-react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, LineChart, Line, BarChart, Bar
} from "recharts";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../lib/utils";
import { InfoTooltip } from "../common/InfoTooltip";
import { skuService } from "../../lib/skuService";
import { SKUPerformance } from "../../types";
import { computeRowMetrics, resolveAvgDailySales, resolveParams, computeTwoStage } from "../../lib/inventoryModel";

interface BatchValues {
  inTransitArriveDays: string;
  leadTimeDays: string;
  safetyStockDays: string;
  inTransitStock: string;
  shipmentCycleDays: string;
  localStockCycles: string;
}

interface InventoryViewProps {
  skuPerformance: Record<string, SKUPerformance>;
  setSkuPerformance: React.Dispatch<React.SetStateAction<Record<string, SKUPerformance>>>;
  activeStoreId: string;
  restockTargetDays: number;
  setRestockTargetDays: React.Dispatch<React.SetStateAction<number>>;
  excludeInTransit: boolean;
  restockSku: string | null;
  setRestockSku: (s: string | null | ((prev: string | null) => string | null)) => void;
  restockMode: 'simulated' | string;
  isRestockLoading: boolean;
  savingSku: string | null;
  setSavingSku: React.Dispatch<React.SetStateAction<string | null>>;
  showBatchPanel: boolean;
  setShowBatchPanel: React.Dispatch<React.SetStateAction<boolean>>;
  batchValues: BatchValues;
  setBatchValues: React.Dispatch<React.SetStateAction<BatchValues>>;
  handleApplyBatchChanges: () => Promise<void>;
  handleRestockAnalyze: (skuPerf: SKUPerformance, overrideMode?: 'simulated' | string, forceReanalyze?: boolean) => Promise<void>;
  showToast: (message: string) => void;
}

export function InventoryView({
  skuPerformance,
  setSkuPerformance,
  activeStoreId,
  restockTargetDays,
  setRestockTargetDays,
  excludeInTransit,
  restockSku,
  setRestockSku,
  restockMode,
  isRestockLoading,
  savingSku,
  setSavingSku,
  showBatchPanel,
  setShowBatchPanel,
  batchValues,
  setBatchValues,
  handleApplyBatchChanges,
  handleRestockAnalyze,
  showToast,
}: InventoryViewProps) {
  return (
            <div className="p-8 space-y-8 max-w-[1550px] mx-auto animate-fade-in">
              {/* Header */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                <div>
                  <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
                    <Package className="text-indigo-600" size={24} /> 科学库存与备货管理
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    集成供应链 ROP（再订货点）与安全库存（Safety Stock）模型，通过历史销售流速预测精准采购备货量。
                  </p>
                </div>
                
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                  <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-2 border border-slate-200">
                    <span className="text-xs font-bold text-slate-600 tracking-wider">全局目标备货覆盖天数:</span>
                    <input 
                      type="number" 
                      value={restockTargetDays === 0 ? "" : restockTargetDays}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRestockTargetDays(val === "" ? 0 : parseInt(val) || 0);
                      }}
                      onBlur={() => {
                        if (restockTargetDays < 7) {
                          setRestockTargetDays(30);
                        }
                      }}
                      className="w-16 bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-center text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      title="当计算备货建议时，期望新备货进入后能支撑多少天的周转销量"
                    />
                    <span className="text-xs font-bold text-slate-500">天</span>
                  </div>
                </div>
              </div>

              {/* KPI Summary Rows */}
              {(() => {
                const currentStoreSkus = (Object.values(skuPerformance) as SKUPerformance[]).filter(s => s.storeId === activeStoreId);
                const totalFba = currentStoreSkus.reduce((acc, curr) => acc + (curr.currentStock || 0), 0);
                const totalLocal = currentStoreSkus.reduce((acc, curr) => acc + (curr.localStock ?? curr.rawMaterialStock ?? 0), 0);
                const activeSkuCount = currentStoreSkus.length;

                // 警戒 = 本期需要发往 FBA 的款数 (发往FBA > 0)
                const alertCount = currentStoreSkus.filter(s => {
                  const m = computeRowMetrics(s, restockTargetDays);
                  return m.shipToFbaQty > 0 || m.daysUntilFbaStockout !== -1;
                }).length;

                return (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">在管 SKU 款数</span>
                        <p className="text-3xl font-extrabold text-slate-900 tracking-tight">{activeSkuCount}</p>
                      </div>
                      <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl"><Layers size={20} /></div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">FBA 可售合计</span>
                        <p className="text-3xl font-extrabold text-slate-900 tracking-tight">{totalFba.toLocaleString()} 件</p>
                      </div>
                      <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl"><Package size={20} /></div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">本地成品合计</span>
                        <p className="text-3xl font-extrabold text-slate-900 tracking-tight">{totalLocal.toLocaleString()} 件</p>
                      </div>
                      <div className="p-3 bg-blue-50 text-blue-600 rounded-xl"><RefreshCw size={20} /></div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">需发往 FBA 款数</span>
                        <p className="text-3xl font-extrabold text-rose-600 tracking-tight">{alertCount} 款</p>
                      </div>
                      <div className={cn(
                        "p-3 rounded-xl",
                        alertCount > 0 ? "bg-rose-50 text-rose-600 animate-pulse" : "bg-emerald-50 text-emerald-600"
                      )}><AlertTriangle size={20} /></div>
                    </div>
                  </div>
                );
              })()}

              {/* Main Workspace splits */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 xl:h-[calc(100vh-320px)] xl:min-h-[600px] overflow-hidden">
                {/* SKU list table area */}
                <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col xl:h-full">
                  <div className="p-6 border-b border-slate-100 flex flex-col gap-4 bg-slate-50/50">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                      <div>
                        <h3 className="font-bold text-base text-slate-900">SKU 库存配给与备货控制台</h3>
                        <p className="text-xs text-slate-500 mt-0.5">直接修改输入框内的数据，失去焦点 (onBlur) 后系统后台将瞬时自动持久化保存。</p>
                      </div>
                      <button 
                        onClick={() => setShowBatchPanel(!showBatchPanel)}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100/80 text-indigo-700 font-bold text-xs rounded-lg transition-all border border-indigo-100/50 flex items-center gap-1.5 shadow-xs select-none"
                      >
                        <Zap size={13} className="text-indigo-600 animate-pulse" />
                        <span>{showBatchPanel ? "收起批量调整" : "⚡ 批量填写数据"}</span>
                      </button>
                    </div>

                    {showBatchPanel && (
                      <div className="p-4 bg-white border border-indigo-100 rounded-xl space-y-4 shadow-sm animate-fadeIn">
                        <div className="flex items-center gap-2 text-indigo-950 pb-1 border-b border-slate-100">
                          <Zap size={15} className="text-indigo-600 animate-pulse" />
                          <span className="text-xs font-black tracking-wider uppercase text-slate-800">批量快速填充控制台 (对当前店铺的所有 SKU 生效)</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="space-y-1">
                            <InfoTooltip
                              title="在途到仓天数 (Transit Days)"
                              content="已经在途运输的这批货物，预计大约还有多少天能够全部进入 FBA 并解冻上架成可售库存。"
                            >
                              <label className="text-[10px] font-bold text-slate-500 cursor-help block">在途到仓天数 (天)</label>
                            </InfoTooltip>
                            <input 
                              type="number" 
                              placeholder="如 15"
                              value={batchValues.inTransitArriveDays}
                              onChange={(e) => setBatchValues(prev => ({ ...prev, inTransitArriveDays: e.target.value }))}
                              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded px-2.5 py-1.5 text-xs outline-none text-slate-800 placeholder:text-slate-400 font-medium font-mono font-sans"
                            />
                          </div>
                          <div className="space-y-1">
                            <InfoTooltip
                              title="头程前置天数 (Lead Time - LT)"
                              content="从生成下一批大货采购需求、工厂排产、打包贴标、起运报关、海上漂流航程、最终并完全在上架的全生命周期总耗时。"
                            >
                              <label className="text-[10px] font-bold text-slate-500 cursor-help block">头程前置天数 (天)</label>
                            </InfoTooltip>
                            <input 
                              type="number" 
                              placeholder="如 30"
                              value={batchValues.leadTimeDays}
                              onChange={(e) => setBatchValues(prev => ({ ...prev, leadTimeDays: e.target.value }))}
                              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded px-2.5 py-1.5 text-xs outline-none text-slate-800 placeholder:text-slate-400 font-medium font-mono font-sans"
                            />
                          </div>
                          <div className="space-y-1">
                            <InfoTooltip
                              title="安全缓冲天数 (Safety Stock Days - SS)"
                              content="希望预留的应急安全水位折算天数，当供应链遇到不可控延误（如查验、海船拥堵）时，缓冲库能为您纠偏防范断货风险。"
                            >
                              <label className="text-[10px] font-bold text-slate-500 cursor-help block">安全缓冲天数 (天)</label>
                            </InfoTooltip>
                            <input 
                              type="number" 
                              placeholder="如 15"
                              value={batchValues.safetyStockDays}
                              onChange={(e) => setBatchValues(prev => ({ ...prev, safetyStockDays: e.target.value }))}
                              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded px-2.5 py-1.5 text-xs outline-none text-slate-800 placeholder:text-slate-400 font-medium font-mono font-sans"
                            />
                          </div>
                          <div className="space-y-1">
                            <InfoTooltip
                              title="在途数量 (In-transit)"
                              content="已经采购发出，正在处于装集装箱、海运中或者在等待海关验关，即将入库亚马逊的库存储备数量。"
                            >
                              <label className="text-[10px] font-bold text-slate-500 cursor-help block">在途数量 (件, 可选)</label>
                            </InfoTooltip>
                            <input 
                              type="number" 
                              placeholder="全局在途"
                              value={batchValues.inTransitStock}
                              onChange={(e) => setBatchValues(prev => ({ ...prev, inTransitStock: e.target.value }))}
                              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded px-2.5 py-1.5 text-xs outline-none text-slate-800 placeholder:text-slate-400 font-medium font-mono font-sans"
                            />
                          </div>
                          <div className="space-y-1">
                            <InfoTooltip
                              title="发货周期天数 (Shipment Cycle)"
                              content="你大约多久发一次货去 FBA（如 30 天发一次）。影响发往 FBA 和采购回仓两个建议量的覆盖期。"
                            >
                              <label className="text-[10px] font-bold text-slate-500 cursor-help block">发货周期 (天)</label>
                            </InfoTooltip>
                            <input 
                              type="number" 
                              placeholder="如 30"
                              value={batchValues.shipmentCycleDays}
                              onChange={(e) => setBatchValues(prev => ({ ...prev, shipmentCycleDays: e.target.value }))}
                              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded px-2.5 py-1.5 text-xs outline-none text-slate-800 placeholder:text-slate-400 font-medium font-mono font-sans"
                            />
                          </div>
                          <div className="space-y-1">
                            <InfoTooltip
                              title="本地常备周期数 (Local Stock Cycles)"
                              content="本地仓库常备几个发货周期的成品。1 = 滚动补货不囤(资金压力小); 长尾 SKU 可调高为 2~3 一次多囤几批。"
                            >
                              <label className="text-[10px] font-bold text-slate-500 cursor-help block">本地常备周期数</label>
                            </InfoTooltip>
                            <input 
                              type="number" 
                              min={1}
                              placeholder="如 1"
                              value={batchValues.localStockCycles}
                              onChange={(e) => setBatchValues(prev => ({ ...prev, localStockCycles: e.target.value }))}
                              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded px-2.5 py-1.5 text-xs outline-none text-slate-800 placeholder:text-slate-400 font-medium font-mono font-sans"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pt-2 border-t border-slate-100">
                          <span className="text-[10px] text-slate-400 font-bold">* 提示：批量应用后会清空当前店铺 SKU 的单包预测缓存，需点击 “AI/备货分析” 重绘最新诊断。</span>
                          <div className="flex gap-2 self-end sm:self-auto">
                            <button
                              onClick={() => {
                                setBatchValues({ inTransitArriveDays: "", leadTimeDays: "", safetyStockDays: "", inTransitStock: "", shipmentCycleDays: "", localStockCycles: "" });
                                showToast("已清空输入项");
                              }}
                              className="px-2.5 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-800 transition-colors"
                            >
                              清空输入
                            </button>
                            <button
                              onClick={handleApplyBatchChanges}
                              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-black text-xs rounded-lg transition-all flex items-center gap-1 shadow-sm"
                            >
                              <CheckCircle2 size={12} />
                              <span>立即一键覆盖应用</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto overflow-x-auto min-h-[350px]">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-[#F8FAFC] border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                        <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          <th className="py-4 px-4">
                            <InfoTooltip
                              title="SKU / 备注名"
                              content="库存唯一识别编码 (SKU)。您可以点击下方文本框添加自定义备注名称（如中文名、产品线等），以便进行日常备货识别。"
                              position="bottom"
                            >
                              <span>SKU / 备注名</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-3 text-center">
                            <InfoTooltip
                              title="FBA 可售库存 (Current On-hand)"
                              content="亚马逊 FBA 端的实货可售数量。这是顾客下单时实际能发货的库存。"
                              position="bottom"
                            >
                              <span>FBA可售</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-3 text-center">
                            <InfoTooltip
                              title="去 FBA 在途 (In-transit to FBA)"
                              content="已经从你本地仓库发出、正在运往亚马逊 FBA 途中的货。到仓后即变为 FBA 可售。"
                              position="bottom"
                            >
                              <span>去FBA在途</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-3 text-center">
                            <InfoTooltip
                              title="本地仓库成品 (Local Finished Goods)"
                              content="你本地仓库里已经包装好、随时可以发往 FBA 的成品数量。发往 FBA 的货就是从这里发出。"
                              position="bottom"
                            >
                              <span>本地成品</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-3 text-center">
                            <InfoTooltip
                              title="去 FBA 在途到仓天数"
                              content="本地发出的货运到 FBA 并完成上架变为可售，预计还需多少天。"
                              position="bottom"
                            >
                              <span>到仓(天)</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-3 text-center">
                            <InfoTooltip
                              title="采购到可发货天数 (Procurement Lead Time)"
                              content="从下采购单到货物到本地仓库、包装好可以发往 FBA 的合并前置天数。"
                              position="bottom"
                            >
                              <span>采购前置(天)</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-3 text-center">
                            <InfoTooltip
                              title="安全缓冲天数 (Safety Stock Days - SS)"
                              content="为应对清关滞留、旺季塞港、海运延误或销量暴涨等异常，预备的缓冲天数，防止被动断货流失排名。"
                              position="bottom"
                            >
                              <span>安全缓冲(天)</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-3 text-center">
                            <InfoTooltip
                              title="本地常备周期数 (Local Stock Cycles)"
                              content="本地仓库希望常备多少个发货周期的成品。1 = 滚动补货不囤(发走后再采购下一批, 资金压力小); 销量小的长尾 SKU 可调高为 2~3, 一次多囤几批省得频繁下单。"
                              position="bottom"
                            >
                              <span>常备周期</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-3 text-center">
                            <InfoTooltip
                              title="距离 FBA 断货 (Days Until Stockout)"
                              content="如果什么都不做, FBA 端预计第几天卖到 0。已考虑去 FBA 在途货物的到仓时点(逐日仿真)。这是判断'急不急'的指标。"
                              position="bottom"
                            >
                              <span>距离断货</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-3 text-center">
                            <InfoTooltip
                              title="本期发往 FBA (Ship to FBA)"
                              content="这次该从本地成品里发多少去亚马逊, 让 FBA 端撑过(发货周期+到仓天数+安全缓冲)。受本地成品约束, 不够发会提示。这是判断'发多少'的指标。"
                              position="bottom"
                            >
                              <span>发往FBA</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-3 text-center">
                            <InfoTooltip
                              title="本期采购回仓 (Procure)"
                              content="本地仓库这次该补采购多少成品。按你设的'常备周期数'恢复本地水位, 并覆盖采购前置期消耗。"
                              position="bottom"
                            >
                              <span>采购回仓</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-4 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {(() => {
                          const currentStoreSkus = (Object.values(skuPerformance) as SKUPerformance[]).filter(s => s.storeId === activeStoreId);
                          if (currentStoreSkus.length === 0) {
                            return (
                              <tr>
                                <td colSpan={11} className="py-12 text-center text-slate-400">
                                  暂无 SKU 数据。请先前往 “数据导入” 页面上传销售与在库 CSV/TXT 文件。
                                </td>
                              </tr>
                            );
                          }
                          
                          const handleInstantSaveField = async (skuObj: SKUPerformance, field: string, val: any) => {
                            setSavingSku(`${skuObj.sku}_${field}`);
                            
                            const updatedSku = {
                              ...skuObj,
                              [field]: val
                            };
                            
                            setSkuPerformance(prev => ({
                              ...prev,
                              [skuObj.sku]: updatedSku
                            }));
                            
                            await skuService.saveSku(updatedSku);
                            
                            setTimeout(() => {
                              setSavingSku(null);
                            }, 500);
                          };

                          return currentStoreSkus.map(s => {
                            const avgDailySales = resolveAvgDailySales(s);

                            const currentStock = s.currentStock ?? 0;        // FBA 可售
                            const localStock = s.localStock ?? s.rawMaterialStock ?? 0; // 本地仓库成品
                            const inTransitStock = s.inTransitStock ?? 0;     // 去 FBA 在途
                            const leadTimeDays = s.leadTimeDays ?? 30;
                            const safetyStockDays = s.safetyStockDays ?? 15;

                            // 两段式补货决策 + FBA 真实断货天数 (全局统一计算)
                            const m = computeRowMetrics(s, restockTargetDays);
                            const shipToFbaQty = m.shipToFbaQty;
                            const shipToFbaConstrained = m.shipToFbaConstrained;
                            const procureQty = m.procureQty;
                            const daysUntilStockout = m.daysUntilFbaStockout; // -1 表示覆盖期内不断货

                            return (
                              <tr 
                                key={`${s.sku}_${currentStock}_${localStock}_${inTransitStock}_${s.inTransitArriveDays ?? 15}_${leadTimeDays}_${safetyStockDays}_${s.localStockCycles ?? 1}`} 
                                className={cn(
                                  "transition-all cursor-pointer group",
                                  restockSku === s.sku ? "bg-indigo-100/60 shadow-[inset_0_1px_0_0_rgba(165,180,252,0.4),_inset_0_-1px_0_0_rgba(165,180,252,0.4)]" : "hover:bg-slate-50/70"
                                )}
                                onClick={() => setRestockSku(s.sku)}
                              >
                                {/* SKU Info */}
                                <td className={cn("py-4 px-4 max-w-[200px] transition-all duration-150", restockSku === s.sku ? "border-l-4 border-indigo-600 pl-3" : "border-l-4 border-transparent pl-3")}>
                                  <div className="font-bold text-slate-950 break-words">{s.sku}</div>
                                  <input 
                                    type="text" 
                                    defaultValue={s.name || ""} 
                                    onBlur={(e) => handleInstantSaveField(s, 'name', e.target.value)}
                                    placeholder="备注该 SKU"
                                    className="text-[10px] bg-transparent text-slate-400 hover:text-slate-600 focus:text-slate-700 outline-none w-full border-b border-transparent focus:border-indigo-400 py-0.5 transition-all"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                </td>

                                {/* Current On-hand Stock */}
                                <td className="py-4 px-3 text-center whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1">
                                    <input 
                                      type="number" 
                                      defaultValue={currentStock} 
                                      onBlur={(e) => handleInstantSaveField(s, 'currentStock', parseInt(e.target.value) || 0)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-16 bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded px-1.5 py-1 text-center font-semibold text-slate-800 outline-none text-xs"
                                    />
                                    {savingSku === `${s.sku}_currentStock` && <Loader2 size={10} className="text-slate-400 animate-spin" />}
                                  </div>
                                </td>

                                {/* In transit stock */}
                                <td className="py-4 px-3 text-center whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1.5">
                                    <input 
                                      type="number" 
                                      value={inTransitStock} 
                                      disabled={s.inTransitBatches && s.inTransitBatches.length > 0}
                                      onChange={(e) => {
                                        if (!s.inTransitBatches || s.inTransitBatches.length === 0) {
                                          handleInstantSaveField(s, 'inTransitStock', parseInt(e.target.value) || 0);
                                        }
                                      }}
                                      onBlur={(e) => {
                                        if (!s.inTransitBatches || s.inTransitBatches.length === 0) {
                                          handleInstantSaveField(s, 'inTransitStock', parseInt(e.target.value) || 0);
                                        }
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      title={s.inTransitBatches && s.inTransitBatches.length > 0 ? "已启用多批次在途物流，总量由各批次合并计算。可在右侧看板增删微调。" : ""}
                                      className={cn(
                                        "w-16 text-center font-semibold rounded px-1.5 py-1 text-xs outline-none",
                                        s.inTransitBatches && s.inTransitBatches.length > 0
                                          ? "bg-indigo-50 border border-indigo-150 text-indigo-700 font-bold"
                                          : "bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 text-slate-800"
                                      )}
                                    />
                                    {s.inTransitBatches && s.inTransitBatches.length > 0 && (
                                      <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded cursor-help" title="多批次追踪中">
                                        {s.inTransitBatches.length}批
                                      </span>
                                    )}
                                    {savingSku === `${s.sku}_inTransitStock` && <Loader2 size={10} className="text-slate-400 animate-spin" />}
                                  </div>
                                </td>

                                {/* Local warehouse finished goods */}
                                <td className="py-4 px-3 text-center whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1">
                                    <input 
                                      type="number" 
                                      defaultValue={localStock} 
                                      onBlur={(e) => handleInstantSaveField(s, 'localStock', parseInt(e.target.value) || 0)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-16 bg-emerald-50/40 border border-emerald-200/60 focus:bg-white focus:border-emerald-500 rounded px-1.5 py-1 text-center font-semibold text-emerald-800 outline-none text-xs"
                                      title="本地仓库已包装好、随时可发往 FBA 的成品数量"
                                    />
                                    {savingSku === `${s.sku}_localStock` && <Loader2 size={10} className="text-emerald-400 animate-spin" />}
                                  </div>
                                </td>

                                {/* In transit arrive prediction days */}
                                <td className="py-4 px-3 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                  <div className="inline-flex items-center gap-1">
                                    <input 
                                      type="number" 
                                      defaultValue={s.inTransitArriveDays ?? 15} 
                                      onBlur={(e) => handleInstantSaveField(s, 'inTransitArriveDays', parseInt(e.target.value) || 0)}
                                      className="w-12 bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/15 focus:bg-white focus:border-amber-500 rounded px-1.5 py-1 text-center font-semibold text-amber-700 outline-none text-xs"
                                      title="修改此项可直接改变未来在途预计第几天到仓上架"
                                    />
                                    {savingSku === `${s.sku}_inTransitArriveDays` && <Loader2 size={10} className="text-amber-500 animate-spin" />}
                                  </div>
                                </td>

                                {/* Procurement Lead Days (reuse leadTimeDays field) */}
                                <td className="py-4 px-3 text-center whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1">
                                    <input 
                                      type="number" 
                                      defaultValue={leadTimeDays} 
                                      onBlur={(e) => handleInstantSaveField(s, 'leadTimeDays', parseInt(e.target.value) || 0)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-12 bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded px-1.5 py-1 text-center text-slate-600 outline-none text-xs"
                                      title="从下采购单到货物可发往 FBA 的合并前置天数"
                                    />
                                    {savingSku === `${s.sku}_leadTimeDays` && <Loader2 size={10} className="text-slate-400 animate-spin" />}
                                  </div>
                                </td>

                                {/* Safety Stock Days */}
                                <td className="py-4 px-3 text-center whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1">
                                    <input 
                                      type="number" 
                                      defaultValue={safetyStockDays} 
                                      onBlur={(e) => handleInstantSaveField(s, 'safetyStockDays', parseInt(e.target.value) || 0)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-12 bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded px-1.5 py-1 text-center text-slate-600 outline-none text-xs"
                                    />
                                    {savingSku === `${s.sku}_safetyStockDays` && <Loader2 size={10} className="text-slate-400 animate-spin" />}
                                  </div>
                                </td>

                                {/* Local stock cycles */}
                                <td className="py-4 px-3 text-center whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1">
                                    <input 
                                      type="number" 
                                      min={1}
                                      defaultValue={s.localStockCycles ?? 1} 
                                      onBlur={(e) => handleInstantSaveField(s, 'localStockCycles', Math.max(1, parseInt(e.target.value) || 1))}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-12 bg-violet-50/50 border border-violet-200/60 focus:bg-white focus:border-violet-500 rounded px-1.5 py-1 text-center font-semibold text-violet-700 outline-none text-xs"
                                      title="本地常备几个发货周期。1=滚动补货不囤; 长尾 SKU 调高一次多囤几批"
                                    />
                                    {savingSku === `${s.sku}_localStockCycles` && <Loader2 size={10} className="text-violet-400 animate-spin" />}
                                  </div>
                                </td>

                                {/* Days until FBA stockout */}
                                <td className="py-4 px-3 text-center whitespace-nowrap">
                                  {daysUntilStockout === -1 ? (
                                    <span className="px-2 py-1 rounded-full text-[10px] font-extrabold border block w-16 mx-auto text-center bg-emerald-50 text-emerald-600 border-emerald-100" title="覆盖期内 FBA 端不会断货">
                                      充足
                                    </span>
                                  ) : (
                                    <span className={cn(
                                      "px-2 py-1 rounded-full text-[10px] font-extrabold border block w-16 mx-auto text-center",
                                      daysUntilStockout >= 45 ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                                      daysUntilStockout >= 15 ? "bg-amber-50 text-amber-600 border-amber-100" :
                                      "bg-rose-50 text-rose-600 border-rose-100 animate-pulse"
                                    )} title="如果什么都不做, FBA 端预计第几天卖到 0 (已含去 FBA 在途到货)">
                                      {daysUntilStockout} 天
                                    </span>
                                  )}
                                </td>

                                {/* Ship to FBA */}
                                <td className="py-4 px-3 text-center whitespace-nowrap">
                                  {shipToFbaQty > 0 ? (
                                    <div className="inline-flex flex-col items-center gap-0.5">
                                      <span className="px-2.5 py-1 rounded-lg text-xs font-extrabold bg-indigo-600 text-white block min-w-[3rem] text-center">
                                        {shipToFbaQty}
                                      </span>
                                      {shipToFbaConstrained && (
                                        <span className="text-[9px] text-rose-500 font-bold" title="本地成品不足以发出建议量, 需先采购补充本地成品">
                                          本地不足
                                        </span>
                                      )}
                                    </div>
                                  ) : shipToFbaConstrained ? (
                                    <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-100 inline-block" title="FBA 需要补货, 但本地成品为 0, 无货可发, 需先采购">
                                      本地不足
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 font-medium">暂无需</span>
                                  )}
                                </td>

                                {/* Procure to local */}
                                <td className="py-4 px-3 text-center whitespace-nowrap">
                                  {procureQty > 0 ? (
                                    <span className="px-2.5 py-1 rounded-lg text-xs font-extrabold bg-emerald-600 text-white block min-w-[3rem] mx-auto text-center">
                                      {procureQty}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 font-medium">暂无需</span>
                                  )}
                                </td>

                                {/* Action trigger */}
                                <td className="py-4 px-4 text-right whitespace-nowrap">
                                  <div className="flex justify-end items-center gap-1.5">
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRestockAnalyze(s);
                                      }}
                                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold text-[11px] rounded-lg shadow-sm hover:shadow-xs transition-all flex items-center gap-1 shrink-0"
                                      title="打开详情: 时间轴仿真曲线 + AI 与本地模型建议量对比"
                                    >
                                      <BrainCircuit size={12} />
                                      详情/AI
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Right side diagnostics */}
                <div className="xl:col-span-1 flex flex-col xl:h-full overflow-hidden">
                  {restockSku && skuPerformance[restockSku] ? (
                    (() => {
                      const sObj = skuPerformance[restockSku];
                      const insight = sObj.restockInsight;
                      const hasResult = !!insight;
                      const isStale = hasResult && (
                        sObj.currentStock !== (insight.currentStock ?? sObj.currentStock) ||
                        (sObj.localStock ?? sObj.rawMaterialStock ?? 0) !== (insight.localStock ?? sObj.localStock ?? sObj.rawMaterialStock ?? 0) ||
                        sObj.inTransitStock !== (insight.inTransitStock ?? sObj.inTransitStock) ||
                        JSON.stringify(sObj.inTransitBatches || []) !== JSON.stringify(insight.inTransitBatches || [])
                      );
                      
                      const h = sObj.history || [];
                      const localAvg = resolveAvgDailySales(sObj);
                      const currentStock = sObj.currentStock ?? 0;
                      const inTransitStock = sObj.inTransitStock ?? 0;
                      const localStock = sObj.localStock ?? sObj.rawMaterialStock ?? 0;
                      // 本地两段式模型 (确定性), 用于空态估算 + 与 AI 结果对比
                      const localModel = computeTwoStage(resolveParams(sObj), restockTargetDays);
                      const localReplenish = localModel.procureQty;

                      return (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col xl:h-full">
                          {/* Panel Header */}
                          <div className="p-6 border-b border-indigo-950 bg-[#0F172A] text-white flex justify-between items-center bg-gradient-to-r from-slate-900 to-indigo-950">
                            <div>
                              <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">AI 补货科学诊断书</p>
                              <h4 className="font-extrabold text-base tracking-tight mt-0.5 break-all">{restockSku}</h4>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {hasResult && (
                                <button
                                  onClick={() => handleRestockAnalyze(sObj, restockMode, true)}
                                  className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-[10px] text-white font-extrabold rounded-md shadow-xs flex items-center gap-1 transition-all border border-indigo-500/30"
                                  title="重新运行当前策略的 AI 深度供应链诊断测算"
                                >
                                  <RefreshCw size={10} className={cn(isRestockLoading && "animate-spin")} />
                                  <span>重新运行预测</span>
                                </button>
                              )}
                              <div className="px-2 py-0.5 bg-indigo-500/20 border border-indigo-400/30 rounded text-[9px] uppercase tracking-wider text-indigo-300 font-mono">
                                {sObj.name || "正常监控"}
                              </div>
                            </div>
                          </div>

                          <div className="flex-1 overflow-y-auto pr-1">
                            {/* Replenishment Simulated Model Header */}
                          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex flex-col gap-1.5">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">计算策略模型</span>
                            <div className="flex items-center gap-2 bg-white px-3 py-2.5 rounded-xl border border-slate-200/60 shadow-xs">
                              <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                                <BrainCircuit size={14} />
                              </div>
                              <div>
                                <h5 className="text-[11px] font-bold text-[#0F172A] flex items-center gap-1.5">
                                  智能防断货模型
                                  <span className="bg-emerald-100 text-emerald-700 text-[8px] px-1 py-0.2 rounded font-mono font-medium">推荐启用</span>
                                </h5>
                                <p className="text-[9px] text-slate-400 font-normal leading-tight mt-0.5">采用时间轴投影高阶仿真算法对齐未来到货时间真空</p>
                              </div>
                            </div>
                          </div>

                          {/* Multi-batch In-Transit Shipment Split Manager */}
                          <div className="px-5 py-4 border-b border-slate-100 bg-indigo-50/20 text-slate-700">
                            <div className="flex justify-between items-center mb-2">
                              <div className="flex items-center gap-1.5">
                                <PackageOpen size={14} className="text-indigo-600" />
                                <span className="text-xs font-bold text-slate-700">在途多批次物流追踪与到货对齐</span>
                              </div>
                              <span className="text-[10px] text-slate-400 font-mono">
                                共 {(sObj.inTransitBatches || []).length} 批 (共 {(sObj.inTransitBatches || []).reduce((sum, b) => sum + (Number(b.quantity) || 0), 0)} 件)
                              </span>
                            </div>

                            {/* Batches list */}
                            {(sObj.inTransitBatches || []).length > 0 ? (
                              <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1 mb-3">
                                {(sObj.inTransitBatches || []).map((batch, idx) => (
                                  <div key={batch.id} className="flex justify-between items-center bg-white p-2 rounded-lg border border-indigo-100 shadow-xs text-[11px]">
                                    <div className="flex flex-col">
                                      <span className="font-semibold text-slate-800">批次 {idx + 1}: <span className="text-indigo-600 font-bold">{batch.quantity}</span> 件</span>
                                      <span className="text-[9px] text-slate-400 font-medium">预计未来第 <span className="text-amber-600 font-bold">{batch.arriveDays}</span> 天上架 • {batch.remark || "未标注"}</span>
                                    </div>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const updatedBatches = (sObj.inTransitBatches || []).filter(b => b.id !== batch.id);
                                        const newSum = updatedBatches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
                                        const updatedSku = {
                                          ...sObj,
                                          inTransitBatches: updatedBatches,
                                          inTransitStock: newSum
                                        };
                                        setSkuPerformance(prev => ({
                                          ...prev,
                                          [sObj.sku]: updatedSku
                                        }));
                                        skuService.saveSku(updatedSku);
                                        showToast("🗑️ 已成功在本地移除在途批次。下方分析已过期，请手动点击“重新运行预测”已对齐最新数据！");
                                      }}
                                      className="text-rose-500 hover:text-rose-700 p-1 hover:bg-rose-50 rounded transition-all cursor-pointer"
                                      title="删除此批次"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-center p-3 border border-dashed border-indigo-100 rounded-lg text-[10px] text-slate-400 mb-3 leading-relaxed bg-white/60">
                                当前处于单一在途合并模式 ({sObj.inTransitStock || 0} 件，第 {sObj.inTransitArriveDays ?? 15} 天一并到货)。
                                <br />
                                <span className="text-indigo-500 font-semibold">新增下方多个分批在途货件，即可启用每日精准的时间轴折旧推算仿真！</span>
                              </div>
                            )}

                            {/* Form to add a new batch */}
                            <div className="bg-white p-2.5 rounded-lg border border-indigo-100/60 flex flex-col gap-2 shadow-xs">
                              <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wide">登记新一批 在途货件</span>
                              <div className="grid grid-cols-3 gap-1.5">
                                <div>
                                  <label className="text-[9px] text-slate-400 block mb-1">数量 (件)</label>
                                  <input 
                                    id="new-batch-qty"
                                    type="number" 
                                    placeholder="数量" 
                                    className="w-full text-xs border border-slate-200 rounded px-1.5 py-1 outline-none text-right focus:border-indigo-500 font-mono font-bold"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] text-slate-400 block mb-1">预计到达天数</label>
                                  <input 
                                    id="new-batch-days"
                                    type="number" 
                                    placeholder="第几天" 
                                    className="w-full text-xs border border-slate-200 rounded px-1.5 py-1 outline-none text-right focus:border-indigo-500 font-mono font-bold"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] text-slate-400 block mb-1 font-medium">物流备注</label>
                                  <input 
                                    id="new-batch-remark"
                                    type="text" 
                                    placeholder="如: 美森快船" 
                                    className="w-full text-xs border border-slate-200 rounded px-1.5 py-1 outline-none focus:border-indigo-500 font-sans"
                                  />
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  const qtyInput = document.getElementById("new-batch-qty") as HTMLInputElement;
                                  const daysInput = document.getElementById("new-batch-days") as HTMLInputElement;
                                  const remarkInput = document.getElementById("new-batch-remark") as HTMLInputElement;
                                  
                                  const qty = parseInt(qtyInput?.value || "0");
                                  const days = parseInt(daysInput?.value || "0");
                                  const remark = remarkInput?.value || "";

                                  if (!qty || qty <= 0 || !days || days <= 0) {
                                    showToast("❌ 请输入有效的在途数量与预计到达天数！");
                                    return;
                                  }

                                  const newBatch = {
                                    id: 'batch_' + Date.now(),
                                    quantity: qty,
                                    arriveDays: days,
                                    remark: remark || "在途货件"
                                  };

                                  const existingBatches = sObj.inTransitBatches || [];
                                  const updatedBatches = [...existingBatches, newBatch];
                                  const newSum = updatedBatches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);

                                  const updatedSku = {
                                    ...sObj,
                                    inTransitBatches: updatedBatches,
                                    inTransitStock: newSum
                                  };

                                  setSkuPerformance(prev => ({
                                    ...prev,
                                    [sObj.sku]: updatedSku
                                  }));
                                  skuService.saveSku(updatedSku);

                                  // Clear inputs
                                  if (qtyInput) qtyInput.value = "";
                                  if (daysInput) daysInput.value = "";
                                  if (remarkInput) remarkInput.value = "";

                                  showToast("📦 在途货件登记成功！各项参数已录入。如需更新分析结论，请手动点击右上方“重新运行预测”。");
                                }}
                                className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-all shadow-xs cursor-pointer active:scale-95"
                              >
                                <Plus size={10} />
                                <span>添加并在时间轴上注册该货件</span>
                              </button>
                            </div>
                          </div>

                          <AnimatePresence mode="wait">
                            {isRestockLoading ? (
                              <motion.div 
                                key="loading"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="p-12 text-center flex flex-col items-center justify-center space-y-4"
                              >
                                <Loader2 className="text-indigo-600 animate-spin" size={32} />
                                <div className="space-y-1">
                                  <p className="font-bold text-sm text-slate-800">正在生成科学采购建议...</p>
                                  <p className="text-[10px] text-slate-400 max-w-[200px]">AI 正在获取最近 {h.length} 周的订单流速、头程时限，计算安全缓冲以预防断货。</p>
                                </div>
                              </motion.div>
                            ) : hasResult ? (
                              <motion.div 
                                key="content"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="p-6 space-y-6"
                              >
                                {isStale && (
                                  <div className="p-3.5 bg-amber-50 border border-amber-200/60 rounded-xl flex items-start gap-2.5 text-amber-800 text-[11px] leading-relaxed">
                                    <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                                    <div>
                                      <p className="font-bold text-amber-950 flex items-center gap-1">
                                        <span>⚠️ 仓储参数或在途货件已更新</span>
                                      </p>
                                      <p className="text-amber-700 mt-0.5">
                                        检测到您刚更新了该产品的备货明细，当前展示预测仍是历史快照。请点击面板右上角 <span className="font-extrabold text-indigo-700">“重新运行预测”</span> 按钮，手动重新计算新一期防断货仿真与采购方案！
                                      </p>
                                    </div>
                                  </div>
                                )}

                                {/* Metrics Grid */}
                                <div className="grid grid-cols-2 gap-3.5">
                                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex flex-col justify-between">
                                    <InfoTooltip
                                      title="预测日均销量 (Avg Daily Sales)"
                                      content="基于您上传的销售历史订单流速，经多周期根据近期销量进行平滑加权得出的未来天平均销量基准，是评估库存周期的基础因子。"
                                    >
                                      <p className="text-[10px] text-slate-400 font-bold uppercase mb-0.5 leading-normal cursor-help">预测日均销量</p>
                                    </InfoTooltip>
                                    <p className="text-lg font-extrabold text-slate-900 font-mono mt-0.5">{insight.avgDailySales.toFixed(2)} <span className="text-[10px] font-semibold text-slate-500">件/日</span></p>
                                  </div>
                                  <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl flex flex-col justify-between">
                                    <InfoTooltip
                                      title="头程消耗 (LTD, Lead Time Demand)"
                                      content="在前置发货期（Lead Time：生产+到仓）内预计销售消费消耗的库存。公式：LTD = 预测日均销量 × 头程前置天数。"
                                      iconColorClass="text-amber-500/80 hover:text-amber-600"
                                    >
                                      <p className="text-[10px] text-amber-600 font-bold uppercase mb-0.5 leading-normal cursor-help">头程消耗 (LTD)</p>
                                    </InfoTooltip>
                                    <p className="text-lg font-extrabold text-amber-700 font-mono mt-0.5">{Math.round(insight.leadTimeDemand)} <span className="text-[10px] font-semibold text-slate-500">件</span></p>
                                  </div>
                                  <div className="p-3 bg-blue-50 border border-blue-100/50 rounded-xl flex flex-col justify-between">
                                    <InfoTooltip
                                      title="安全库存缓冲 (SS, Safety Stock)"
                                      content="为化解物流迟延、工厂产能不足或短期出货量旺盛带来的断货危机，而建立的安全缓冲积蓄余量。公式：SS = 预测日均销量 × 安全缓冲天数。"
                                      iconColorClass="text-blue-500/80 hover:text-blue-600"
                                    >
                                      <p className="text-[10px] text-blue-500 font-bold uppercase mb-0.5 leading-normal cursor-help">安全库存缓冲 (SS)</p>
                                    </InfoTooltip>
                                    <p className="text-lg font-extrabold text-blue-700 font-mono mt-0.5">{Math.round(insight.safetyStock)} <span className="text-[10px] font-semibold text-slate-500">件</span></p>
                                  </div>
                                  <div className="p-3 bg-indigo-50 border border-indigo-100/50 rounded-xl flex flex-col justify-between">
                                    <InfoTooltip
                                      title="科学再订货点 (ROP, Reorder Point)"
                                      content="采购起航的水位红线。当在库在途总可用库存等于或少于该值时，应立即开启大货下单，以承接补货期间的销售流速需求。公式：ROP = LTD + SS。"
                                      iconColorClass="text-indigo-500/80 hover:text-indigo-600"
                                    >
                                      <p className="text-[10px] text-indigo-500 font-bold uppercase mb-0.5 leading-normal cursor-help">科学再订货点 (ROP)</p>
                                    </InfoTooltip>
                                    <p className="text-lg font-extrabold text-indigo-900 font-mono mt-0.5">{Math.round(insight.reorderPoint)} <span className="text-[10px] font-semibold text-slate-500">件</span></p>
                                  </div>
                                </div>

                                {/* Simulation Future Stock Timeline Chart */}
                                {insight.timelineSim && insight.timelineSim.length > 0 && (
                                  <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 text-white space-y-3">
                                    <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                                      <div className="flex items-center gap-1.5">
                                        <TrendingUp size={12} className="text-emerald-400" />
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">未来库存天级动态投影仿真</span>
                                      </div>
                                      <span className="text-[8px] px-1.5 py-0.5 bg-indigo-500/20 rounded font-bold text-indigo-300">
                                        <InfoTooltip
                                          title="安全警戒水位线 (SS)"
                                          content="即安全库存缓冲水平。天级动态仿真中预测曲线降至此线之下时，说明您的库存缓冲开始受损，需格外防范断货风险。"
                                          iconColorClass="text-indigo-300/80 hover:text-indigo-100"
                                        >
                                          <span>安全警戒线: {Math.round(insight.safetyStock)}</span>
                                        </InfoTooltip>
                                      </span>
                                    </div>
                                    <div className="h-28 w-full text-[9px]">
                                      <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart
                                          data={insight.timelineSim}
                                          margin={{ top: 5, right: 5, left: -25, bottom: 0 }}
                                        >
                                          <defs>
                                            <linearGradient id="colorStock" x1="0" y1="0" x2="0" y2="1">
                                              <stop offset="5%" stopColor="#818cf8" stopOpacity={0.4}/>
                                              <stop offset="95%" stopColor="#818cf8" stopOpacity={0.0}/>
                                            </linearGradient>
                                          </defs>
                                          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                                          <XAxis 
                                            dataKey="day" 
                                            stroke="#64748b" 
                                            tickLine={false} 
                                            tickFormatter={(v) => `第${v}天`}
                                          />
                                          <YAxis stroke="#64748b" tickLine={false} />
                                          <Tooltip 
                                            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }}
                                            labelStyle={{ color: '#94a3b8', fontWeight: 'bold' }}
                                            itemStyle={{ color: '#ffffff' }}
                                            formatter={(value: any) => [`${value} 件`, '模拟库存值']}
                                            labelFormatter={(label) => `预估未来第 ${label} 天`}
                                          />
                                          <Area 
                                            type="monotone" 
                                            dataKey="stock" 
                                            stroke="#818cf8" 
                                            strokeWidth={2}
                                            fillOpacity={1} 
                                            fill="url(#colorStock)" 
                                          />
                                        </AreaChart>
                                      </ResponsiveContainer>
                                    </div>
                                    <div className="text-[9px] text-slate-400 leading-normal flex justify-between">
                                      <span>* 到货预计时间: 第 <span className="font-bold text-amber-400">{insight.inTransitArriveDays || 15}</span> 天</span>
                                      <span>状态: <span className="font-bold text-emerald-400">已启用科学时间差预警</span></span>
                                    </div>
                                  </div>
                                )}

                                {/* Two-stage decision cards */}
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100 text-center space-y-1">
                                    <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">本期发往 FBA</p>
                                    <p className="text-3xl font-black text-indigo-700 font-mono tracking-tight">{(insight.shipToFbaQty ?? 0).toLocaleString()} <span className="text-xs font-bold">件</span></p>
                                    {insight.shipToFbaConstrained ? (
                                      <p className="text-[10px] font-bold text-rose-500 leading-normal">本地成品不足, 需先采购补充本地</p>
                                    ) : (
                                      <p className="text-[10px] font-medium text-slate-400 leading-normal">从本地成品发出, 让 FBA 撑过发货周期+到仓+安全缓冲</p>
                                    )}
                                  </div>
                                  <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 text-center space-y-1">
                                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">本期采购回仓</p>
                                    <p className="text-3xl font-black text-emerald-700 font-mono tracking-tight">{(insight.procureQty ?? insight.suggestedQuantity ?? 0).toLocaleString()} <span className="text-xs font-bold">件</span></p>
                                    <p className="text-[10px] font-medium text-slate-400 leading-normal">补本地成品到常备 {sObj.localStockCycles ?? 1} 个发货周期</p>
                                  </div>
                                </div>

                                {/* FBA stockout + AI vs local comparison */}
                                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2 text-[11px]">
                                  <div className="flex justify-between text-slate-600">
                                    <span>FBA 距离断货 (逐日仿真):</span>
                                    <span className={cn("font-mono font-bold", (insight.daysUntilFbaStockout ?? -1) === -1 ? "text-emerald-600" : (insight.daysUntilFbaStockout ?? 99) < 15 ? "text-rose-600" : "text-amber-600")}>
                                      {(insight.daysUntilFbaStockout ?? -1) === -1 ? "覆盖期内充足" : `第 ${insight.daysUntilFbaStockout} 天`}
                                    </span>
                                  </div>
                                  <div className="border-t border-slate-200 pt-2">
                                    <p className="font-bold text-slate-500 mb-1.5 uppercase text-[9px] tracking-wider">AI 结果 vs 本地数学模型 (采购回仓)</p>
                                    <div className="flex justify-between text-slate-600">
                                      <span>本次诊断 ({insight.explanation && insight.explanation.includes("本地") ? "本地模型" : "AI 模型"}):</span>
                                      <span className="font-mono font-bold text-indigo-700">{(insight.procureQty ?? insight.suggestedQuantity ?? 0).toLocaleString()} 件</span>
                                    </div>
                                    <div className="flex justify-between text-slate-600">
                                      <span>本地确定性模型基准:</span>
                                      <span className="font-mono font-bold text-slate-700">{localModel.procureQty.toLocaleString()} 件</span>
                                    </div>
                                    {Math.abs((insight.procureQty ?? insight.suggestedQuantity ?? 0) - localModel.procureQty) > Math.max(5, localModel.procureQty * 0.1) && (
                                      <p className="text-[10px] text-amber-600 font-bold mt-1">两者差异较大, 建议以本地确定性模型为准核对。</p>
                                    )}
                                  </div>
                                </div>

                                {/* Analytical advisory from AI */}
                                <div className="space-y-2">
                                  <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2">
                                    <BrainCircuit size={13} className="text-indigo-600" />
                                    <span className="text-xs font-bold text-slate-800 tracking-wider uppercase">供应链全链路深度点评</span>
                                  </div>
                                  <div className="text-[11px] text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100 font-normal whitespace-pre-wrap">
                                    {insight.explanation}
                                  </div>
                                </div>

                                <div className="text-[9px] font-mono text-slate-400 flex justify-between">
                                  <span>诊断源: {insight.explanation.includes("本地") ? "精密数学内核" : "DeepSeek 供应链模型"}</span>
                                  <span>更新时间: {new Date(insight.analyzedAt).toLocaleTimeString()}</span>
                                </div>
                              </motion.div>
                            ) : (
                              <motion.div 
                                key="none"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="p-8 text-center flex flex-col items-center justify-center space-y-4"
                              >
                                <div className="w-12 h-12 rounded-full bg-slate-50 text-slate-300 flex items-center justify-center border border-slate-100">
                                  <BrainCircuit size={24} />
                                </div>
                                <div className="space-y-1">
                                  <p className="font-bold text-slate-800 text-sm">点击 “AI 备货分析” 开始提报</p>
                                  <p className="text-xs text-slate-400 max-w-[220px] mx-auto leading-relaxed">
                                    系统将调取该 SKU 在该店铺下的所有历史趋势，精算安全库存防护墙、头程期运输安全及精准备货。
                                  </p>
                                </div>
                                
                                <div className="w-full bg-slate-50 border border-slate-100 rounded-xl p-4 text-left text-[11px] space-y-1.5">
                                  <p className="font-bold text-slate-500 mb-1.5 uppercase text-[9px] tracking-wider">即时两段式估算 (基于历史日均):</p>
                                  <div className="flex justify-between text-slate-600">
                                    <span>历史日均销售速度:</span>
                                    <span className="font-mono font-bold text-slate-800">{localAvg.toFixed(2)} 件/日</span>
                                  </div>
                                  <div className="flex justify-between text-slate-600">
                                    <span>FBA 距离断货:</span>
                                    <span className="font-mono font-bold text-slate-800">{localModel.daysUntilFbaStockout === -1 ? "充足" : `第 ${localModel.daysUntilFbaStockout} 天`}</span>
                                  </div>
                                  <div className="flex justify-between text-slate-600">
                                    <span>本期发往 FBA:</span>
                                    <span className="font-mono font-bold text-indigo-700">{localModel.shipToFbaQty} 件{localModel.shipToFbaConstrained ? " (本地不足)" : ""}</span>
                                  </div>
                                  <div className="flex justify-between border-t border-slate-200 pt-1.5 mt-1 font-bold text-slate-800">
                                    <span>本期采购回仓:</span>
                                    <span className="font-mono text-emerald-700">{localReplenish} 件</span>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="bg-slate-50 rounded-2xl p-8 text-center border-dashed border-2 border-slate-200 flex flex-col items-center justify-center text-slate-400 space-y-3 xl:h-full">
                      <Package size={36} className="text-slate-300 animate-pulse" />
                      <p className="text-sm font-semibold text-slate-800">点选特定 SKU 进行备货诊断</p>
                      <p className="text-xs max-w-[200px] leading-relaxed text-slate-400">
                        点击列表任意行的 SKU 名字，或点击 “AI 备货分析” 即可拉起智能采购参谋看板。
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
  );
}
