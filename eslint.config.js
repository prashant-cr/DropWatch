import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Globals for the plain-JS entry points (bin/, scripts/, config files). The rest of
 * the codebase is TypeScript, where `@types/node` already supplies these.
 */
const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  URL: 'readonly',
  Buffer: 'readonly',
  fetch: 'readonly',
  globalThis: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
};

export default tseslint.config(
  { ignores: ['dist/**', 'data/**', 'coverage/**', 'tests/fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: nodeGlobals,
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },
  {
    // `any` is banned outright in core/ per the project conventions.
    files: ['src/core/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: ['src/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
