import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并 Tailwind 类名，自动去重 / 解决冲突。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 将二维数组生成 CSV 并触发浏览器下载。
 * 自动转义包含逗号 / 引号 / 换行的单元格，并写入 UTF-8 BOM 以兼容 Excel 中文。
 */
export function downloadCSV(filename: string, rows: (string | number)[][]) {
  const escape = (val: string | number) => {
    const s = val === null || val === undefined ? "" : String(val);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
