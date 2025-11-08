/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{html,js}",
    "./*.{html,js}"
  ],
  safelist: [
    'z-40', 'z-50', 'bg-black/60', 'bg-zinc-950', 'text-zinc-100', 'text-zinc-200',
    'border', 'border-zinc-800', 'hover:bg-zinc-900/60', 'rounded-lg', 'rounded-2xl',
    'fixed', 'inset-0', 'backdrop-blur-sm'
  ],
  theme: {
    extend: {
      colors: {
        brand: "#8b5cf6"
      },
    },
  },
  plugins: [],
}
