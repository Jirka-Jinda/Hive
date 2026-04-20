import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            fontFamily: {
                mono: ['JetBrains Mono', 'Cascadia Code', 'Cascadia Mono', 'Fira Mono', 'ui-monospace', 'SF Mono', 'Consolas', 'Liberation Mono', 'Menlo', 'monospace'],
                sans: ['JetBrains Mono', 'Cascadia Code', 'Cascadia Mono', 'Fira Mono', 'ui-monospace', 'SF Mono', 'Consolas', 'Liberation Mono', 'Menlo', 'monospace'],
            },
            keyframes: {
                shake: {
                    '0%, 100%': { transform: 'translateX(0)' },
                    '15%': { transform: 'translateX(-8px)' },
                    '30%': { transform: 'translateX(8px)' },
                    '45%': { transform: 'translateX(-6px)' },
                    '60%': { transform: 'translateX(6px)' },
                    '75%': { transform: 'translateX(-3px)' },
                    '90%': { transform: 'translateX(3px)' },
                },
            },
            animation: {
                shake: 'shake 0.6s ease-in-out',
            },
        },
    },
    plugins: [typography],
};
