import React, { useState, useMemo, useEffect } from "react";
import { Download, FileSpreadsheet, ChevronDown, ChevronUp, CheckSquare, Square, Tag } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { SKUPerformance, Store, WeeklyData } from "../../types";
import { cn, downloadCSV } from "../../lib/utils";

interface ExportPanelProps {
  stores: Store[];
  activeStoreId: string;
  skuPerformance: Record<string, SKUPerformance>;
}

// 汇总表列定义：表头 + 从单周数据取值的函数
const COLUMNS: { header: string; get: (h: WeeklyData) => string | number }[] = [
  { header: "时间段", get: (h) => h.date },
  { header: "SKU/ASIN", get: (h) => h.sku },
  { header: "会话数", get: (h) => h.sessions },
  { header: "订单数", get: (h) => h.orders },
  { header: "转化率", get: (h) => (h.conversionRate * 100).toFixed(2) + "%" },
  { header: "销售额", get: (h) => h.totalSales.toFixed(2) },
  { header: "备注", get: (h) => h.notes ?? "" },
];

export function ExportPanel({ stores, activeStoreId, skuPerformance }: ExportPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedSku, setSelectedSku] = useState<string>("");
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());

  const storeName = stores.find((s) => s.id === activeStoreId)?.name ?? activeStoreId;

  const storeSkus = useMemo(() => {
    return Object.values(skuPerformance)
      .filter((s) => s.storeId === activeStoreId && Array.isArray(s.history) && s.history.length > 0)
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [skuPerformance, activeStoreId]);

  const activeSku = useMemo(
    () => storeSkus.find((s) => s.sku === selectedSku) ?? null,
    [storeSkus, selectedSku]
  );

  // history 在存储时已按时间升序排列，导出保持「旧 → 新」顺序
  const skuDates = useMemo(() => (activeSku ? activeSku.history.map((h) => h.date) : []), [activeSku]);

  // 切换店铺或所选 SKU 失效时重置选择，并默认全选所有周次
  useEffect(() => {
    if (selectedSku && !storeSkus.some((s) => s.sku === selectedSku)) {
      setSelectedSku("");
    }
  }, [storeSkus, selectedSku]);

  useEffect(() => {
    setSelectedDates(new Set(skuDates));
  }, [skuDates]);

  const toggleDate = (date: string) => {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  };

  const toggleAllDates = () => {
    setSelectedDates(selectedDates.size === skuDates.length ? new Set() : new Set(skuDates));
  };

  const handleExport = () => {
    if (!activeSku || selectedDates.size === 0) return;
    const rows: (string | number)[][] = [COLUMNS.map((c) => c.header)];
    activeSku.history
      .filter((h) => selectedDates.has(h.date))
      .forEach((h) => rows.push(COLUMNS.map((c) => c.get(h))));

    const safeSku = activeSku.sku.replace(/[\\/:*?"<>|]/g, "_");
    const today = new Date().toISOString().split("T")[0];
    downloadCSV(`${safeSku}_汇总_${today}.csv`, rows);
  };

  return (
    <div className="mt-8 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-8 py-5 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
            <FileSpreadsheet size={18} className="text-indigo-500" />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-slate-800">导出汇总表</p>
            <p className="text-xs text-slate-400">把某个 ASIN 的多周数据汇总导出为 CSV，每行一个时间段</p>
          </div>
        </div>
        {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-8 pb-6 border-t border-slate-100 space-y-6">
              {storeSkus.length === 0 ? (
                <p className="text-sm text-slate-400 py-6 text-center">当前店铺暂无可导出的销售数据</p>
              ) : (
                <>
                  {/* ── 选择 ASIN ── */}
                  <div className="pt-5">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">选择 ASIN / SKU</p>
                    <div className="relative">
                      <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <select
                        value={selectedSku}
                        onChange={(e) => setSelectedSku(e.target.value)}
                        className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-9 py-2.5 text-sm text-slate-700 font-mono focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all"
                      >
                        <option value="">— 请选择一个 ASIN —</option>
                        {storeSkus.map((s) => (
                          <option key={s.sku} value={s.sku}>
                            {s.sku}
                            {s.name ? `（${s.name}）` : ""} · {s.history.length} 周
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* ── 选择周期 ── */}
                  {activeSku && (
                    <div className="border-t border-slate-100 pt-5">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">选择导出周期</p>
                        <span className="text-xs text-slate-400">已选 {selectedDates.size} / {skuDates.length} 周</span>
                      </div>
                      <button
                        onClick={toggleAllDates}
                        className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors mb-2"
                      >
                        {selectedDates.size === skuDates.length && skuDates.length > 0 ? (
                          <CheckSquare size={14} className="text-indigo-500" />
                        ) : (
                          <Square size={14} />
                        )}
                        {selectedDates.size === skuDates.length ? "取消全选" : "全选"}
                      </button>

                      <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                        {[...activeSku.history].reverse().map((h) => {
                          const selected = selectedDates.has(h.date);
                          return (
                            <button
                              key={h.date}
                              onClick={() => toggleDate(h.date)}
                              className={cn(
                                "w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-all",
                                selected
                                  ? "bg-indigo-50 border border-indigo-200 text-indigo-700"
                                  : "bg-slate-50 border border-slate-100 text-slate-600 hover:border-slate-200"
                              )}
                            >
                              <div className="flex items-center gap-2.5">
                                {selected ? (
                                  <CheckSquare size={14} className="text-indigo-500 shrink-0" />
                                ) : (
                                  <Square size={14} className="text-slate-300 shrink-0" />
                                )}
                                <span className="font-mono font-semibold">{h.date}</span>
                              </div>
                              <span className={cn("text-xs", selected ? "text-indigo-400" : "text-slate-400")}>
                                {h.sessions} 会话 · ${h.totalSales.toFixed(0)}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <button
                        onClick={handleExport}
                        disabled={selectedDates.size === 0}
                        className={cn(
                          "mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all",
                          selectedDates.size > 0
                            ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                            : "bg-slate-100 text-slate-400 cursor-not-allowed"
                        )}
                      >
                        <Download size={15} />
                        导出「{activeSku.sku}」{selectedDates.size > 0 ? `${selectedDates.size} 周` : ""}汇总 CSV
                      </button>
                      <p className="text-[11px] text-slate-400 mt-2 text-center">
                        来自店铺「{storeName}」· 每行一个时间段，列为上传的销售指标
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
