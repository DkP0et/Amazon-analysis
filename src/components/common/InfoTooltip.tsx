import React from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "../../lib/utils";

interface InfoTooltipProps {
  title?: string;
  content: string;
  children: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  widthClass?: string;
  iconColorClass?: string;
}

export function InfoTooltip({
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
