import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { useStore } from "../state/store";

/* 通用 UI 基元。刻意做少：只有 Button / Card / Field / Segmented / Sheet / Toaster。
   基元一多就会开始互相打架，反而拖慢后续迭代。 */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "solid" | "ghost" | "outline" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "outline", size = "md", className = "", ...rest }: BtnProps) {
  const base =
    "inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 ease-out disabled:pointer-events-none disabled:opacity-40 active:scale-[0.97] whitespace-nowrap";
  const sizes = {
    sm: "h-8 px-3 text-tiny",
    md: "h-10 px-4 text-small",
    lg: "h-12 px-6 text-base",
  }[size];
  const variants = {
    solid: "bg-gradient-to-br from-axis1 to-axis2 text-void font-semibold shadow-card hover:brightness-110",
    ghost: "text-ink-dim hover:bg-white/5 hover:text-ink",
    outline: "border border-line bg-white/[0.03] text-ink hover:border-line-strong hover:bg-white/[0.07]",
    danger: "border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20",
  }[variant];
  return <button className={`${base} ${sizes} ${variants} ${className}`} {...rest} />;
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`glass rounded-card p-4 shadow-card ${className}`}>{children}</div>;
}

export function Field({
  label,
  hint,
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1.5 block text-tiny font-medium text-ink-dim">{label}</span>}
      <input
        className="h-10 w-full rounded-xl border border-line bg-black/25 px-3 text-base text-ink outline-none transition placeholder:text-ink-faint focus:border-axis1/60 focus:ring-2 focus:ring-axis1/15"
        {...rest}
      />
      {hint && <span className="mt-1 block text-micro text-ink-faint">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "h-7 px-2.5 text-tiny" : "h-9 px-3 text-small";
  return (
    <div className="inline-flex gap-1 rounded-xl border border-line bg-black/20 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`${pad} rounded-lg font-medium transition-all duration-150 ${
            o.value === value
              ? "bg-white/[0.12] text-ink shadow-card"
              : "text-ink-faint hover:text-ink-dim"
          }`}
          aria-pressed={o.value === value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-void/75 p-4 backdrop-blur-md"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`glass max-h-[86vh] w-full overflow-y-auto rounded-pane p-5 shadow-lift animate-sheet-in ${
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-title font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-faint transition hover:bg-white/5 hover:text-ink" aria-label="关闭">
            ✕
          </button>
        </div>
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Toaster() {
  const toast = useStore((s) => s.toast);
  const notify = useStore((s) => s.notify);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => notify(null), 2600);
    return () => clearTimeout(t);
  }, [toast, notify]);
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 animate-fade-up px-4">
      <div className="glass rounded-pill px-4 py-2 text-small shadow-lift">{toast}</div>
    </div>
  );
}

/** 广告位插槽。M1 只占位不加载任何脚本 —— 接入方（AdSense / 优量汇）等到有量再定。 */
export function AdSlot({ className = "" }: { className?: string }) {
  return (
    <div
      className={`grid h-[70px] place-items-center rounded-card border border-dashed border-line text-micro text-ink-faint ${className}`}
      data-ad-slot
    >
      广告位
    </div>
  );
}
