import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Upload, Download, Package,
  BarChart3, RefreshCw, CheckCircle2, XCircle, AlertTriangle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { WeeklyData, InventoryData, SKUPerformance, AIInsight, Store, OperationAction, SKUAnomaly } from "./types";
import { skuService } from "./lib/skuService";
import { cn } from "./lib/utils";
import { detectEncodingAndParse } from "./lib/csvParser";
import { resolveParams, computeTwoStage } from "./lib/inventoryModel";
import { InfoTooltip } from "./components/common/InfoTooltip";
import { InventoryView } from "./components/inventory/InventoryView";
import { DashboardView } from "./components/dashboard/DashboardView";
import { UploadView } from "./components/upload/UploadView";

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
    inTransitStock: "",
    shipmentCycleDays: "",
    localStockCycles: ""
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
      localStock: skuPerf.localStock ?? skuPerf.rawMaterialStock ?? 0,
      procurementLeadDays: skuPerf.procurementLeadDays ?? skuPerf.leadTimeDays ?? 30,
      localStockCycles: skuPerf.localStockCycles ?? 1,
      shipmentCycleDays: skuPerf.shipmentCycleDays ?? 30,
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

      // ===== 统一两段式模型 (与列表/服务端同源) =====
      const twoStageParams = resolveParams(skuWithParams);
      const twoStage = computeTwoStage(twoStageParams, restockTargetDays);
      const timelineSim = twoStage.fbaTimeline; // 已修复: 物理库存封底, 断货不结转负债
      const simDaysLimit = Math.max(90, restockTargetDays);

      // 断货窗口信息 (供解释文案使用)
      const isOutOfStockEver = twoStage.daysUntilFbaStockout !== -1;
      const outOfStockDayStart = twoStage.daysUntilFbaStockout;
      const stockoutEndPoint = timelineSim.filter(t => t.stock <= 0).map(t => t.day);
      const outOfStockDayEnd = stockoutEndPoint.length > 0 ? stockoutEndPoint[stockoutEndPoint.length - 1] : -1;
      const outOfStockDaysCount = stockoutEndPoint.length;
      const minInventory = Math.min(...timelineSim.map(t => t.stock));

      // 两个核心决策
      const shipToFbaQty = twoStage.shipToFbaQty;
      const procureQty = twoStage.procureQty;
      // 本地模型给出的"本批采购建议量"以采购回仓为准
      const suggestedQuantity = procureQty;

      const effectiveInTransit = activeInTransitStock;
      const localStock = twoStageParams.localStock;
      const fbaAvailable = currentStock + activeInTransitStock;
      // FBA 端现货可撑天数 (到在途到货前)
      const fbaDaysLeft = avgDailySales > 0 ? Math.floor(currentStock / avgDailySales) : 999;
      const daysOfSupply = avgDailySales > 0 ? Number(((currentStock + localStock + effectiveInTransit) / avgDailySales).toFixed(1)) : 999;

      const fallbackResult = {
        avgDailySales,
        leadTimeDemand,
        safetyStock,
        reorderPoint,
        daysOfSupply,
        suggestedQuantity,
        shipToFbaQty,
        shipToFbaConstrained: twoStage.shipToFbaConstrained,
        procureQty,
        daysUntilFbaStockout: twoStage.daysUntilFbaStockout,
        targetCoverageDays: restockTargetDays,
        timelineSim,
        restockMode: activeMode,
        inTransitArriveDays,
        explanation: `[本地两段式库存模型测算结果 — AI 服务繁忙时自动启用，数学口径与列表完全一致]

【两段式补货诊断 · 本地】

1. 销量流速：该 SKU 日均销量约 ${avgDailySales.toFixed(2)} 件/天。
2. FBA 端现状：FBA 可售 ${currentStock} 件，去 FBA 在途 ${activeInTransitStock} 件（预计第 ${inTransitArriveDays} 天到仓）。${
   isOutOfStockEver
     ? `\n   🚨 断货预警：FBA 现货仅够卖约 ${fbaDaysLeft} 天，逐日仿真显示在第 ${outOfStockDayStart} 天起会出现断货（共约 ${outOfStockDaysCount} 天），需尽快发货补充。`
     : `\n   🟢 FBA 端在覆盖期内不会断货，节奏健康。`
   }
3. 本期发往 FBA：建议从本地成品发 ${shipToFbaQty} 件去亚马逊${twoStage.shipToFbaConstrained ? `（注意：本地成品 ${localStock} 件不足以发满建议量，需先采购补充本地成品）` : ""}。
4. 本期采购回仓：建议采购 ${procureQty} 件成品回本地仓库，按你设的常备 ${twoStageParams.localStockCycles} 个发货周期恢复水位。
5. 下单时机：采购到可发货约需 ${twoStageParams.procurementLeadDays} 天，建议在本地成品见底前留足这段前置期下单。`,
        analyzedAt: new Date().toISOString()
      };

      const fallbackResultWithSnapshot = {
        ...fallbackResult,
        currentStock: skuWithParams.currentStock,
        localStock: skuWithParams.localStock,
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
    if (batchValues.shipmentCycleDays !== "") {
      updates.shipmentCycleDays = parseInt(batchValues.shipmentCycleDays) || 0;
    }
    if (batchValues.localStockCycles !== "") {
      updates.localStockCycles = Math.max(1, parseInt(batchValues.localStockCycles) || 1);
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
      if (k === 'shipmentCycleDays') return '发货周期天数';
      if (k === 'localStockCycles') return '本地常备周期数';
      return k;
    }).join('、')}`);

    // Hide batch panel and clear values
    setShowBatchPanel(false);
    setBatchValues({
      inTransitArriveDays: "",
      leadTimeDays: "",
      safetyStockDays: "",
      inTransitStock: "",
      shipmentCycleDays: "",
      localStockCycles: ""
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
            <UploadView
              stores={stores}
              activeStoreId={activeStoreId}
              isProcessing={isProcessing}
              uploadStatus={uploadStatus}
              salesInputRef={salesInputRef}
              inventoryInputRef={inventoryInputRef}
              handleSalesUpload={handleSalesUpload}
              handleInventoryUpload={handleInventoryUpload}
            />
          )}

          {view === "dashboard" && (
            <DashboardView
              skuPerformance={skuPerformance}
              selectedSku={selectedSku}
              setSelectedSku={setSelectedSku}
              sortedSkus={sortedSkus}
              anomalies={anomalies}
              availableWeeks={availableWeeks}
              currentWeekIdx={currentWeekIdx}
              currentWeekDate={currentWeekDate}
              chartMetric={chartMetric}
              setChartMetric={setChartMetric}
              isEditingRemark={isEditingRemark}
              setIsEditingRemark={setIsEditingRemark}
              tempRemark={tempRemark}
              setTempRemark={setTempRemark}
              isAddingAction={isAddingAction}
              setIsAddingAction={setIsAddingAction}
              actionType={actionType}
              setActionType={setActionType}
              actionTitle={actionTitle}
              setActionTitle={setActionTitle}
              actionDetails={actionDetails}
              setActionDetails={setActionDetails}
              actionStatus={actionStatus}
              setActionStatus={setActionStatus}
              analyzeSku={analyzeSku}
              saveNote={saveNote}
              formatWeekRange={formatWeekRange}
              getFunnelAttribution={getFunnelAttribution}
              getSortableDateValue={getSortableDateValue}
              evaluateActionPerformance={evaluateActionPerformance}
              renderSortArrows={renderSortArrows}
              handleSaveRemark={handleSaveRemark}
              handleAddAction={handleAddAction}
              handleDeleteAction={handleDeleteAction}
              handleUpdateActionStatus={handleUpdateActionStatus}
              handleAdoptRecommendation={handleAdoptRecommendation}
            />
          )}

          {view === "inventory" && (
            <InventoryView
              skuPerformance={skuPerformance}
              setSkuPerformance={setSkuPerformance}
              activeStoreId={activeStoreId}
              restockTargetDays={restockTargetDays}
              setRestockTargetDays={setRestockTargetDays}
              excludeInTransit={excludeInTransit}
              restockSku={restockSku}
              setRestockSku={setRestockSku}
              restockMode={restockMode}
              isRestockLoading={isRestockLoading}
              savingSku={savingSku}
              setSavingSku={setSavingSku}
              showBatchPanel={showBatchPanel}
              setShowBatchPanel={setShowBatchPanel}
              batchValues={batchValues}
              setBatchValues={setBatchValues}
              handleApplyBatchChanges={handleApplyBatchChanges}
              handleRestockAnalyze={handleRestockAnalyze}
              showToast={showToast}
            />
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
