import type { Config } from 'tailwindcss';

// Stich-inspired design tokens: restrained palette, clear hierarchy,
// generous negative space, light/dark parity.
const config: Config = {
  darkMode: 'class',
  content: [
    './src/entrypoints/**/*.{ts,tsx,html}',
    './src/components/**/*.{ts,tsx}',
    './src/**/*.html',
  ],
  theme: {
    extend: {
      colors: {
        // Semantic tokens backed by CSS vars (see src/assets/tokens.css)
        bg: 'rgb(var(--bg) / <alpha-value>)',
        'bg-subtle': 'rgb(var(--bg-subtle) / <alpha-value>)',
        'bg-elevated': 'rgb(var(--bg-elevated) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        'fg-muted': 'rgb(var(--fg-muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-fg': 'rgb(var(--accent-fg) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 4px 12px rgb(0 0 0 / 0.06)',
        pop: '0 8px 24px rgb(0 0 0 / 0.12)',
      },
    },
  },
  plugins: [],
};

export default config;
