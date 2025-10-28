/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f2f8ff",
          100: "#d8e9ff",
          500: "#1c64f2",
          700: "#1a46a6"
        }
      }
    }
  },
  plugins: []
};
