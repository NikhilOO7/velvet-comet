import type { Config } from 'tailwindcss';

/**
 * "Command center, after dark" (PLAN.md §14). A deep velvet-night canvas with a
 * single comet accent (cyan→magenta) reserved for the live/coverage signal.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#08080d',
        surface: '#0f0f18',
        panel: '#14141f',
        edge: '#23233340',
        line: '#2a2a3c',
        ink: '#e8e8f4',
        muted: '#8c8ca6',
        faint: '#5a5a72',
        accent: '#22d3ee',
        accent2: '#d946ef',
        success: '#34d399',
        warn: '#fbbf24',
        danger: '#fb7185',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px #22d3ee22, 0 8px 40px -12px #22d3ee33',
      },
      backgroundImage: {
        comet: 'linear-gradient(135deg, #22d3ee 0%, #818cf8 50%, #d946ef 100%)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulse2: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out both',
        pulse2: 'pulse2 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
