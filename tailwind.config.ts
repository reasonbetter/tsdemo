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
        // Define a primary color (a sophisticated teal)
        'primary': {
          DEFAULT: '#225E64', // RGB(34, 94, 100)
          hover: '#1a454a',   // Darker shade for hover
          light: '#eef6f7',   // Very light shade for backgrounds
          border: '#a2c8cb',  // Light shade for borders
          text: '#112f32',    // Dark shade for text
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
      // Add a keyframe animation for the fade-in effect
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      // Define the animation utility
      animation: {
        fadeIn: 'fadeIn 1s ease-in-out',
      },
    },
  },
  plugins: [],
}
export default config
