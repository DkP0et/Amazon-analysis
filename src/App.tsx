import React, { useState, useMemo, useRef, useEffect } from "react";
import Papa from "papaparse";
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, Legend, AreaChart, Area, BarChart, Bar
} from "recharts";
import { 
  Upload, Download, FileText, TrendingUp, TrendingDown, Package, 
  AlertCircle, ChevronRight, BrainCircuit, Loader2, Search,
  BarChart3, RefreshCw, Layers, CheckCircle2, XCircle, LogOut, LogIn,
  AlertTriangle, Zap, Eye, StickyNote, Trash2, Plus, PackageOpen, HelpCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { WeeklyData, InventoryData, SKUPerformance, AIInsight, Store, OperationAction } from "./types";
import { skuService } from "./lib/skuService";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface InfoTooltipProps {
  title?: string;
  content: string;
  children: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  widthClass?: string;
  iconColorClass?: string;
}

function InfoTooltip({ 
  title, 
  content, 
  children, 
  position = "top", 
  widthClass = "w-64",
  iconColorClass = "text-slate-400 hover:text-slate-600 dark:text-slate-500" 
}: InfoTooltipProps) {
  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2 origin-bottom",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2 origin-top",
    left: "right-full top-1/2 -translate-y-1/2 mr-2 origin-right",
    right: "left-full top-1/2 -translate-y-1/2 ml-2 origin-left",
  };

  const arrowClasses = {
    top: "top-full left-1/2 -translate-x-1/2 border-t-slate-900 border-x-transparent border-b-transparent",
    bottom: "bottom-full left-1/2 -translate-x-1/2 border-b-slate-900 border-x-transparent border-t-transparent",
    left: "left-full top-1/2 -translate-y-1/2 border-l-slate-900 border-y-transparent border-r-transparent",
    right: "right-full top-1/2 -translate-y-1/2 border-r-slate-900 border-y-transparent border-l-transparent",
  };

  return (
    <span className="group relative inline-flex items-center gap-1 cursor-help">
      {children}
      <HelpCircle size={11} className={cn("transition-colors shrink-0", iconColorClass)} />
      <span 
        className={cn(
          "absolute p-3 bg-slate-900 border border-slate-800 text-white rounded-xl shadow-xl text-xs font-normal leading-relaxed opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[99] pointer-events-none scale-95 group-hover:scale-100",
          positionClasses[position],
          widthClass
        )}
      >
        {title && <span className="font-extrabold text-amber-400 mb-1 tracking-wide block text-[12px]">{title}</span>}
        <span className="text-slate-200 text-[11px] leading-relaxed select-text pointer-events-auto block normal-case whitespace-normal text-left">{content}</span>
        <span className={cn("absolute border-4", arrowClasses[position])} />
      </span>
    </span>
  );
}

interface SKUAnomaly {
  sku: string;
  type: 'SALES_DROP' | 'CVR_DROP' | 'TRAFFIC_SPIKE_NO_SALES' | 'LOW_STOCK';
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  changeValue?: string;
}

/**
 * 智能解析 CSV / TXT / TSV 报告
 * 支持 UTF-8/UTF-16 LE&BE 编码自动检测与 Tab 制表符自动分隔探测。
 */
const detectEncodingAndParse = async (file: File): Promise<any[]> => {
  return new Promise<any[]>((resolve, reject) => {
    const blob = file.slice(0, 4);
    const reader = new FileReader();
    reader.onload = (e) => {
      const arr = new Uint8Array(e.target?.result as ArrayBuffer);
      let encoding = "utf-8";
      if (arr[0] === 0xff && arr[1] === 0xfe) {
        encoding = "utf-16le";
      } else if (arr[0] === 0xfe && arr[1] === 0xff) {
        encoding = "utf-16be";
      }
      
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        encoding: encoding,
        complete: (res) => {
          const data = res.data;
          const isTxtOrTsv = file.name.endsWith('.txt') || file.name.endsWith('.tsv');
          if (isTxtOrTsv) {
            const hasTabs = data.some(row => 
              Object.keys(row).some(k => k.includes('\t')) || 
              Object.values(row).some(v => typeof v === 'string' && v.includes('\t'))
            );
            if (hasTabs || (data.length > 0 && Object.keys(data[0]).length === 1)) {
              Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                encoding: encoding,
                delimiter: "\t",
                complete: (res2) => resolve(res2.data),
                error: (err) => reject(err)
              });
              return;
            }
          }
          resolve(data);
        },
        error: (err) => reject(err)
      });
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(blob);
  });
};

