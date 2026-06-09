import React, { useState, useMemo } from "react";
import { Trash2, AlertTriangle, CheckSquare, Square, ChevronDown, ChevronUp, Database, Package, Tag } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { SKUPerformance, Store } from "../../types";
import { cn } from "../../lib/utils";

interface DataManagePanelProps {
  stores: Store[];
  activeStoreId: string;
  skuPerformance: Record<string, SKUPerformance>;
  onDeleteDates: (storeId: string, dates: string[]) => Promise<void>;
  onClearInventory: (storeId: string) => Promise<void>;
  onDeleteSkus: (storeId: string, skus: string[]) => Promise<void>;
}

type ConfirmTarget = "sales" | "inventory" | "skus" | null;

export function DataManagePanel({ stores, activeStoreId, skuPerformance, onDeleteDates, onClearInventory, onDeleteSkus }: DataManagePanelProps) {
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget>(null);
  const [expanded, setExpanded] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const storeName = stores.find(s => s.id === activeStoreId)?.name ?? activeStoreId;

  const allDates = useMemo(() => {
    const dateMap = new Map<string, number>();
    Object.values(skuPerformance).forEach(sku => {
      if (sku.storeId !== activeStoreId || !Array.isArray(sku.history)) return;
      sku.history.forEach(h => {
        dateMap.set(h.date, (dateMap.get(h.date) ?? 0) + 1);
      });
    });
    return Array.from(dateMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, count]) => ({ date, skuCount: count }));
  }, [skuPerformance, activeStoreId]);

  const allSkus = useMemo(() => {
    return Object.values(skuPerformance)
      .filter(s => s.storeId === activeStoreId)
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [skuPerformance, activeStoreId]);

  const stockSkuCount = useMemo(() => {
    return allSkus.filter(s => (s.currentStock ?? 0) > 0).length;
  }, [allSkus]);

  const toggleDate = (date: string) => {
    setSelectedDates(prev => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  };

  const toggleAllDates = () => {
    setSelectedDates(selectedDates.size === allDates.length ? new Set() : new Set(allDates.map(d => d.date)));
  };

  const toggleSku = (sku: string) => {
    setSelectedSkus(prev => {
      const next = new Set(prev);
      next.has(sku) ? next.delete(sku) : next.add(sku);
      return next;
    });
  };

  const toggleAllSkus = () => {
    setSelectedSkus(selectedSkus.size === allSkus.length ? new Set() : new Set(allSkus.map(s => s.sku)));
  };

  const handleConfirm = async () => {
    setIsDeleting(true);
    setErrorMsg(null);
    const target = confirmTarget;
    setConfirmTarget(null);
    try {
      if (target === "sales") {
        await onDeleteDates(activeStoreId, Array.from(selectedDates));
        setSelectedDates(new Set());
      } else if (target === "inventory") {
        await onClearInventory(activeStoreId);
      } else if (target === "skus") {
        await onDeleteSkus(activeStoreId, Array.from(selectedSkus));
        setSelectedSkus(new Set());
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "操作失败，请查看控制台日志");
    } finally {
      setIsDeleting(false);
    }
  };

  const ConfirmBox = ({ type, message }: { type: ConfirmTarget; message: string }) => (
    confirmTarget === type ? (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-700">确认删除？</p>
            <p className="text-xs text-red-500 mt-0.5">{message}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleConfirm} disabled={isDeleting}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50">
            {isDeleting ? "处理中..." : "确认删除"}
          </button>
          <button onClick={() => setConfirmTarget(null)}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50 transition-colors">
            取消
          </button>
        </div>
      </div>
    ) : null
  );

  return (
    <div className="mt-8 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-8 py-5 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center">
            <Database size={18} className="text-red-500" />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-slate-800">数据管理</p>
            <p className="text-xs text-slate-400">删除错误上传的销售、库存或 SKU 数据</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {allSkus.length > 0 && (
            <span className="text-xs font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
              {allSkus.length} 个 SKU
            </span>
          )}
          {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
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
              {errorMsg && (
                <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* ── SKU 删除 ── */}
              <div className="pt-5">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">删除 SKU</p>
                {allSkus.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center">当前店铺暂无 SKU</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <button onClick={toggleAllSkus}
                        className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors">
                        {selectedSkus.size === allSkus.length
                          ? <CheckSquare size={14} className="text-indigo-500" />
                          : <Square size={14} />}
                        {selectedSkus.size === allSkus.length ? "取消全选" : "全选"}
                      </button>
                      <span className="text-xs text-slate-400">已选 {selectedSkus.size} / {allSkus.length} 个</span>
                    </div>

                    <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                      {allSkus.map(s => {
                        const selected = selectedSkus.has(s.sku);
                        return (
                          <button key={s.sku} onClick={() => toggleSku(s.sku)}
                            className={cn(
                              "w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-all",
                              selected
                                ? "bg-red-50 border border-red-200 text-red-700"
                                : "bg-slate-50 border border-slate-100 text-slate-600 hover:border-slate-200"
                            )}>
                            <div className="flex items-center gap-2.5">
                              {selected
                                ? <CheckSquare size={14} className="text-red-500 shrink-0" />
                                : <Square size={14} className="text-slate-300 shrink-0" />}
                              <Tag size={12} className="shrink-0 opacity-50" />
                              <span className="font-mono text-xs font-semibold">{s.sku}</span>
                              {s.name && <span className="text-xs text-slate-400 truncate max-w-[120px]">{s.name}</span>}
                            </div>
                            <span className={cn("text-xs shrink-0", selected ? "text-red-400" : "text-slate-400")}>
                              {(s.history || []).length} 周数据
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-4">
                      <ConfirmBox type="skus"
                        message={`将从店铺「${storeName}」中永久删除所选 ${selectedSkus.size} 个 SKU 及其全部数据，此操作不可撤销。`} />
                      {confirmTarget !== "skus" && (
                        <button
                          onClick={() => setConfirmTarget("skus")}
                          disabled={selectedSkus.size === 0 || isDeleting}
                          className={cn(
                            "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all",
                            selectedSkus.size > 0
                              ? "bg-red-600 hover:bg-red-700 text-white shadow-sm"
                              : "bg-slate-100 text-slate-400 cursor-not-allowed"
                          )}>
                          <Trash2 size={15} />
                          删除所选 {selectedSkus.size > 0 ? `${selectedSkus.size} 个` : ""}SKU
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* ── 销售历史 ── */}
              <div className="border-t border-slate-100 pt-5">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">销售历史数据</p>
                {allDates.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center">当前店铺暂无销售历史数据</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <button onClick={toggleAllDates}
                        className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors">
                        {selectedDates.size === allDates.length
                          ? <CheckSquare size={14} className="text-indigo-500" />
                          : <Square size={14} />}
                        {selectedDates.size === allDates.length ? "取消全选" : "全选"}
                      </button>
                      <span className="text-xs text-slate-400">已选 {selectedDates.size} / {allDates.length} 周</span>
                    </div>

                    <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                      {allDates.map(({ date, skuCount }) => {
                        const selected = selectedDates.has(date);
                        return (
                          <button key={date} onClick={() => toggleDate(date)}
                            className={cn(
                              "w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-all",
                              selected
                                ? "bg-red-50 border border-red-200 text-red-700"
                                : "bg-slate-50 border border-slate-100 text-slate-600 hover:border-slate-200"
                            )}>
                            <div className="flex items-center gap-2.5">
                              {selected
                                ? <CheckSquare size={14} className="text-red-500 shrink-0" />
                                : <Square size={14} className="text-slate-300 shrink-0" />}
                              <span className="font-mono font-semibold">{date}</span>
                            </div>
                            <span className={cn("text-xs", selected ? "text-red-400" : "text-slate-400")}>
                              涉及 {skuCount} 个 SKU
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-4">
                      <ConfirmBox type="sales"
                        message={`将从「${storeName}」永久删除所选 ${selectedDates.size} 个周次的销售数据，此操作不可撤销。`} />
                      {confirmTarget !== "sales" && (
                        <button
                          onClick={() => setConfirmTarget("sales")}
                          disabled={selectedDates.size === 0 || isDeleting}
                          className={cn(
                            "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all",
                            selectedDates.size > 0
                              ? "bg-red-600 hover:bg-red-700 text-white shadow-sm"
                              : "bg-slate-100 text-slate-400 cursor-not-allowed"
                          )}>
                          <Trash2 size={15} />
                          删除所选 {selectedDates.size > 0 ? `${selectedDates.size} 个` : ""}周次销售数据
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* ── 库存 ── */}
              <div className="border-t border-slate-100 pt-5">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">库存数据</p>
                <div className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 mb-4">
                  <div className="flex items-center gap-2.5">
                    <Package size={16} className="text-slate-400" />
                    <span className="text-sm text-slate-600">当前库存记录</span>
                  </div>
                  <span className="text-xs font-semibold text-slate-500">
                    {stockSkuCount} 个 SKU 有在库数量
                  </span>
                </div>
                <ConfirmBox type="inventory"
                  message={`将把「${storeName}」所有 SKU 的在库数量重置为 0，此操作不可撤销。`} />
                {confirmTarget !== "inventory" && (
                  <button
                    onClick={() => setConfirmTarget("inventory")}
                    disabled={stockSkuCount === 0 || isDeleting}
                    className={cn(
                      "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all",
                      stockSkuCount > 0
                        ? "bg-orange-500 hover:bg-orange-600 text-white shadow-sm"
                        : "bg-slate-100 text-slate-400 cursor-not-allowed"
                    )}>
                    <Trash2 size={15} />
                    清除当前店铺库存数据
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
