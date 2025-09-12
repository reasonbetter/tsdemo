import type { Config } from 'tailwindcss'
import defaultTheme from 'tailwindcss/defaultTheme'

const config: Config = {
  // Define where Tailwind should scan for class names
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Define the color palette (Minimalist and Professional)
      colors: {
        // Define a subtle background
        'background': '#f9fafb', // gray-50
        // Define a primary color (a professional blue)
        'primary': {
          DEFAULT: '#2563eb', // Blue-600
          hover: '#1d4ed8',   // Blue-700
          light: '#eff6ff',   // Blue-50 (for probe background)
          border: '#dbeafe',  // Blue-200
          text: '#1e40af',    // Blue-800 (for probe text)
        },
        // Define text colors
        'foreground': '#111827', // Gray-900
        'muted-foreground': '#6b7280', // Gray-500
        // Define card/surface colors
        'card': '#ffffff',
        'border': '#e5e7eb', // Gray-200
        'input-border': '#d1d5db', // Gray-300
      },
      // Define the typography
      fontFamily: {
        // Use Inter as the primary font, falling back to system defaults
        sans: ['Inter', ...defaultTheme.fontFamily.sans],
        mono: defaultTheme.fontFamily.mono,
      },
    },
  },
  plugins: [],
}
export default config
