import type { Config } from "tailwindcss";

export default {
  content: ["./src/app/**/*.{js,ts,jsx,tsx,mdx}", "./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        chat: {
          bg: "rgb(var(--chat-bg) / <alpha-value>)",
          surface: "rgb(var(--chat-surface) / <alpha-value>)",
          surface2: "rgb(var(--chat-surface-2) / <alpha-value>)",
          border: "rgb(var(--chat-border) / <alpha-value>)",
          text: "rgb(var(--chat-text) / <alpha-value>)",
          muted: "rgb(var(--chat-muted) / <alpha-value>)",
          primary: "rgb(var(--chat-primary) / <alpha-value>)",
          "primary-foreground": "rgb(var(--chat-primary-foreground) / <alpha-value>)",
          ring: "rgb(var(--chat-ring) / <alpha-value>)"
        }
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        "chat-card": "0 1px 0 rgba(17, 22, 37, 0.04), 0 12px 40px rgba(17, 22, 37, 0.10)"
      },
      borderRadius: {
        "chat-xl": "24px",
        "chat-lg": "18px"
      }
    }
  },
  plugins: []
} satisfies Config;


