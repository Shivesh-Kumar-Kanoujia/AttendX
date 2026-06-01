/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./**/*.{html,js}"],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'sans-serif'] },
      colors: {
        offwhite: '#f8f8f8',
        ink:      '#111111',
        muted:    '#888888',
        soft:     '#e5e5e5',
      },
    },
  },
  plugins: [],
};
