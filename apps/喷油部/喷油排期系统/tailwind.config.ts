import type { Config } from "tailwindcss";

/**
 * SprayPlan Tailwind 配置
 *
 * 本配置同时承载两套色板，互不冲突：
 *
 *  1) shadcn-ui 的 CSS 变量色板（border / input / ring / background / foreground /
 *     primary / secondary / destructive / muted / accent / popover / card 等）
 *     —— 这是 src/components/ui/* 下所有组件依赖的默认主题，必须保留。
 *
 *  2) 项目专属薄荷色板（mint / sky / gold / purple / rose / text / app-border / app-bg）
 *     —— 详见 docs/UI_STYLE_GUIDE.md。注意：原 `border` / `bg` 命名空间会与
 *     shadcn 的 `border-border` / `bg-background` 默认类同名冲突，
 *     因此在此重命名为 `app-border` / `app-bg`，业务代码请使用：
 *       bg-app-bg-page / bg-app-bg-card / border-app-border / border-app-border-light
 */
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        // ── shadcn-ui CSS 变量色（勿动，组件依赖）──────────────────────
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // ── 项目专属薄荷色板（详 docs/UI_STYLE_GUIDE.md）────────────────
        // 主色 - 薄荷绿系
        mint: {
          50:  "#ecfdf5",
          100: "#d1fae5",
          400: "#34d399",  // 主操作
          700: "#047857",  // 悬停 / 文字深色
        },
        // 表头 / 信息
        sky: {
          DEFAULT: "#5B9BD5",
          light: "#E1ECF7",
          bg: "#F0F7FF",
        },
        // 按钮分色
        gold: { DEFAULT: "#F4D03F", bg: "#FFF8E1" },
        purple: { DEFAULT: "#D391DD" },
        rose: { DEFAULT: "#E88EA0", bg: "#FCE7EB", dark: "#B91C1C" },
        // 中性 - 文字
        text: {
          DEFAULT: "#333333",
          secondary: "#666666",
          tertiary: "#999999",
        },
        // 中性 - 边框（重命名自 `border`，避让 shadcn 默认 border-border）
        "app-border": { DEFAULT: "#E0E0E0", light: "#F0F0F0" },
        // 中性 - 背景（重命名自 `bg`，避让 shadcn 默认 bg-background）
        "app-bg": { page: "#F8FAFC", card: "#FFFFFF" },
      },
      borderRadius: {
        // shadcn 默认（依赖 CSS 变量 --radius）
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // 项目专属圆角令牌
        card: "12px",
        btn: "10px",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
