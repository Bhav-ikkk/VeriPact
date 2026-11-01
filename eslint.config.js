// ESLint 9 flat config for the VeriPact monorepo.
const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '.claude/skills/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // JS config/shim files legitimately use require() under type: commonjs.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
