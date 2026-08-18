import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'var(--font-noto-jp)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        teal: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
          950: "#042f2e",
        },
      },
      fontSize: {
        '2xs': ['0.75rem', { lineHeight: '1.125rem' }],   // 12px
        'xs': ['0.75rem', { lineHeight: '1.125rem' }],    // 12px
        'sm': ['0.875rem', { lineHeight: '1.375rem' }],   // 14px
        'base': ['1rem', { lineHeight: '1.6rem' }],       // 16px
        'md': ['1rem', { lineHeight: '1.6rem' }],         // 16px
        'lg': ['1.125rem', { lineHeight: '1.625rem' }],   // 18px
        'xl': ['1.375rem', { lineHeight: '1.875rem' }],   // 22px
        '2xl': ['1.75rem', { lineHeight: '2.25rem' }],    // 28px
        '3xl': ['2.25rem', { lineHeight: '2.75rem' }],    // 36px
      },
    },
  },
  plugins: [],
};
export default config;
