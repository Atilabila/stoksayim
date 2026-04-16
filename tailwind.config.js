/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
        "./*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Outfit', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            },
            colors: {
                izbel: {
                    dark: '#0B0D17',
                    card: '#151828',
                    accent: '#3B82F6',
                    danger: '#EF4444',
                    success: '#10B981',
                    textMuted: '#9CA3AF',
                }
            },
            boxShadow: {
                'glow': '0 0 20px rgba(59, 130, 246, 0.4)',
                'glow-danger': '0 0 20px rgba(239, 68, 68, 0.4)',
                'glow-success': '0 0 20px rgba(16, 185, 129, 0.4)',
            }
        },
    },
    plugins: [],
}
