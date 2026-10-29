/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        "surface-container-lowest": "#010f21",
        "primary-container": "#0f172a",
        "on-tertiary-fixed": "#2a1700",
        "primary-fixed-dim": "#bec6e0",
        "on-error": "#690005",
        "tertiary-fixed-dim": "#ffb95f",
        "on-surface-variant": "#c6c6cd",
        "inverse-primary": "#565e74",
        "secondary-fixed-dim": "#93ccff",
        "primary-fixed": "#dae2fd",
        "surface-dim": "#051426",
        "on-primary-container": "#798098",
        "on-surface": "#d5e3fd",
        "error-container": "#93000a",
        "surface-bright": "#2c3a4e",
        "primary": "#bec6e0",
        "surface": "#051426",
        "on-background": "#d5e3fd",
        "on-secondary": "#003351",
        "on-primary-fixed": "#131b2e",
        "inverse-on-surface": "#233144",
        "error": "#ffb4ab",
        "surface-tint": "#bec6e0",
        "outline": "#909097",
        "inverse-surface": "#d5e3fd",
        "surface-container-high": "#1c2b3e",
        "tertiary-container": "#251400",
        "on-error-container": "#ffdad6",
        "on-primary": "#283044",
        "surface-container-low": "#0d1c2f",
        "secondary-container": "#3198dc",
        "on-tertiary-fixed-variant": "#653e00",
        "outline-variant": "#45464d",
        "on-secondary-fixed-variant": "#004b73",
        "on-primary-fixed-variant": "#3f465c",
        "surface-container-highest": "#273649",
        "on-tertiary": "#472a00",
        "background": "#051426",
        "on-secondary-container": "#002c47",
        "tertiary": "#ffb95f",
        "surface-container": "#122033",
        "on-secondary-fixed": "#001d31",
        "on-tertiary-container": "#b47300",
        "secondary-fixed": "#cce5ff",
        "secondary": "#93ccff",
        "tertiary-fixed": "#ffddb8",
        "surface-variant": "#273649"
,
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
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
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
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },

      /* Stitch EPMS 设计令牌（与设计稿 1:1） */
      spacing: {
      "gutter-desktop": "1rem",
      "space-md": "0.5rem",
      "space-xs": "0.25rem",
      "space-lg": "0.75rem",
      "margin": "0.75rem",
      "space-sm": "0.375rem",
      "margin-desktop": "1.5rem",
      "space-xl": "1rem",
      "gutter": "0.75rem"
},
      fontSize: {
      "headline-lg": [
            "24px",
            {
                  "lineHeight": "32px",
                  "letterSpacing": "-0.015em",
                  "fontWeight": "600"
            }
      ],
      "label-md": [
            "11px",
            {
                  "lineHeight": "14px",
                  "letterSpacing": "0em",
                  "fontWeight": "500"
            }
      ],
      "label-lg": [
            "13px",
            {
                  "lineHeight": "16px",
                  "letterSpacing": "-0.01em",
                  "fontWeight": "500"
            }
      ],
      "body-lg": [
            "14px",
            {
                  "lineHeight": "20px",
                  "fontWeight": "400"
            }
      ],
      "label-sm": [
            "10px",
            {
                  "lineHeight": "12px",
                  "letterSpacing": "0.02em",
                  "fontWeight": "600"
            }
      ],
      "headline-xl": [
            "32px",
            {
                  "lineHeight": "40px",
                  "letterSpacing": "-0.02em",
                  "fontWeight": "700"
            }
      ],
      "headline-xl-mobile": [
            "24px",
            {
                  "lineHeight": "32px",
                  "letterSpacing": "-0.015em",
                  "fontWeight": "700"
            }
      ],
      "headline-sm": [
            "15px",
            {
                  "lineHeight": "20px",
                  "letterSpacing": "-0.005em",
                  "fontWeight": "600"
            }
      ],
      "headline-md": [
            "18px",
            {
                  "lineHeight": "24px",
                  "letterSpacing": "-0.01em",
                  "fontWeight": "600"
            }
      ],
      "body-sm": [
            "12px",
            {
                  "lineHeight": "16px",
                  "fontWeight": "400"
            }
      ],
      "body-md": [
            "13px",
            {
                  "lineHeight": "18px",
                  "fontWeight": "400"
            }
      ]
},
      fontFamily: {
      "headline-lg": [
            "Inter"
      ],
      "label-md": [
            "JetBrains Mono"
      ],
      "label-lg": [
            "JetBrains Mono"
      ],
      "body-lg": [
            "Inter"
      ],
      "label-sm": [
            "JetBrains Mono"
      ],
      "headline-xl": [
            "Inter"
      ],
      "headline-xl-mobile": [
            "Inter"
      ],
      "headline-sm": [
            "Inter"
      ],
      "headline-md": [
            "Inter"
      ],
      "body-sm": [
            "Inter"
      ],
      "body-md": [
            "Inter"
      ]
},
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
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
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}