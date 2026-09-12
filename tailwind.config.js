/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 900: '#07090c', 800: '#0b0e13', 700: '#11151c', 600: '#181e27', 500: '#222a36' },
        line: { DEFAULT: '#232b38', bright: '#313c4d' },
        fg: { DEFAULT: '#e7ebf1', dim: '#9aa5b4', mute: '#66707e' },
        signal: '#4d8dff',
        support: '#3fb98a',
        caution: '#e0a33c',
        objection: '#e2603f',
        block: '#d6425b',
        hypo: '#8b7bd8',
      },
      fontFamily: {
        sans: ['Inter', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.04em' }],
      },
    },
  },
  plugins: [],
};
