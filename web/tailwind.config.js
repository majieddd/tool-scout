/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Grade letter colors — matches config/grading_rubric.yaml
        grade: {
          s: "#8B5CF6",
          a: "#10B981",
          b: "#3B82F6",
          c: "#F59E0B",
          d: "#F97316",
          f: "#6B7280",
        },
        // Site palette
        bg: {
          DEFAULT: "#0a0a0a",
          subtle: "#141414",
          card: "#1a1a1a",
        },
        ink: {
          DEFAULT: "#f5f5f5",
          muted: "#a3a3a3",
          subtle: "#737373",
        },
        accent: {
          DEFAULT: "#8B5CF6",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