export default function App() {
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<string>("");
  const [skuPerformance, setSkuPerformance] = useState<Record<string, SKUPerformance>>({});
  
  // LocalStorage state wrappers to prevent loss on page-reload/HMR
  const [selectedSku, _setSelectedSku] = useState<string | null>(() => {
    return localStorage.getItem("amazon_merchant_selected_sku");
  });
  const setSelectedSku = (s: string | null | ((prev: string | null) => string | null)) => {
    if (typeof s === 'function') {
      _setSelectedSku(prev => {
        const next = s(prev);
        if (next) localStorage.setItem("amazon_merchant_selected_sku", next);
        else localStorage.removeItem("amazon_merchant_selected_sku");
        return next;
      });
    } else {
      _setSelectedSku(s);
      if (s) localStorage.setItem("amazon_merchant_selected_sku", s);
      else localStorage.removeItem("amazon_merchant_selected_sku");
    }
  };

  const [selectedWeekIndex, setSelectedWeekIndex] = useState<number>(-1); // -1 means latest
  
  const [view, _setView] = useState<"upload" | "dashboard" | "inventory">(() => {
    const saved = localStorage.getItem("amazon_merchant_view");
    return (saved === "upload" || saved === "dashboard" || saved === "inventory") ? saved : "upload";
  });
  const setView = (v: "upload" | "dashboard" | "inventory" | ((prev: "upload" | "dashboard" | "inventory") => "upload" | "dashboard" | "inventory")) => {
    if (typeof v === 'function') {
      _setView(prev => {
        const next = v(prev);
        localStorage.setItem("amazon_merchant_view", next);
        return next;
      });
    } else {
      _setView(v);
      localStorage.setItem("amazon_merchant_view", v);
    }
  };

  const [restockSku, _setRestockSku] = useState<string | null>(() => {
    return localStorage.getItem("amazon_merchant_restock_sku");
  });
  const setRestockSku = (s: string | null | ((prev: string | null) => string | null)) => {
    if (typeof s === 'function') {
      _setRestockSku(prev => {
        const next = s(prev);
        if (next) localStorage.setItem("amazon_merchant_restock_sku", next);
        else localStorage.removeItem("amazon_merchant_restock_sku");
        return next;
      });
    } else {
      _setRestockSku(s);
      if (s) localStorage.setItem("amazon_merchant_restock_sku", s);
      else localStorage.removeItem("amazon_merchant_restock_sku");
    }
  };

  const [restockTargetDays, setRestockTargetDays] = useState<number>(60);
  const [excludeInTransit, setExcludeInTransit] = useState<boolean>(false);
  const [restockMode, setRestockMode] = useState<'simulated'>(() => {
    return "simulated";
  });
  const [isRestockLoading, setIsRestockLoading] = useState<boolean>(false);
  const [savingSku, setSavingSku] = useState<string | null>(null);
  const [showBatchPanel, setShowBatchPanel] = useState(false);
  const [batchValues, setBatchValues] = useState({
    inTransitArriveDays: "",
    leadTimeDays: "",
    safetyStockDays: "",
    inTransitStock: ""
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ sales: boolean; inventory: boolean }>({ sales: false, inventory: false });
  const [chartMetric, setChartMetric] = useState<'totalSales' | 'orders'>('totalSales');
  const [showStoreManager, setShowStoreManager] = useState(false);
  const [newStoreName, setNewStoreName] = useState("");
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [editingStoreName, setEditingStoreName] = useState("");
  const [pendingUploads, setPendingUploads] = useState<{ skus: Record<string, SKUPerformance>, files: FileList } | null>(null);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [duplicateDates, setDuplicateDates] = useState<string[]>([]);

  // Sorting States
  const [sortColumn, setSortColumn] = useState<'sku' | 'orders' | 'sessions' | 'cvr' | 'stock' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(null);

  // Custom SKU Remarks States
  const [isEditingRemark, setIsEditingRemark] = useState(false);
  const [tempRemark, setTempRemark] = useState("");

  // Operational Actions Closed-Loop Tracking States
  const [actionType, setActionType] = useState<'PRICING' | 'ADVERTISING' | 'LISTING_OPTIMIZATION' | 'REPLENISHMENT' | 'PROMOTION' | 'OTHER'>('PRICING');
  const [actionTitle, setActionTitle] = useState('');
  const [actionDetails, setActionDetails] = useState('');
  const [actionStatus, setActionStatus] = useState<'planned' | 'executed' | 'completed'>('executed');
  const [isAddingAction, setIsAddingAction] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const handleRestockAnalyze = async (skuPerf: SKUPerformance, overrideMode?: 'simulated', forceReanalyze?: boolean) => {
    setRestockSku(skuPerf.sku);
    const activeMode = overrideMode || restockMode;
    
    // Check if we already have the analysis for this specific strategy
    if (!forceReanalyze && skuPerf.restockInsights?.[activeMode]) {
      setSkuPerformance(prev => {
        const next = { ...prev };
        next[skuPerf.sku] = {
          ...next[skuPerf.sku],
          restockInsight: next[skuPerf.sku].restockInsights[activeMode]
        };
        skuService.saveSku(next[skuPerf.sku]);
        return next;
      });
      showToast(`⚡ 已秒切载入智能防断货库存分析`);
      return;
    }

    setIsRestockLoading(true);
    
    const skuWithParams = {
      ...skuPerf,
      currentStock: skuPerf.currentStock ?? 0,
      inTransitStock: skuPerf.inTransitStock ?? 0,
      rawMaterialStock: skuPerf.rawMaterialStock ?? 0,
      inTransitArriveDays: skuPerf.inTransitArriveDays ?? 15,
      inTransitBatches: skuPerf.inTransitBatches || [],
      leadTimeDays: skuPerf.leadTimeDays ?? 30,
      safetyStockDays: skuPerf.safetyStockDays ?? 15,
    };

    try {
      const response = await fetch("/api/restock-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skuPerformance: skuWithParams,
          targetCoverageDays: restockTargetDays,
          excludeInTransit: activeMode === 'exclude',
          restockMode: activeMode
        })
      });

      if (!response.ok) {
        throw new Error("备货预测接口请求失败");
      }

      const restockResult = await response.json();
      
      const restockResultWithSnapshot = {
        ...restockResult,
        currentStock: skuWithParams.currentStock,
        rawMaterialStock: skuWithParams.rawMaterialStock,
        inTransitStock: skuWithParams.inTransitStock,
        inTransitBatches: skuWithParams.inTransitBatches
      };
      
      setSkuPerformance(prev => {
        const next = { ...prev };
        const updatedInsights = {
          ...(next[skuPerf.sku]?.restockInsights || {}),
          [activeMode]: restockResultWithSnapshot
        };
        next[skuPerf.sku] = {
          ...next[skuPerf.sku],
          ...skuWithParams,
          restockInsight: restockResultWithSnapshot,
          restockInsights: updatedInsights
        };
        skuService.saveSku(next[skuPerf.sku]);
        return next;
      });

      showToast(`⚡ ${skuPerf.sku} AI供应链备货模型解析成功！`);
    } catch (err) {
      console.warn("AI restock analyze failed, falling back to client-side local calculation:", err);
      
      // Local MRP simulation engine
      const history = skuPerf.history || [];
      const totalOrders = history.reduce((sum, h) => sum + (h.orders || 0), 0);
      const totalDays = history.length * 7;
      const calculatedDailySales = totalDays > 0 ? Math.max(0.01, Number((totalOrders / totalDays).toFixed(2))) : 1;
      const avgDailySales = skuPerf.forecastedDailySales !== undefined && skuPerf.forecastedDailySales > 0
        ? Number(skuPerf.forecastedDailySales)
        : calculatedDailySales;

      const leadTimeDays = skuWithParams.leadTimeDays;
      const safetyStockDays = skuWithParams.safetyStockDays;
      const currentStock = skuWithParams.currentStock;
      const rawMaterialStock = skuWithParams.rawMaterialStock;
      const inTransitStock = skuWithParams.inTransitStock;
      const inTransitArriveDays = skuWithParams.inTransitArriveDays;
      const inTransitBatches = skuWithParams.inTransitBatches || [];
      const hasBatches = inTransitBatches && inTransitBatches.length > 0;
      const activeInTransitStock = hasBatches 
        ? inTransitBatches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0)
        : inTransitStock;

      const leadTimeDemand = Number((avgDailySales * leadTimeDays).toFixed(2));
      const safetyStock = Number((avgDailySales * safetyStockDays).toFixed(2));
      const reorderPoint = Number((leadTimeDemand + safetyStock).toFixed(2));

      // Timeline simulator
      const timelineSim = [];
      let currentSim = currentStock + rawMaterialStock;
      let unflooredSim = currentStock + rawMaterialStock;
      let minInventory = unflooredSim;
      let outOfStockDayStart = -1;
      let outOfStockDayEnd = -1;
      let isOutOfStockEver = false;
      let outOfStockDaysCount = 0;

      const simDaysLimit = Math.max(90, restockTargetDays);
      for (let d = 0; d <= simDaysLimit; d++) {
        if (d > 0) {
          currentSim -= avgDailySales;
          unflooredSim -= avgDailySales;
          if (hasBatches) {
            inTransitBatches.forEach(batch => {
              if (Number(batch.arriveDays) === d) {
                const qty = Number(batch.quantity) || 0;
                currentSim += qty;
                unflooredSim += qty;
              }
            });
          } else {
            if (d === inTransitArriveDays) {
              currentSim += inTransitStock;
              unflooredSim += inTransitStock;
            }
          }

          // 物理实际库存不会为负数，扣减到 0 为止
          if (currentSim < 0) {
            currentSim = 0;
          }
        }
        timelineSim.push({
          day: d,
          stock: Math.round(currentSim),
          safetyLine: Math.round(safetyStock),
        });

        if (d > 0) {
          // 断货判断使用未封底的理论供需缺口（代表实际流失或断货）
          if (unflooredSim < 0) {
            outOfStockDaysCount++;
            if (!isOutOfStockEver) {
              outOfStockDayStart = d;
              isOutOfStockEver = true;
            }
            outOfStockDayEnd = d;
          }
          if (d <= restockTargetDays) {
            if (unflooredSim < minInventory) {
              minInventory = unflooredSim;
            }
          }
        }
      }

      let suggestedQuantity = 0;
      if (activeMode === 'exclude') {
        suggestedQuantity = Math.max(0, Math.ceil((avgDailySales * restockTargetDays) - (currentStock + rawMaterialStock)));
      } else if (activeMode === 'include') {
        suggestedQuantity = Math.max(0, Math.ceil((avgDailySales * restockTargetDays) - (currentStock + rawMaterialStock + activeInTransitStock)));
      } else {
        suggestedQuantity = Math.max(0, Math.ceil(safetyStock - minInventory));
      }

      const effectiveInTransit = activeMode === 'exclude' ? 0 : activeInTransitStock;
      const daysOfSupply = avgDailySales > 0 ? Number(((currentStock + rawMaterialStock + effectiveInTransit) / avgDailySales).toFixed(1)) : 999;

      const fallbackResult = {
        avgDailySales,
        leadTimeDemand,
        safetyStock,
        reorderPoint,
        daysOfSupply,
        suggestedQuantity,
        targetCoverageDays: restockTargetDays,
        timelineSim,
        restockMode: activeMode,
        inTransitArriveDays,
        explanation: `[AI 模块由于网络瞬时繁忙，系统已无缝启动本地一流水准的时间轴动态物理数学运算模型]

【科学库存与在途动态仿真报告 - 本地】

1. 【销量流速监测】：该 SKU 精算日均销量达 ${avgDailySales.toFixed(2)} 件/日。
2. 【时间流耗察】：当前在库成品+可拆材料折合共 ${(currentStock + rawMaterialStock)} 件。由于已出发在途的 ${inTransitStock} 件预计需要 ${inTransitArriveDays} 天后才能抵达入仓。
   ${isOutOfStockEver 
     ? `🚨 【断货真空期红色警讯】：由于现有在库仅够维持 ${Math.floor((currentStock + rawMaterialStock) / (avgDailySales || 1))} 天，而在途大货要在 ${inTransitArriveDays} 天后才到，因此预计在 “未来第 ${outOfStockDayStart} 天至第 ${outOfStockDayEnd} 天（共 ${outOfStockDaysCount} 天）” 期间将出现严重的临时缺货断档断崖！这是传统的 ‘直接计入在途合并计算’ 根本无法发现的时间差盲点！`
     : `🟢 【供应链在库无缝覆盖】：现有在库实物足以支撑 ${(currentStock + rawMaterialStock)} 天销售，能够安全顶到第 ${inTransitArriveDays} 天在途货物到仓上架，前置周期完全闭合，无任何断货风险！`
   }
3. 【最精准补货（备原料）计划】：
   - 选择模式：智能防断货模型 (时间轴投影仿真)
   - 为了确保在您期望的 ${restockTargetDays} 天良性周转覆盖期内，哪怕在途大货可能存在时间错开，也绝不掉入在库警戒线（保障最低库存不低于安全基数 ${safetyStock.toFixed(0)} 件），本批次最佳精密订货/备好原料建议量为：${suggestedQuantity} 件。
4. 【订单与排产排程指导】：
   - 采购加分装共需 ${leadTimeDays} 天。考虑到您的当前可用断库缓冲，建议最迟应在 ${Math.max(1, Math.floor(daysOfSupply - leadTimeDays))} 天内下单采购原材料并启动入库加工，以对冲头程和原料交期的耗时！`,
        analyzedAt: new Date().toISOString()
      };

      const fallbackResultWithSnapshot = {
        ...fallbackResult,
        currentStock: skuWithParams.currentStock,
        rawMaterialStock: skuWithParams.rawMaterialStock,
        inTransitStock: skuWithParams.inTransitStock,
        inTransitBatches: skuWithParams.inTransitBatches
      };

      setSkuPerformance(prev => {
        const next = { ...prev };
        const updatedInsights = {
          ...(next[skuPerf.sku]?.restockInsights || {}),
          [activeMode]: fallbackResultWithSnapshot
        };
        next[skuPerf.sku] = {
          ...next[skuPerf.sku],
          ...skuWithParams,
          restockInsight: fallbackResultWithSnapshot,
          restockInsights: updatedInsights
        };
        skuService.saveSku(next[skuPerf.sku]);
        return next;
      });

      showToast(`⚠️ AI 线路繁忙，系统已无缝切换至本地时间轴物理备货模型！`);
    } finally {
      setIsRestockLoading(false);
    }
  };

  const handleApplyBatchChanges = async () => {
    // Current store SKUs
    const currentStoreSkus = (Object.values(skuPerformance) as SKUPerformance[]).filter(s => s.storeId === activeStoreId);
    
    if (currentStoreSkus.length === 0) {
      showToast("当前店铺没有任何 SKU，无法执行批量设置。");
      return;
    }

    // Determine what field values we are applying (filters out empty input strings)
    const updates: Record<string, number> = {};
    if (batchValues.inTransitArriveDays !== "") {
      updates.inTransitArriveDays = parseInt(batchValues.inTransitArriveDays) || 0;
    }
    if (batchValues.leadTimeDays !== "") {
      updates.leadTimeDays = parseInt(batchValues.leadTimeDays) || 0;
    }
    if (batchValues.safetyStockDays !== "") {
      updates.safetyStockDays = parseInt(batchValues.safetyStockDays) || 0;
    }
    if (batchValues.inTransitStock !== "") {
      updates.inTransitStock = parseInt(batchValues.inTransitStock) || 0;
    }

    if (Object.keys(updates).length === 0) {
      showToast("⚠️ 请至少填写一个表单项后再进行批量应用！");
      return;
    }

    // Build the updated list & next state
    const updatedList: SKUPerformance[] = [];
    const updatedState: Record<string, SKUPerformance> = { ...skuPerformance };

    for (const s of currentStoreSkus) {
      const updated = {
        ...s,
        ...updates,
        restockInsight: undefined,
        restockInsights: undefined
      };
      updatedList.push(updated);
      updatedState[s.sku] = updated;
    }

    // Apply to React state
    setSkuPerformance(updatedState);

    // Bulk save to backend
    await skuService.bulkSaveSkus(updatedList);

    showToast(`⚡ 成功对当前店铺的 ${currentStoreSkus.length} 款 SKU 一键批量应用了：${Object.keys(updates).map(k => {
      if (k === 'inTransitArriveDays') return '在途到仓天数';
      if (k === 'leadTimeDays') return '头程前置天数';
      if (k === 'safetyStockDays') return '安全缓冲天数';
      if (k === 'inTransitStock') return '在途库存数量';
      return k;
    }).join('、')}`);

    // Hide batch panel and clear values
    setShowBatchPanel(false);
    setBatchValues({
      inTransitArriveDays: "",
      leadTimeDays: "",
      safetyStockDays: "",
      inTransitStock: ""
    });
  };

  const handleSaveRemark = () => {
    if (!selectedSku || !skuPerformance[selectedSku]) return;
    setSkuPerformance(prev => {
      const next = { ...prev };
      next[selectedSku] = {
        ...next[selectedSku],
        name: tempRemark.trim()
      };
      skuService.saveSku(next[selectedSku]);
      return next;
    });
    setIsEditingRemark(false);
  };

  useEffect(() => {
    // Reset state when selected SKU changes
    setIsEditingRemark(false);
    setTempRemark("");
    setIsAddingAction(false);
    setActionTitle("");
    setActionDetails("");
  }, [selectedSku]);

  const handleSort = (column: 'sku' | 'orders' | 'sessions' | 'cvr' | 'stock', direction: 'asc' | 'desc') => {
    if (sortColumn === column && sortDirection === direction) {
      // 再次点击相同箭头，恢复默认排序
      setSortColumn(null);
      setSortDirection(null);
    } else {
      setSortColumn(column);
      setSortDirection(direction);
    }
  };

  const renderSortArrows = (column: 'sku' | 'orders' | 'sessions' | 'cvr' | 'stock') => {
    const isAscActive = sortColumn === column && sortDirection === 'asc';
    const isDescActive = sortColumn === column && sortDirection === 'desc';
    
    return (
      <div className="inline-flex flex-col ml-1.5 select-none shrink-0 align-middle">
        {/* 上箭头 (由低到高) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleSort(column, 'asc');
          }}
          className={cn(
            "p-0.5 -my-1 hover:text-indigo-600 transition-colors focus:outline-none cursor-pointer",
            isAscActive ? "text-indigo-600 font-extrabold scale-110" : "text-slate-300 hover:text-indigo-400"
          )}
          title="由低到高排序"
        >
          <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
            <path d="M12 4l-8 8h16z" />
          </svg>
        </button>
        {/* 下箭头 (由高到低) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleSort(column, 'desc');
          }}
          className={cn(
            "p-0.5 -my-1 hover:text-indigo-600 transition-colors focus:outline-none cursor-pointer",
            isDescActive ? "text-indigo-600 font-extrabold scale-110" : "text-slate-300 hover:text-indigo-400"
          )}
          title="由高到低排序"
        >
          <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
            <path d="M12 20l8-8H4z" />
          </svg>
        </button>
      </div>
    );
  };

  const salesInputRef = useRef<HTMLInputElement>(null);
  const inventoryInputRef = useRef<HTMLInputElement>(null);

  // Load Initial Data
  useEffect(() => {
    const loadInitData = async () => {
      let savedStores = await skuService.getStores();
      if (savedStores.length === 0) {
        const defaultStore: Store = {
          id: 'default',
          name: '默认店铺',
          createdAt: new Date().toISOString()
        };
        await skuService.saveStore(defaultStore);
        savedStores = [defaultStore];
      }
      setStores(savedStores);
      setActiveStoreId(savedStores[0].id);
    };
    loadInitData();
  }, []);

  // Load SKUs for active store
  useEffect(() => {
    if (!activeStoreId) return;
    const loadSkus = async () => {
      const storeSkus = await skuService.getSkusByStore(activeStoreId);
      const skuMap: Record<string, SKUPerformance> = {};
      storeSkus.forEach(sku => {
        skuMap[sku.sku] = sku;
      });
      setSkuPerformance(skuMap);
      setSelectedSku(null);
    };
    loadSkus();
  }, [activeStoreId]);

  const extractDateFromFilename = (filename: string): string => {
    const cleanFilename = filename.toLowerCase();
    
    // Pattern for may10-may16
    const weekPattern = /([a-z]{3,})\s*(\d{1,2})\s*-\s*([a-z]{3,})\s*(\d{1,2})/i;
    const match = cleanFilename.match(weekPattern);
    if (match) {
      const m1 = match[1].substring(0, 3);
      const d1 = match[2].padStart(2, '0');
      const m2 = match[3].substring(0, 3);
      const d2 = match[4].padStart(2, '0');
      return `${m1}${d1}-${m2}${d2}`;
    }

    // Pattern for 4.19-4.25 or 04.19-04.25
    const monthNumPattern = /(\d{1,2})[.-](\d{1,2})\s*-\s*(\d{1,2})[.-](\d{1,2})/;
    const mMatch = cleanFilename.match(monthNumPattern);
    if (mMatch) {
        const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const m1 = monthNames[parseInt(mMatch[1]) - 1];
        const d1 = mMatch[2].padStart(2, '0');
        const m2 = monthNames[parseInt(mMatch[3]) - 1];
        const d2 = mMatch[4].padStart(2, '0');
        if (m1 && m2) return `${m1}${d1}-${m2}${d2}`;
    }

    // Try YYYY-MM-DD
    const datePattern = /(\d{4}-\d{2}-\d{2})/;
    const dateMatch = cleanFilename.match(datePattern);
    if (dateMatch) return dateMatch[1];

    return "";
  };

  const getSortableDateValue = (dateStr: string) => {
    if (!dateStr) return 0;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return new Date(dateStr).getTime();
    
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };
    
    const weekPattern = /([a-zA-Z]{3})(\d{1,2})-([a-zA-Z]{3})(\d{1,2})/i;
    const match = dateStr.match(weekPattern);
    if (match) {
      const monthIdx = months[match[1].toLowerCase()];
      const day = parseInt(match[2]);
      const year = new Date().getFullYear();
      // Use the start date of the range for sorting
      return new Date(year, monthIdx, day).getTime();
    }
    return 0;
  };

  const handleSalesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    
    // 1. Scan files and detect dates
    const currentSkus: Record<string, SKUPerformance> = { ...skuPerformance };
    const tempPerformance: Record<string, SKUPerformance> = {};
    const datesInFiles = new Set<string>();
    const existingDates = new Set<string>();
    
    (Object.values(currentSkus) as SKUPerformance[]).forEach(s => {
      s.history.forEach(h => existingDates.add(h.date));
    });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const csvData = await detectEncodingAndParse(file);

      const extractedDate = extractDateFromFilename(file.name);
      const fileDate = extractedDate || new Date(file.lastModified).toISOString().split('T')[0];

      csvData.forEach((row) => {
        const sku = (row.sku || row.SKU || row["Seller SKU"] || row["sku"] || row["（子）ASIN"] || "").toString().trim();
        if (!sku) return;

        const getVal = (keys: string[]) => {
          const rowKeys = Object.keys(row);
          for (const searchKey of keys) {
            const foundKey = rowKeys.find(rk => rk.trim().toLowerCase() === searchKey.toLowerCase() && !rk.includes("B2B"));
            if (foundKey !== undefined) return row[foundKey];
          }
          return "0";
        };

        const sessionsStr = getVal(["商品会话数 - 总计", "会话数 - 总计", "会话 - 总计", "Sessions", "sessions"]).toString();
        const ordersStr = getVal(["已订购商品数量", "Total Order Items", "Orders", "orders", "units-ordered"]).toString();
        const cvrStr = getVal(["商品会话百分比", "转化率 - 总计", "Unit Session Percentage", "Conversion Rate", "CVR"]).toString();
        const salesStr = getVal(["已订购商品销售额", "Ordered Product Sales", "Sales", "sales"]).toString();

        const sessions = parseFloat(sessionsStr.replace(/,/g, "")) || 0;
        const orders = parseFloat(ordersStr.replace(/,/g, "")) || 0;
        
        let cvr = 0;
        const cvrClean = cvrStr.replace(/%/g, "").replace(/,/g, "").trim();
        cvr = parseFloat(cvrClean) || (sessions > 0 ? orders / sessions : 0);
        if (cvrStr.includes("%") || cvr > 1) cvr = cvr / 100;
        
        const sales = parseFloat(salesStr.replace(/[^-0-9.]/g, "")) || 0;
        const date = extractedDate || row.date || row.Date || row["Date Range"] || row["date"] || fileDate;

        datesInFiles.add(date);

        if (!tempPerformance[sku]) {
          tempPerformance[sku] = { sku, storeId: activeStoreId, history: [] };
        }

        const existingEntry = tempPerformance[sku].history.find(h => h.date === date);
        if (existingEntry) {
          existingEntry.sessions += sessions;
          existingEntry.orders += orders;
          existingEntry.totalSales += sales;
          existingEntry.conversionRate = existingEntry.sessions > 0 ? existingEntry.orders / existingEntry.sessions : 0;
        } else {
          tempPerformance[sku].history.push({
            date,
            sku,
            sessions,
            orders,
            conversionRate: sessions > 0 ? orders / sessions : cvr,
            totalSales: sales,
          });
        }
      });
    }

    const duplicates = Array.from(datesInFiles).filter(d => existingDates.has(d));
    
    if (duplicates.length > 0) {
      setPendingUploads({ skus: tempPerformance, files });
      setDuplicateDates(duplicates);
      setShowOverwriteConfirm(true);
      setIsProcessing(false);
    } else {
      await applySalesData(tempPerformance);
      setIsProcessing(false);
    }
  };

  const applySalesData = async (incomingData: Record<string, SKUPerformance>) => {
    setSkuPerformance(prev => {
      const next = { ...prev };
      Object.keys(incomingData).forEach(sku => {
        if (next[sku]) {
          const skuData = { ...next[sku] };
          const history = [...skuData.history];
          
          incomingData[sku].history.forEach(newEntry => {
            const existingIdx = history.findIndex(h => h.date === newEntry.date);
            if (existingIdx >= 0) {
              const existingNote = history[existingIdx].notes;
              history[existingIdx] = { ...newEntry, notes: existingNote || newEntry.notes };
            } else {
              history.push(newEntry);
            }
          });
          
          skuData.history = history.sort((a, b) => getSortableDateValue(a.date) - getSortableDateValue(b.date));
          next[sku] = skuData;
        } else {
          next[sku] = incomingData[sku];
        }
      });
      
      const allResults = Object.values(next) as SKUPerformance[];
      skuService.bulkSaveSkus(allResults);
      return next;
    });
    
    setUploadStatus(prev => ({ ...prev, sales: true }));
  };

  const handleInventoryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    let currentSkus = { ...skuPerformance };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const csvData = await detectEncodingAndParse(file);

      csvData.forEach(row => {
        const skuRaw = row.sku || row.SKU || row["Seller SKU"] || row["sku-name"] || row["sku"] || row["（子）ASIN"] || row["商品SKU"] || row["SKU码"] || row["MSKU"] || row["ASIN"] || "";
        const sku = skuRaw.toString().trim();
        if (!sku) return;

        // Try to find stock/available keys
        const stockKeys = ["available", "afn-fulfillable-quantity", "Available", "Quantity", "quantity", "当前实物", "当前在库", "在庫", "在库数量", "在库", "库存", "可用", "数量"];
        const rowKeys = Object.keys(row);
        let foundStockVal = "0";
        for (const searchKey of stockKeys) {
          const foundKey = rowKeys.find(rk => rk.trim().toLowerCase() === searchKey.toLowerCase());
          if (foundKey !== undefined) {
            foundStockVal = row[foundKey].toString();
            break;
          }
        }
        const stock = parseInt(foundStockVal.replace(/,/g, "")) || 0;

        if (currentSkus[sku]) {
          currentSkus[sku] = { ...currentSkus[sku], currentStock: stock };
        } else {
          currentSkus[sku] = {
            sku,
            storeId: activeStoreId,
            currentStock: stock,
            inTransitStock: 0,
            history: []
          };
        }
      });
    }

    setSkuPerformance(currentSkus);
    await skuService.bulkSaveSkus(Object.values(currentSkus) as SKUPerformance[]);
    
    setUploadStatus(prev => ({ ...prev, inventory: true }));
    setIsProcessing(false);
  };

  // --- Mathematical Funnel Attribution & Operations Action Management ---
  const getFunnelAttribution = (skuData: SKUPerformance, currentDate: string) => {
    const history = skuData.history || [];
    const currentWeek = history.find(h => h.date === currentDate);
    if (!currentWeek) return null;

    // Get historical weeks before currentWeek
    const historyBefore = history
      .filter(h => getSortableDateValue(h.date) < getSortableDateValue(currentDate))
      .slice(-4); // last 4 weeks baseline

    if (historyBefore.length === 0) return null;

    const S_curr = currentWeek.sessions;
    const O_curr = currentWeek.orders;
    const Y_curr = currentWeek.totalSales;
    const CR_curr = currentWeek.conversionRate;
    const AOV_curr = O_curr > 0 ? Y_curr / O_curr : 0;

    // Baseline is average of historyBefore
    const S_base = historyBefore.reduce((acc, h) => acc + h.sessions, 0) / historyBefore.length;
    const O_base = historyBefore.reduce((acc, h) => acc + h.orders, 0) / historyBefore.length;
    const Y_base = historyBefore.reduce((acc, h) => acc + h.totalSales, 0) / historyBefore.length;
    
    const CR_base = S_base > 0 ? O_base / S_base : 0;
    const AOV_base = O_base > 0 ? Y_base / O_base : 0;

    const deltaS = S_curr - S_base;
    const deltaCR = CR_curr - CR_base;
    const deltaAOV = AOV_curr - AOV_base;

    const sessionsEffect = deltaS * CR_base * AOV_base;
    const cvrEffect = S_curr * deltaCR * AOV_base;
    const aovEffect = S_curr * CR_curr * deltaAOV;
    const totalEffect = Y_curr - Y_base;

    // Determine primary driver
    let primaryDriver = 'TRAFFIC'; // Sessions
    let maxAbsEffect = Math.abs(sessionsEffect);
    if (Math.abs(cvrEffect) > maxAbsEffect) {
      primaryDriver = 'CONVERSION';
      maxAbsEffect = Math.abs(cvrEffect);
    }
    if (Math.abs(aovEffect) > maxAbsEffect) {
      primaryDriver = 'AOV';
      maxAbsEffect = Math.abs(aovEffect);
    }

    // Generate dynamic Commentary (归因推断)
    let commentary = "";
    if (totalEffect < 0) {
      if (primaryDriver === 'TRAFFIC') {
        const pct = Math.min(100, Math.round((Math.abs(sessionsEffect) / Math.abs(totalEffect || 1)) * 100));
        commentary = `⚠️ 本周销售额下滑主要是由于 [流量缩减] 导致的，该因子占据下滑主归流的 ${pct}%。建议检查广告预算、关键词自然排名及Listing购物车竞争。`;
      } else if (primaryDriver === 'CONVERSION') {
        const pct = Math.min(100, Math.round((Math.abs(cvrEffect) / Math.abs(totalEffect || 1)) * 100));
        commentary = `⚠️ 本周销售额下滑主要是由于 [页面转化率 (CVR) 下滑] 导致的，该因子占下滑归因的 ${pct}%。建议核对中差评出现时间、同类竞品降价秒杀或高跳出漏洞。`;
      } else {
        const pct = Math.min(100, Math.round((Math.abs(aovEffect) / Math.abs(totalEffect || 1)) * 100));
        commentary = `⚠️ 本周销售额下滑主要是由于 [平均客单价下跌] 导致的，该因子占下滑归因的 ${pct}%。需评估是否因清仓大额优惠券削减客单值，或低客单套餐配件销售占比大增。`;
      }
    } else if (totalEffect > 0) {
      if (primaryDriver === 'TRAFFIC') {
        const pct = Math.min(100, Math.round((sessionsEffect / (totalEffect || 1)) * 100));
        commentary = `🎉 本周销售额上升主要受益于 [流量增长] 的强力拉动，贡献率达 ${pct}%。广告拓流、排名卡位取得了实质性的运营效果！`;
      } else if (primaryDriver === 'CONVERSION') {
        const pct = Math.min(100, Math.round((cvrEffect / (totalEffect || 1)) * 100));
        commentary = `🎉 本周销售额上升主要受益于 [转化率上涨] 带来，贡献率达 ${pct}%。说明高转化 Listing 升级、Q&A或主图提要优化产生了良好的购买引导！`;
      } else {
        const pct = Math.min(100, Math.round((aovEffect / (totalEffect || 1)) * 100));
        commentary = `🎉 本周销售额上升主要受益于 [提价或组合溢价]，贡献率达 ${pct}%。提速高净值关联客件、溢价控制得体提高了单位流量销售弹性！`;
      }
    } else {
      commentary = "📊 本期销售情况及其平稳，漏斗分解各项变化均属于微量区间，与4周前基准线高度一致。";
    }

    return {
      sessionsBase: S_base,
      sessionsCurr: S_curr,
      cvrBase: CR_base,
      cvrCurr: CR_curr,
      salesBase: Y_base,
      salesCurr: Y_curr,
      aovBase: AOV_base,
      aovCurr: AOV_curr,
      sessionsEffect,
      cvrEffect,
      aovEffect,
      totalEffect,
      primaryDriver,
      commentary
    };
  };

  const evaluateActionPerformance = (
    skuData: SKUPerformance,
    action: OperationAction
  ): OperationAction["results"] | undefined => {
    const history = skuData.history || [];
    if (history.length === 0) return undefined;

    const sortedHistory = [...history].sort((a, b) => getSortableDateValue(a.date) - getSortableDateValue(b.date));
    const actionTime = getSortableDateValue(action.date);

    let actionIdx = sortedHistory.findIndex(h => getSortableDateValue(h.date) === actionTime);
    if (actionIdx === -1) {
      actionIdx = sortedHistory.findIndex(h => getSortableDateValue(h.date) >= actionTime);
    }
    if (actionIdx === -1) return undefined;

    // Pre-event (up to 2 weeks before action week)
    const preWeeks = sortedHistory.slice(Math.max(0, actionIdx - 2), actionIdx);
    // Post-event (up to 2 weeks after action week)
    const postWeeks = sortedHistory.slice(actionIdx + 1, actionIdx + 3);

    if (preWeeks.length === 0 || postWeeks.length === 0) {
      return {
        sessionsBefore: 0,
        sessionsAfter: 0,
        cvrBefore: 0,
        cvrAfter: 0,
        salesBefore: 0,
        salesAfter: 0,
        efficiencyRating: 'observing',
        analysisText: '运营行动处于观察期/数据积累中，待后续1-2周新报表汇入后，将自动计算数值进行智能判定，实现闭环。'
      };
    }

    const preSessions = preWeeks.reduce((acc, h) => acc + h.sessions, 0) / preWeeks.length;
    const preCVR = preWeeks.reduce((acc, h) => acc + h.conversionRate, 0) / preWeeks.length;
    const preSales = preWeeks.reduce((acc, h) => acc + h.totalSales, 0) / preWeeks.length;

    const postSessions = postWeeks.reduce((acc, h) => acc + h.sessions, 0) / postWeeks.length;
    const postCVR = postWeeks.reduce((acc, h) => acc + h.conversionRate, 0) / postWeeks.length;
    const postSales = postWeeks.reduce((acc, h) => acc + h.totalSales, 0) / postWeeks.length;

    const salesChangePct = preSales > 0 ? ((postSales - preSales) / preSales) * 100 : 0;
    const sessionsChangePct = preSessions > 0 ? ((postSessions - preSessions) / preSessions) * 100 : 0;
    const cvrChangePct = preCVR > 0 ? ((postCVR - preCVR) / preCVR) * 100 : 0;

    let rating: any = 'no_effect';
    let analysisText = "";

    if (salesChangePct >= 15) {
      rating = 'excellent';
      analysisText = `📈 效果极其显著！销售额比行动前均值上升了 ${salesChangePct.toFixed(1)}%（其中：流量 ${sessionsChangePct >= 0 ? '+' : ''}${sessionsChangePct.toFixed(1)}%，转化率 ${cvrChangePct >= 0 ? '+' : ''}${cvrChangePct.toFixed(1)}%）。说明动作执行非常到位，策略对路，建议沉淀为 SOP 全面推广！`;
    } else if (salesChangePct >= 5) {
      rating = 'good';
      analysisText = `✅ 运营呈现积极反馈。销售额提升 ${salesChangePct.toFixed(1)}%（其中：流量 ${sessionsChangePct >= 0 ? '+' : ''}${sessionsChangePct.toFixed(1)}%，转化率 ${cvrChangePct >= 0 ? '+' : ''}${cvrChangePct.toFixed(1)}%）。方向正确，建议继续稳固执行。`;
    } else if (salesChangePct <= -10) {
      rating = 'negative';
      analysisText = `🚨 出现负相关或下滑。整体销售额比行动前下降了 ${Math.abs(salesChangePct).toFixed(1)}%（其中：流量 ${sessionsChangePct >= 0 ? '+' : ''}${sessionsChangePct.toFixed(1)}%，转化率 ${cvrChangePct >= 0 ? '+' : ''}${cvrChangePct.toFixed(1)}%）。需要注意差评、跟卖爆发、或价格调整超限引起转化过敏崩溃，建议立即介入调整。`;
    } else {
      rating = 'no_effect';
      analysisText = `➖ 运营成效未见实质拐点。销售额增幅仪在 ${salesChangePct >= 0 ? '+' : ''}${salesChangePct.toFixed(1)}% 的区间微幅横向波动（流量：${sessionsChangePct.toFixed(1)}%，转化率：${cvrChangePct.toFixed(1)}%）。效果微弱，建议持续评估。`;
    }

    return {
      sessionsBefore: preSessions,
      sessionsAfter: postSessions,
      cvrBefore: preCVR,
      cvrAfter: postCVR,
      salesBefore: preSales,
      salesAfter: postSales,
      efficiencyRating: rating,
      analysisText
    };
  };

  const handleAddAction = (sku: string, type: any, title: string, details: string, status: any, date: string) => {
    if (!title.trim()) return;
    
    const newAction: OperationAction = {
      id: "act_" + Date.now() + Math.random().toString(36).substring(2, 7),
      sku,
      storeId: skuPerformance[sku].storeId,
      date,
      type,
      title: title.trim(),
      details: details.trim() || undefined,
      status,
      executedAt: status === 'executed' || status === 'completed' ? new Date().toISOString() : undefined
    };

    setSkuPerformance(prev => {
      const next = { ...prev };
      const skuData = { ...next[sku] };
      const currentActions = skuData.actions ? [...skuData.actions] : [];
      
      skuData.actions = [...currentActions, newAction];
      next[sku] = skuData;
      
      skuService.saveSku(skuData);
      return next;
    });

    setActionTitle('');
    setActionDetails('');
    setIsAddingAction(false);
    showToast("成功添加运营行动并启动指标异常闭环追踪！");
  };

  const handleDeleteAction = (sku: string, actionId: string) => {
    setSkuPerformance(prev => {
      const next = { ...prev };
      const skuData = { ...next[sku] };
      if (skuData.actions) {
        skuData.actions = skuData.actions.filter(a => a.id !== actionId);
      }
      next[sku] = skuData;
      skuService.saveSku(skuData);
      return next;
    });
    showToast("已删除该运营行动。");
  };

  const handleUpdateActionStatus = (sku: string, actionId: string, status: 'planned' | 'executed' | 'completed') => {
    setSkuPerformance(prev => {
      const next = { ...prev };
      const skuData = { ...next[sku] };
      if (skuData.actions) {
        skuData.actions = skuData.actions.map(a => {
          if (a.id === actionId) {
            return {
              ...a,
              status,
              executedAt: status === 'executed' || status === 'completed' ? new Date().toISOString() : a.executedAt
            };
          }
          return a;
        });
      }
      next[sku] = skuData;
      skuService.saveSku(skuData);
      return next;
    });
    showToast(`该行动已更新为 [${status === 'planned' ? '计划中' : status === 'executed' ? '已执行' : '追踪闭环'}]。`);
  };

  const handleAdoptRecommendation = (recommendationText: string) => {
    if (!selectedSku || !skuPerformance[selectedSku]) return;
    
    // Guess type based on chinese keywords
    let type: 'PRICING' | 'ADVERTISING' | 'LISTING_OPTIMIZATION' | 'REPLENISHMENT' | 'PROMOTION' | 'OTHER' = 'OTHER';
    const text = recommendationText.toLowerCase();
    if (text.includes("价格") || text.includes("降价") || text.includes("提价") || text.includes("定价") || text.includes("售价")) {
      type = 'PRICING';
    } else if (text.includes("广告") || text.includes("cpc") || text.includes("ppc") || text.includes("推广") || text.includes("预算") || text.includes("竞价")) {
      type = 'ADVERTISING';
    } else if (text.includes("listing") || text.includes("详情") || text.includes("关键词") || text.includes("主图") || text.includes("标题") || text.includes("评价")) {
      type = 'LISTING_OPTIMIZATION';
    } else if (text.includes("补货") || text.includes("断货") || text.includes("发货") || text.includes("库存") || text.includes("备货") || text.includes("物流")) {
      type = 'REPLENISHMENT';
    } else if (text.includes("秒杀") || text.includes("促销") || text.includes("折扣") || text.includes("优惠券") || text.includes("coupon")) {
      type = 'PROMOTION';
    }

    handleAddAction(
      selectedSku,
      type,
      recommendationText.length > 50 ? recommendationText.substring(0, 47) + "..." : recommendationText,
      `一键采纳自 AI 建议步骤："${recommendationText}"`,
      'executed',
      currentWeekDate
    );
    showToast(`已采纳 AI 建议并自动创建 [${type === 'PRICING' ? '价格调整' : type === 'ADVERTISING' ? '广告调优' : type === 'LISTING_OPTIMIZATION' ? 'Listing优化' : type === 'REPLENISHMENT' ? '紧急补货' : type === 'PROMOTION' ? '促销活动' : '其他行动'}] 指标追踪项目。`);
  };

  const analyzeSku = async (sku: string) => {
    if (!skuPerformance[sku] || skuPerformance[sku].analysisLoading) return;

    setSkuPerformance(prev => ({
      ...prev,
      [sku]: { ...prev[sku], analysisLoading: true, analysisStatus: 'idle', analysisErrorMessage: undefined }
    }));

    try {
      // Clean data for AI: map all history entries, relying on server-side 'Option 1' compression to manage tokens efficiently
      const history = skuPerformance[sku].history.map(h => ({
        date: h.date,
        sessions: h.sessions,
        orders: h.orders,
        cvr: (h.conversionRate * 100).toFixed(2) + '%',
        sales: h.totalSales.toFixed(2)
      }));

      // Calculate factors before calling AI
      const attributionResult = getFunnelAttribution(skuPerformance[sku], currentWeekDate);

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          skuData: {
            sku: skuPerformance[sku].sku,
            currentStock: skuPerformance[sku].currentStock,
            history,
            attribution: attributionResult
          }
        }),
      });
      
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "分析请求失败");
      }

      setSkuPerformance(prev => {
        const next = { ...prev };
        next[sku] = { ...next[sku], insight: result, analysisLoading: false, analysisStatus: 'success' };
        // Persistent save
        skuService.saveSku(next[sku]);
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSkuPerformance(prev => ({
        ...prev,
        [sku]: { 
          ...prev[sku], 
          analysisLoading: false, 
          analysisStatus: 'error',
          analysisErrorMessage: msg
        }
      }));
    }
  };

  // --- Week Picker Logic ---
  const availableWeeks = useMemo(() => {
    const dates = new Set<string>();
    (Object.values(skuPerformance) as SKUPerformance[]).forEach(sku => {
      sku.history.forEach(h => {
        if (h.date) dates.add(h.date);
      });
    });
    return Array.from(dates).sort((a, b) => getSortableDateValue(a) - getSortableDateValue(b));
  }, [skuPerformance]);

  // Current effective week index (if -1, use the last one)
  const currentWeekIdx = selectedWeekIndex === -1 ? availableWeeks.length - 1 : selectedWeekIndex;
  const currentWeekDate = availableWeeks[currentWeekIdx];

  const sortedSkus = useMemo(() => {
    const list = Object.values(skuPerformance) as SKUPerformance[];
    
    // Default sorting is by current week's order volume, descending
    if (!sortColumn || !sortDirection) {
      return [...list].sort((a, b) => {
        const aWeek = a.history.find(h => h.date === currentWeekDate);
        const bWeek = b.history.find(h => h.date === currentWeekDate);
        const aOrders = aWeek ? aWeek.orders : 0;
        const bOrders = bWeek ? bWeek.orders : 0;
        
        // If orders are the same, secondary sort by SKU name alphabetically
        if (bOrders === aOrders) {
          return a.sku.localeCompare(b.sku);
        }
        return bOrders - aOrders;
      });
    }

    return [...list].sort((a, b) => {
      const aWeek = a.history.find(h => h.date === currentWeekDate);
      const bWeek = b.history.find(h => h.date === currentWeekDate);

      let valA: any = 0;
      let valB: any = 0;

      switch (sortColumn) {
        case 'sku':
          valA = a.name || a.sku;
          valB = b.name || b.sku;
          break;
        case 'orders':
          valA = aWeek ? aWeek.orders : 0;
          valB = bWeek ? bWeek.orders : 0;
          break;
        case 'sessions':
          valA = aWeek ? aWeek.sessions : 0;
          valB = bWeek ? bWeek.sessions : 0;
          break;
        case 'cvr':
          valA = aWeek ? aWeek.conversionRate : 0;
          valB = bWeek ? bWeek.conversionRate : 0;
          break;
        case 'stock':
          valA = a.currentStock !== undefined ? a.currentStock : -1;
          valB = b.currentStock !== undefined ? b.currentStock : -1;
          break;
      }

      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortDirection === 'asc' 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      } else {
        return sortDirection === 'asc'
          ? (valA as number) - (valB as number)
          : (valB as number) - (valA as number);
      }
    });
  }, [skuPerformance, currentWeekDate, sortColumn, sortDirection]);

  const formatWeekRange = (dateStr: string) => {
    if (!dateStr) return "";
    
    const months: Record<string, string> = {
      jan: '1', feb: '2', mar: '3', apr: '4', may: '5', jun: '6',
      jul: '7', aug: '8', sep: '9', oct: '10', nov: '11', dec: '12'
    };
    
    const weekPattern = /([a-zA-Z]{3})(\d{1,2})-([a-zA-Z]{3})(\d{1,2})/i;
    const match = dateStr.match(weekPattern);
    if (match) {
      const m1Str = match[1].toLowerCase();
      const m2Str = match[3].toLowerCase();
      const m1 = months[m1Str];
      const d1 = parseInt(match[2]);
      const m2 = months[m2Str];
      const d2 = parseInt(match[4]);
      const year = new Date().getFullYear(); 
      
      if (m1 === m2) {
        return `${year}年${m1}月${d1}日-${d2}日`;
      } else {
        return `${year}年${m1}月${d1}日-${m2}月${d2}日`;
      }
    }
    
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const d = new Date(dateStr);
      return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    }
    
    return dateStr;
  };

  // --- 数据备份与恢复 ---
  const exportData = () => {
    const dataStr = JSON.stringify(skuPerformance, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `amz-data-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string);
        setSkuPerformance(importedData);
        // 保存到 localStorage/IndexedDB
        Object.values(importedData).forEach((sku: any) => {
          skuService.saveSku(sku);
        });
        alert("数据导入成功！");
      } catch (err) {
        alert("数据解析失败，请确保文件格式正确。");
      }
    };
    reader.readAsText(file);
  };

  // --- Anomaly Detection ---
  const anomalies = useMemo(() => {
    const findings: SKUAnomaly[] = [];
    const skus = Object.values(skuPerformance) as SKUPerformance[];
    
    if (currentWeekIdx < 0) return [];
    
    skus.forEach(sku => {
      const current = sku.history.find(h => h.date === currentWeekDate);
      if (!current) return;
      
      // Get previous 4 weeks for average
      const historyBefore = sku.history
        .filter(h => getSortableDateValue(h.date) < getSortableDateValue(currentWeekDate))
        .slice(-4);
      
      if (historyBefore.length === 0) return;
      
      const avgOrders = historyBefore.reduce((acc, h) => acc + h.orders, 0) / historyBefore.length;
      const avgCVR = historyBefore.reduce((acc, h) => acc + h.conversionRate, 0) / historyBefore.length;
      const avgSessions = historyBefore.reduce((acc, h) => acc + h.sessions, 0) / historyBefore.length;

      // 1. Sales Drop > 20%
      if (avgOrders >= 3 && current.orders < avgOrders * 0.8) {
        const drop = ((avgOrders - current.orders) / avgOrders * 100).toFixed(0);
        findings.push({
          sku: sku.sku,
          type: 'SALES_DROP',
          severity: parseInt(drop) > 50 ? 'high' : 'medium',
          title: '销量大幅下滑',
          description: `较月均量 (${avgOrders.toFixed(1)}) 下滑了 ${drop}%`,
          changeValue: `-${drop}%`
        });
      }

      // 2. CVR Slump > 25%
      if (avgCVR > 0.015 && current.conversionRate < avgCVR * 0.75) {
        const drop = ((avgCVR - current.conversionRate) / avgCVR * 100).toFixed(0);
        findings.push({
          sku: sku.sku,
          type: 'CVR_DROP',
          severity: 'medium',
          title: '转化率异常',
          description: `当前 ${(current.conversionRate * 100).toFixed(1)}% 远低于均值 ${(avgCVR * 100).toFixed(1)}%`,
          changeValue: `-${drop}%`
        });
      }

      // 3. Traffic Spike but No Orders
      if (current.sessions > avgSessions * 1.5 && current.orders <= avgOrders * 1.1 && current.sessions > 30) {
        findings.push({
          sku: sku.sku,
          type: 'TRAFFIC_SPIKE_NO_SALES',
          severity: 'high',
          title: '流量异常',
          description: `流量涨至 ${current.sessions} (均值 ${avgSessions.toFixed(0)}) 但订单未增长`,
          changeValue: '流量暴涨'
        });
      }
    });
    
    return findings;
  }, [skuPerformance, currentWeekDate, currentWeekIdx]);

  const saveNote = async (sku: string, date: string, noteText: string) => {
    setSkuPerformance(prev => {
      const next = { ...prev };
      const skuData = { ...next[sku] };
      const historyIndex = skuData.history.findIndex(h => h.date === date);
      
      if (historyIndex >= 0) {
        const historyCopy = [...skuData.history];
        historyCopy[historyIndex] = { ...historyCopy[historyIndex], notes: noteText };
        skuData.history = historyCopy;
        next[sku] = skuData;
        skuService.saveSku(skuData);
      }
      
      return next;
    });
  };

  return (
    <div className="flex h-screen bg-[#F1F5F9] font-sans text-slate-900 overflow-hidden relative">
      {/* Toast Notification Layer */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div 
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-5 right-5 z-50 p-4 bg-slate-900 border border-slate-800 text-white rounded-xl shadow-2xl flex items-center gap-3 font-bold text-xs"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar Navigation */}
      <aside className="w-64 bg-[#0F172A] text-slate-300 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20 ring-1 ring-white/10">
              <BarChart3 size={18} />
            </div>
            <h1 className="font-bold text-lg text-white tracking-tight">SellerPulse</h1>
          </div>
        </div>

        <div className="p-4 border-b border-slate-800 space-y-3">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">当前店铺</p>
          <div className="space-y-2">
            <select 
              value={activeStoreId}
              onChange={(e) => setActiveStoreId(e.target.value)}
              className="w-full bg-slate-800 border-slate-700 text-slate-200 text-xs font-bold rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 transition-all cursor-pointer"
            >
              {stores.map(store => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
            <button 
              onClick={() => setShowStoreManager(true)}
              className="w-full px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 rounded-lg flex items-center justify-center gap-2 transition-all text-[10px] font-bold"
            >
              <RefreshCw size={12} /> 管理店铺
            </button>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-1">
          <button 
            onClick={() => setView("dashboard")}
            className={cn(
              "w-full px-4 py-3 rounded-lg flex items-center gap-3 transition-all duration-200 group text-left",
              view === "dashboard" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20" : "hover:bg-slate-800 text-slate-400 hover:text-slate-200"
            )}
          >
            <BarChart3 size={18} className={cn(view === "dashboard" ? "text-white" : "text-slate-500 group-hover:text-slate-300")} />
            <span className="font-medium text-sm">每周看板</span>
          </button>

          <button 
            onClick={() => setView("inventory")}
            className={cn(
              "w-full px-4 py-3 rounded-lg flex items-center gap-3 transition-all duration-200 group text-left",
              view === "inventory" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20" : "hover:bg-slate-800 text-slate-400 hover:text-slate-200"
            )}
          >
            <Package size={18} className={cn(view === "inventory" ? "text-white" : "text-slate-500 group-hover:text-slate-300")} />
            <span className="font-medium text-sm">库存智能备货</span>
          </button>

          <button 
            onClick={() => setView("upload")}
            className={cn(
              "w-full px-4 py-3 rounded-lg flex items-center gap-3 transition-all duration-200 group text-left",
              view === "upload" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20" : "hover:bg-slate-800 text-slate-400 hover:text-slate-200"
            )}
          >
            <Upload size={18} className={cn(view === "upload" ? "text-white" : "text-slate-500 group-hover:text-slate-300")} />
            <span className="font-medium text-sm">数据导入</span>
          </button>
        </nav>

        <div className="p-4 bg-slate-800/50 m-4 rounded-xl border border-slate-700/50 space-y-3">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">数据安全</p>
          <button 
            onClick={exportData}
            className="w-full px-3 py-2 bg-slate-800 hover:bg-indigo-600/20 hover:text-indigo-400 border border-slate-700 rounded-lg flex items-center gap-2 transition-all text-xs font-medium"
          >
            <Download size={14} /> 导出备份 (JSON)
          </button>
          <label className="w-full px-3 py-2 bg-slate-800 hover:bg-emerald-600/20 hover:text-emerald-400 border border-slate-700 rounded-lg flex items-center gap-2 transition-all text-xs font-medium cursor-pointer">
            <Upload size={14} /> 恢复/导入备份
            <input type="file" className="hidden" accept=".json" onChange={importData} />
          </label>
        </div>

        <div className="p-4 border-t border-slate-800">
          <button 
            onClick={async () => {
              if (window.confirm("确定要清除所有本地存储的数据吗？此操作不可撤销，已上传的文件对应的解析记录将全部被擦除。")) {
                await skuService.clearAllData();
                setSkuPerformance({});
                setSelectedSku(null);
                setUploadStatus({ sales: false, inventory: false });
                setView("upload");
              }
            }} 
            className="w-full px-3 py-2.5 bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white border border-rose-500/20 rounded-lg flex items-center justify-center gap-2 transition-all text-sm font-bold shadow-sm"
          >
            <XCircle size={16} /> 清空本地数据
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 z-10">
          <div className="flex items-center gap-4">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">业务概览:</span>
            
            {availableWeeks.length > 0 && (
              <div className="flex items-center gap-2">
                <select 
                  value={selectedWeekIndex}
                  onChange={(e) => setSelectedWeekIndex(parseInt(e.target.value))}
                  className="bg-slate-100 border-none text-xs font-bold text-indigo-600 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer hover:bg-slate-200 transition-colors"
                >
                  <option value={-1}>{formatWeekRange(availableWeeks[availableWeeks.length-1])} (最新)</option>
                  {availableWeeks.slice(0, -1).reverse().map((date) => (
                    <option key={date} value={availableWeeks.indexOf(date)}>
                      {formatWeekRange(date)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex bg-slate-100 rounded-lg p-1 ml-2">
              <button className="px-4 py-1.5 text-sm font-semibold bg-white rounded shadow-sm text-indigo-600 ring-1 ring-slate-200/5">周增长(WoW)</button>
            </div>
          </div>
          
          <div className="flex items-center gap-8">
            {Object.keys(skuPerformance).length > 0 && (
              <div className="text-right">
                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">该周总销售额</p>
                <div className="flex items-center gap-2 justify-end">
                  <p className="text-xl font-bold text-slate-900">
                    ${(Object.values(skuPerformance) as SKUPerformance[]).reduce((acc, curr) => {
                      const target = curr.history.find(h => h.date === currentWeekDate);
                      return acc + (target?.totalSales || 0);
                    }, 0).toLocaleString()}
                  </p>
                  {(() => {
                    if (currentWeekIdx <= 0) return null;
                    const prevWeekDate = availableWeeks[currentWeekIdx - 1];
                    const currentTotal = (Object.values(skuPerformance) as SKUPerformance[]).reduce((acc, curr) => {
                      const target = curr.history.find(h => h.date === currentWeekDate);
                      return acc + (target?.totalSales || 0);
                    }, 0);
                    const prevTotal = (Object.values(skuPerformance) as SKUPerformance[]).reduce((acc, curr) => {
                      const target = curr.history.find(h => h.date === prevWeekDate);
                      return acc + (target?.totalSales || 0);
                    }, 0);
                    const diff = prevTotal > 0 ? ((currentTotal - prevTotal) / prevTotal) * 100 : 0;
                    return (
                      <span className={cn(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded border",
                        diff >= 0 ? "text-emerald-500 bg-emerald-50 border-emerald-100" : "text-rose-500 bg-rose-50 border-rose-100"
                      )}>
                        {diff >= 0 ? "+" : ""}{diff.toFixed(1)}%
                      </span>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-[#F8FAFC]">
          {view === "upload" && (
            <div className="max-w-5xl mx-auto py-16 px-8">
              <header className="mb-12 flex justify-between items-end">
                <div>
                  <h2 className="text-4xl font-extrabold tracking-tight text-slate-900 mb-4">流程集成</h2>
                  <p className="text-lg text-slate-500 max-w-2xl leading-relaxed">
                    连接您的亚马逊数据流。正在为 <span className="text-indigo-600 font-bold underline decoration-2 underline-offset-4">{stores.find(s => s.id === activeStoreId)?.name}</span> 导入数据。
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl px-4 py-2 shadow-sm flex items-center gap-3">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></div>
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">目标店铺: {stores.find(s => s.id === activeStoreId)?.name}</span>
                </div>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Sales Report Upload */}
                <div 
                  onClick={() => salesInputRef.current?.click()}
                  className={cn(
                    "group bg-white border p-10 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer relative overflow-hidden",
                    uploadStatus.sales ? "border-emerald-500 bg-emerald-50/20" : "border-slate-200 hover:border-indigo-300"
                  )}
                >
                  <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
                    <FileText size={120} />
                  </div>
                  {uploadStatus.sales && (
                    <div className="absolute top-4 right-4 text-emerald-500">
                      <CheckCircle2 size={24} />
                    </div>
                  )}
                  <div className={cn(
                    "w-14 h-14 rounded-xl flex items-center justify-center mb-6 transition-all duration-300",
                    uploadStatus.sales ? "bg-emerald-500 text-white" : "bg-indigo-50 border border-indigo-100 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white"
                  )}>
                    <FileText size={28} />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">销售业绩报告</h3>
                  <p className="text-slate-500 text-sm leading-relaxed mb-8">处理每周业务报告（导出为 CSV 或 TXT）。支持多文件选择以进行周期性分析。</p>
                  <input 
                    type="file" 
                    ref={salesInputRef}
                    className="hidden" 
                    accept=".csv,.txt,.tsv"
                    multiple
                    onChange={handleSalesUpload}
                  />
                  <div className={cn(
                    "inline-flex items-center gap-2 px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-md border",
                    uploadStatus.sales ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-indigo-50 text-indigo-700 border-indigo-100"
                  )}>
                    {uploadStatus.sales ? "数据已导入" : "支持批量选择"}
                  </div>
                </div>

                {/* Inventory Report Upload */}
                <div 
                  onClick={() => inventoryInputRef.current?.click()}
                  className={cn(
                    "group bg-white border p-10 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer relative overflow-hidden",
                    uploadStatus.inventory ? "border-emerald-500 bg-emerald-50/20" : "border-slate-200 hover:border-emerald-300"
                  )}
                >
                  <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
                    <Package size={120} />
                  </div>
                  {uploadStatus.inventory && (
                    <div className="absolute top-4 right-4 text-emerald-500">
                      <CheckCircle2 size={24} />
                    </div>
                  )}
                  <div className={cn(
                    "w-14 h-14 rounded-xl flex items-center justify-center mb-6 transition-all duration-300",
                    uploadStatus.inventory ? "bg-emerald-500 text-white" : "bg-emerald-50 border border-emerald-100 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white"
                  )}>
                    <Package size={28} />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">库存存量帐目</h3>
                  <p className="text-slate-500 text-sm leading-relaxed mb-8">集成当前 FBA 库存水平（支持 CSV 或 TXT 报告）。将销售速度与库存风险相关联。</p>
                  <input 
                    type="file" 
                    ref={inventoryInputRef}
                    className="hidden" 
                    accept=".csv,.txt,.tsv"
                    onChange={handleInventoryUpload}
                  />
                  <div className={cn(
                    "inline-flex items-center gap-2 px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-md border",
                    uploadStatus.inventory ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-emerald-50 text-emerald-700 border-emerald-100"
                  )}>
                    {uploadStatus.inventory ? "库存同步完成" : "库存关联"}
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {isProcessing && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-12 p-8 bg-indigo-600 rounded-2xl shadow-2xl shadow-indigo-200 flex items-center justify-between text-white"
                  >
                    <div className="flex items-center gap-6">
                      <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                        <Loader2 className="animate-spin" size={24} />
                      </div>
                      <div>
                        <p className="font-bold text-lg leading-tight">正在处理市场数据</p>
                        <p className="text-indigo-100 text-sm opacity-80">重建 SKU 性能历史记录...</p>
                      </div>
                    </div>
                    <div className="text-[10px] font-mono tracking-widest opacity-50 uppercase">Session: {Math.random().toString(36).substring(7).toUpperCase()}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {view === "dashboard" && (
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
          )}

          {view === "inventory" && (
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
                const totalCurrent = currentStoreSkus.reduce((acc, curr) => acc + (curr.currentStock || 0), 0);
                const totalInTransit = currentStoreSkus.reduce((acc, curr) => acc + (curr.inTransitStock || 0), 0);
                const activeSkuCount = currentStoreSkus.length;
                
                // Count alerts: total stock (current + transit) is less than Reorder Point or safety stock
                const alertCount = currentStoreSkus.filter(s => {
                  const history = s.history || [];
                  const totalOrders = history.reduce((sum, h) => sum + (h.orders || 0), 0);
                  const totalDays = history.length * 7;
                  const avgDailySales = totalDays > 0 ? (totalOrders / totalDays) : 0;
                  const leadTimeDemand = avgDailySales * (s.leadTimeDays ?? 30);
                  const safetyStock = avgDailySales * (s.safetyStockDays ?? 15);
                  const reorderPoint = leadTimeDemand + safetyStock;
                  const effectiveStock = (s.currentStock || 0) + (excludeInTransit ? 0 : (s.inTransitStock || 0));
                  return effectiveStock < reorderPoint;
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
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">当前在库在仓</span>
                        <p className="text-3xl font-extrabold text-slate-900 tracking-tight">{totalCurrent.toLocaleString()} 件</p>
                      </div>
                      <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl"><Package size={20} /></div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">在途及入仓存货</span>
                        <p className="text-3xl font-extrabold text-slate-900 tracking-tight">{totalInTransit.toLocaleString()} 件</p>
                      </div>
                      <div className="p-3 bg-blue-50 text-blue-600 rounded-xl"><RefreshCw size={20} /></div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">备货缺发警戒款数</span>
                        <p className="text-3xl font-extrabold text-rose-600 tracking-tight">{alertCount} 提警</p>
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
                        </div>

                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pt-2 border-t border-slate-100">
                          <span className="text-[10px] text-slate-400 font-bold">* 提示：批量应用后会清空当前店铺 SKU 的单包预测缓存，需点击 “AI/备货分析” 重绘最新诊断。</span>
                          <div className="flex gap-2 self-end sm:self-auto">
                            <button
                              onClick={() => {
                                setBatchValues({ inTransitArriveDays: "", leadTimeDays: "", safetyStockDays: "", inTransitStock: "" });
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
                              title="当前在库库存 (Current On-hand)"
                              content="海外亚马逊 FBA 实货在库数量 + 本地原材料待打包成品库存（如已录入）。这是您随时可见的物理安全成品现货。"
                              position="bottom"
                            >
                              <span>当前在库</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-3 text-center">
                            <InfoTooltip
                              title="在途数量 (In-transit Stock)"
                              content="已经成箱下线、采购付发或处于跨境船运/空运等前置运输途中的集装箱内货物，短期内即将解冻变成可售件数。"
                              position="bottom"
                            >
                              <span>在途数量</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-3 text-center">
                            <InfoTooltip
                              title="在途到仓天数 (Transit Days)"
                              content="已经在物流途中的这批货物，预计还需运输漂流多少个天数，才能完成目的港清关、陆运派送，被海外 FBA 仓签收并完全上架变为可售件数。"
                              position="bottom"
                            >
                              <span>在途到仓(天)</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-3 text-center">
                            <InfoTooltip
                              title="头程前置天数 (Lead Time - LT)"
                              content="从计划向工厂下单、备料排单生产、国内陆运发货、海外海运漂洋、目的港清关、卡派送仓至完全上架的期望累计总响应天数。"
                              position="bottom"
                            >
                              <span>头程前置(天)</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-3 text-center">
                            <InfoTooltip
                              title="安全缓冲天数 (Safety Stock Days - SS)"
                              content="为应对因清关滞留、旺季塞港甩箱、排仓、海运延误或突发的销量暴涨等异常状况，预备建立的缓冲天数，防止因外部被动断货导致排名流失。"
                              position="bottom"
                            >
                              <span>安全缓冲(天)</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-3 text-center">
                            <InfoTooltip
                              title="剩余周转天数 (Days of Supply)"
                              content="通过对最近数周的平均流速进行日历加权动态平滑后，当前的总在库在仓可用现货还足够支撑您卖多少天。反映库存库容健康度的敏感指标。"
                              position="bottom"
                            >
                              <span>剩余周转</span>
                            </InfoTooltip>
                          </th>
                          <th className="py-4 px-4 text-right">补货操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {(() => {
                          const currentStoreSkus = (Object.values(skuPerformance) as SKUPerformance[]).filter(s => s.storeId === activeStoreId);
                          if (currentStoreSkus.length === 0) {
                            return (
                              <tr>
                                <td colSpan={7} className="py-12 text-center text-slate-400">
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
                            const history = s.history || [];
                            const totalOrders = history.reduce((sum, h) => sum + (h.orders || 0), 0);
                            const totalDays = history.length * 7;
                            const avgDailySales = totalDays > 0 ? (totalOrders / totalDays) : 0.01;
                            
                            const currentStock = s.currentStock ?? 0;
                            const inTransitStock = s.inTransitStock ?? 0;
                            const leadTimeDays = s.leadTimeDays ?? 30;
                            const safetyStockDays = s.safetyStockDays ?? 15;
                            
                            const leadTimeDemand = avgDailySales * leadTimeDays;
                            const safetyStock = avgDailySales * safetyStockDays;
                            const reorderPoint = leadTimeDemand + safetyStock;
                            
                            const effectiveInTransit = (restockMode === 'exclude' || excludeInTransit) ? 0 : inTransitStock;
                            const totalRawStock = s.rawMaterialStock ?? 0;
                            const daysOfSupply = avgDailySales > 0 ? ((currentStock + totalRawStock + effectiveInTransit) / avgDailySales) : 0;
                            const totalInvCurrent = currentStock + totalRawStock + effectiveInTransit;
                            const isBelowROP = totalInvCurrent < reorderPoint;

                            return (
                              <tr 
                                key={`${s.sku}_${currentStock}_${inTransitStock}_${s.inTransitArriveDays ?? 15}_${leadTimeDays}_${safetyStockDays}`} 
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

                                {/* Lead Time Days */}
                                <td className="py-4 px-3 text-center whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1">
                                    <input 
                                      type="number" 
                                      defaultValue={leadTimeDays} 
                                      onBlur={(e) => handleInstantSaveField(s, 'leadTimeDays', parseInt(e.target.value) || 0)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-12 bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded px-1.5 py-1 text-center text-slate-600 outline-none text-xs"
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

                                {/* Days of Supply */}
                                <td className="py-4 px-3 text-center whitespace-nowrap">
                                  <span className={cn(
                                    "px-2 py-1 rounded-full text-[10px] font-extrabold border block w-16 mx-auto text-center",
                                    daysOfSupply >= 45 ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                                    daysOfSupply >= 15 ? "bg-amber-50 text-amber-600 border-amber-100" :
                                    "bg-rose-50 text-rose-600 border-rose-100 animate-pulse"
                                  )}>
                                    {daysOfSupply > 180 ? "180+ 天" : `${Math.round(daysOfSupply)} 天`}
                                  </span>
                                  {excludeInTransit ? (
                                    <span className="text-[9px] text-amber-600 font-bold block mt-1" title="当前已启用已屏蔽在途，仅计算在库及原材料实载可卖周期">
                                      (剔除在途款)
                                    </span>
                                  ) : (
                                    <span className="text-[9px] text-indigo-600 font-bold block mt-1" title="通过多时间轴精算仿真中">
                                      (时间轴仿真)
                                    </span>
                                  )}
                                </td>

                                {/* Action trigger */}
                                <td className="py-4 px-4 text-right whitespace-nowrap">
                                  <div className="flex justify-end items-center gap-1.5">
                                    {isBelowROP ? (
                                      <span className="text-[10px] font-bold bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded border border-amber-500/20 mr-1 text-center" title={`科学安全水位再订货点: ${reorderPoint.toFixed(0)}件`}>
                                        提警采购(ROP:{Math.round(reorderPoint)}件)
                                      </span>
                                    ) : (
                                      <span className="text-[10px] font-medium text-slate-400 mr-2">
                                        水位健全
                                      </span>
                                    )}
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRestockAnalyze(s);
                                      }}
                                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold text-[11px] rounded-lg shadow-sm hover:shadow-xs transition-all flex items-center gap-1 shrink-0"
                                      title="结合采购头程与销售流速进行AI供应链补货精确数学测算"
                                    >
                                      <BrainCircuit size={12} />
                                      AI 备货分析
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
                        sObj.rawMaterialStock !== (insight.rawMaterialStock ?? sObj.rawMaterialStock) ||
                        sObj.inTransitStock !== (insight.inTransitStock ?? sObj.inTransitStock) ||
                        JSON.stringify(sObj.inTransitBatches || []) !== JSON.stringify(insight.inTransitBatches || [])
                      );
                      
                      const h = sObj.history || [];
                      const tot = h.reduce((sum, item) => sum + (item.orders || 0), 0);
                      const days = h.length * 7;
                      const localAvg = days > 0 ? (tot / days) : 1;
                      const currentStock = sObj.currentStock ?? 0;
                      const inTransitStock = sObj.inTransitStock ?? 0;
                      const effectiveInTransit = excludeInTransit ? 0 : inTransitStock;
                      const localReplenish = Math.max(0, Math.ceil((localAvg * restockTargetDays) - currentStock - effectiveInTransit));

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

                                {/* Procurement advise card */}
                                <div className="p-5 bg-gradient-to-br from-indigo-50 to-slate-50 rounded-2xl border border-indigo-100 text-center space-y-1 relative overflow-hidden">
                                  <div className="absolute top-0 right-0 p-1 bg-indigo-600 text-white rounded-bl-lg text-[8px] uppercase tracking-wider font-extrabold">科学采购量</div>
                                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">推荐备货采购数量</p>
                                  <p className="text-3xl font-black text-indigo-700 font-mono tracking-tight">{insight.suggestedQuantity.toLocaleString()} <span className="text-xs font-bold">件</span></p>
                                  <p className="text-[10px] font-medium text-slate-400 leading-normal">
                                    支撑后续目标 {insight.targetCoverageDays} 天良性周转的建议净采购值
                                  </p>
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
                                  <p className="font-bold text-slate-500 mb-1.5 uppercase text-[9px] tracking-wider">即时物理模型估算 (基于历史日均值):</p>
                                  {excludeInTransit && (
                                    <div className="text-[10px] text-amber-600 font-bold bg-amber-500/10 border border-amber-500/15 px-2 py-1 rounded mb-2">
                                      ⚠️ 注意：已屏蔽在途数量 (${inTransitStock} 件)，仅计算在库实物现载供求，用于提前采购下期原料。
                                    </div>
                                  )}
                                  <div className="flex justify-between text-slate-600">
                                    <span>历史日均销售速度:</span>
                                    <span className="font-mono font-bold text-slate-800">{localAvg.toFixed(2)} 件/日</span>
                                  </div>
                                  <div className="flex justify-between text-slate-600">
                                    <span>目标备货周转天数:</span>
                                    <span className="font-mono font-bold text-indigo-600">{restockTargetDays} 天</span>
                                  </div>
                                  <div className="flex justify-between text-slate-600">
                                    <span>计算时扣除在途:</span>
                                    <span className={cn("font-bold text-xs", excludeInTransit ? "text-amber-600" : "text-slate-500")}>
                                      {excludeInTransit ? "是 (剔除在途)" : "否 (计入在途)"}
                                    </span>
                                  </div>
                                  <div className="flex justify-between border-t border-slate-200 pt-1.5 mt-1 font-bold text-slate-800">
                                    <span>本批建议备货量:</span>
                                    <span className="font-mono text-indigo-700">{localReplenish} 件</span>
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
          )}
        </div>
      </main>

      <AnimatePresence>
        {showStoreManager && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowStoreManager(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 className="font-bold text-xl text-slate-900">店铺管理</h3>
                <button onClick={() => setShowStoreManager(false)} className="text-slate-400 hover:text-slate-600">
                  <XCircle size={24} />
                </button>
              </div>
              
              <div className="p-8 space-y-6">
                <div className="space-y-4">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">新增店铺</p>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={newStoreName}
                      onChange={(e) => setNewStoreName(e.target.value)}
                      placeholder="输入店铺名称..."
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <button 
                      onClick={async () => {
                        if (!newStoreName.trim()) return;
                        const newStore: Store = {
                          id: Math.random().toString(36).substring(7),
                          name: newStoreName.trim(),
                          createdAt: new Date().toISOString()
                        };
                        await skuService.saveStore(newStore);
                        setStores(prev => [...prev, newStore]);
                        setActiveStoreId(newStore.id);
                        setNewStoreName("");
                        setShowStoreManager(false);
                      }}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-lg shadow-indigo-200 transition-all active:scale-95"
                    >
                      添加
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">已有店铺 ({stores.length})</p>
                  <div className="max-h-64 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {stores.map(store => (
                      <div key={store.id} className="group flex items-center justify-between p-4 bg-slate-50 hover:bg-white border border-slate-100 hover:border-indigo-200 rounded-2xl transition-all">
                        <div className="flex-1 mr-4">
                          {editingStoreId === store.id ? (
                            <div className="flex gap-2">
                              <input 
                                type="text"
                                value={editingStoreName}
                                onChange={(e) => setEditingStoreName(e.target.value)}
                                className="flex-1 bg-white border border-indigo-200 rounded-lg px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                                autoFocus
                                onKeyDown={async (e) => {
                                  if (e.key === 'Enter') {
                                    const updatedStore = { ...store, name: editingStoreName };
                                    await skuService.saveStore(updatedStore);
                                    setStores(prev => prev.map(s => s.id === store.id ? updatedStore : s));
                                    setEditingStoreId(null);
                                  } else if (e.key === 'Escape') {
                                    setEditingStoreId(null);
                                  }
                                }}
                              />
                              <button 
                                onClick={async () => {
                                  const updatedStore = { ...store, name: editingStoreName };
                                  await skuService.saveStore(updatedStore);
                                  setStores(prev => prev.map(s => s.id === store.id ? updatedStore : s));
                                  setEditingStoreId(null);
                                }}
                                className="p-1 text-emerald-500 hover:bg-emerald-50 rounded"
                              >
                                <CheckCircle2 size={16} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 group/title">
                              <p className="font-bold text-slate-900 text-sm">{store.name}</p>
                              <button 
                                onClick={() => {
                                  setEditingStoreId(store.id);
                                  setEditingStoreName(store.name);
                                }}
                                className="opacity-0 group-hover/title:opacity-100 p-1 text-slate-400 hover:text-indigo-500 transition-all"
                              >
                                <RefreshCw size={12} />
                              </button>
                            </div>
                          )}
                          <p className="text-[10px] text-slate-400">创建于: {new Date(store.createdAt).toLocaleDateString()}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              setActiveStoreId(store.id);
                              setShowStoreManager(false);
                            }}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all",
                              activeStoreId === store.id ? "bg-indigo-600 text-white shadow-indigo-100 shadow-md" : "bg-white text-slate-600 border border-slate-200 hover:border-indigo-300"
                            )}
                          >
                            {activeStoreId === store.id ? "当前" : "切换"}
                          </button>
                          {stores.length > 1 && (
                            <button 
                              onClick={async () => {
                                if (window.confirm(`确定要删除店铺 "${store.name}" 吗？所有关联的数据将被永久清除。`)) {
                                  await skuService.deleteStore(store.id);
                                  const nextStores = stores.filter(s => s.id !== store.id);
                                  setStores(nextStores);
                                  if (activeStoreId === store.id) setActiveStoreId(nextStores[0].id);
                                }
                              }}
                              className="p-2 text-rose-300 hover:text-rose-500 transition-colors"
                            >
                              <XCircle size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {showOverwriteConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8 text-center space-y-4">
                <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto">
                  <AlertTriangle size={32} />
                </div>
                <div className="space-y-2">
                  <h3 className="font-bold text-xl text-slate-900">检测到重复数据</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    发现上传的文件中包含已存在日期的销售数据：<br/>
                    <span className="font-mono text-indigo-600 text-[10px]">{duplicateDates.join(', ')}</span><br/>
                    是否确定要覆盖这些日期的数值？
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-4">
                  <button 
                    onClick={() => {
                      setShowOverwriteConfirm(false);
                      setPendingUploads(null);
                    }}
                    className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-sm font-bold transition-all"
                  >
                    取消
                  </button>
                  <button 
                    onClick={async () => {
                      if (pendingUploads) {
                        await applySalesData(pendingUploads.skus);
                        setShowOverwriteConfirm(false);
                        setPendingUploads(null);
                      }
                    }}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 transition-all active:scale-95"
                  >
                    确认覆盖
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="fixed bottom-0 right-0 p-4 text-[9px] uppercase font-mono opacity-20 tracking-widest select-none pointer-events-none">
        亚马逊运营分析师 // 终端 v1.1.2
      </footer>
    </div>
  );
}
