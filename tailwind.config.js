/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0faf4',
          100: '#dcf3e5',
          200: '#bce7cd',
          300: '#8dd4ab',
          400: '#57ba82',
          500: '#33a063',
          600: '#22814c',
          700: '#1a6b3a',  // Primary
          800: '#175630',
          900: '#134628',
          950: '#0a2717',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
