/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#1B2438',
          light: '#2A3650',
          dark: '#131B2B',
        },
        paper: '#F5F6F1',
        brass: {
          DEFAULT: '#B4903D',
          light: '#D4B366',
          dark: '#8F7130',
        },
        present: '#2F7D5A',
        absent: '#B23A48',
        late: '#C08A2E',
        slate2: '#5B6B7C',
      },
      fontFamily: {
        display: ['"Source Serif 4"', 'serif'],
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
