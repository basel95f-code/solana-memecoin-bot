import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', '*.js', '*.mjs'],
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Allow unused vars with underscore prefix
      '@typescript-eslint/no-unused-vars': ['error', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      // Allow explicit any in specific cases (trading bot needs flexibility)
      '@typescript-eslint/no-explicit-any': 'warn',
      // Require proper error handling
      '@typescript-eslint/no-floating-promises': 'error',
      // Allow empty functions for stubs
      '@typescript-eslint/no-empty-function': 'off',
      // Enforce consistent type imports
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  }
);
