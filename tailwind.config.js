/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /* 一层：底色与表面（越往上越亮，制造空间纵深） */
        void: "#05070f",
        base: "#0a0e1a",
        surface: "#111726",
        raised: "#18202f",
        /* 二层：描边 */
        line: "rgb(255 255 255 / 0.08)",
        "line-strong": "rgb(255 255 255 / 0.16)",
        /* 三层：文字 */
        ink: "#eef2ff",
        "ink-dim": "#a8b3cf",
        "ink-faint": "#6b7794",
        /* 四层：强调色（每条轴一个，贯穿游戏与创建器） */
        axis1: "#22d3ee",
        axis2: "#a78bfa",
        axis3: "#f472b6",
        ok: "#34d399",
        warn: "#fbbf24",
        bad: "#fb7185",
      },
      fontFamily: {
        sans: ['"Inter var"', "Inter", "system-ui", '"PingFang SC"', '"Microsoft YaHei"', "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        /* 字阶：克制，只留 7 级 */
        micro: ["10px", { lineHeight: "14px", letterSpacing: "0.06em" }],
        tiny: ["11px", { lineHeight: "16px" }],
        small: ["12.5px", { lineHeight: "18px" }],
        base: ["14px", { lineHeight: "21px" }],
        lead: ["16px", { lineHeight: "24px" }],
        title: ["20px", { lineHeight: "28px", letterSpacing: "-0.01em" }],
        hero: ["34px", { lineHeight: "40px", letterSpacing: "-0.02em" }],
      },
      borderRadius: { card: "16px", pane: "22px", pill: "999px" },
      boxShadow: {
        /* 阴影全部带色相，避免死黑 */
        card: "0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 12px 32px -12px rgb(0 0 0 / 0.7)",
        lift: "0 24px 60px -20px rgb(0 0 0 / 0.85)",
        glow: "0 0 0 1px rgb(34 211 238 / 0.5), 0 0 28px -4px rgb(34 211 238 / 0.45)",
      },
      transitionTimingFunction: {
        /* 统一缓动：出场快、收尾稳 */
        out: "cubic-bezier(0.22, 0.8, 0.3, 1)",
      },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        "pulse-soft": { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.45" } },
        "sheet-in": { from: { opacity: "0", transform: "translateY(12px) scale(0.985)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        "fade-up": "fade-up 0.32s cubic-bezier(0.22,0.8,0.3,1) both",
        "pulse-soft": "pulse-soft 1.1s ease-in-out infinite",
        "sheet-in": "sheet-in 0.24s cubic-bezier(0.22,0.8,0.3,1) both",
      },
    },
  },
  plugins: [],
};
