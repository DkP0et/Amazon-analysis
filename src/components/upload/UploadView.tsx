import React from "react";
import { FileText, Package, Loader2, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../lib/utils";
import { Store, SKUPerformance } from "../../types";
import { DataManagePanel } from "./DataManagePanel";
import { ExportPanel } from "./ExportPanel";

interface UploadViewProps {
  stores: Store[];
  activeStoreId: string;
  isProcessing: boolean;
  uploadStatus: { sales: boolean; inventory: boolean };
  salesInputRef: React.RefObject<HTMLInputElement>;
  inventoryInputRef: React.RefObject<HTMLInputElement>;
  handleSalesUpload: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleInventoryUpload: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  skuPerformance: Record<string, SKUPerformance>;
  onDeleteDates: (storeId: string, dates: string[]) => Promise<void>;
  onClearInventory: (storeId: string) => Promise<void>;
  onDeleteSkus: (storeId: string, skus: string[]) => Promise<void>;
}

export function UploadView({
  stores,
  activeStoreId,
  isProcessing,
  uploadStatus,
  salesInputRef,
  inventoryInputRef,
  handleSalesUpload,
  handleInventoryUpload,
  skuPerformance,
  onDeleteDates,
  onClearInventory,
  onDeleteSkus,
}: UploadViewProps) {
  return (
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

              <ExportPanel
                stores={stores}
                activeStoreId={activeStoreId}
                skuPerformance={skuPerformance}
              />

              <DataManagePanel
                stores={stores}
                activeStoreId={activeStoreId}
                skuPerformance={skuPerformance}
                onDeleteDates={onDeleteDates}
                onClearInventory={onClearInventory}
                onDeleteSkus={onDeleteSkus}
              />
            </div>
  );
}
