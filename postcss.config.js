export default {
  plugins: {
    // Tailwind 4 moved the PostCSS plugin into its own package, and does vendor
    // prefixing itself — autoprefixer is no longer part of the pipeline.
    '@tailwindcss/postcss': {},
  },
};
