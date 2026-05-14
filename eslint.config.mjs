import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },

  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Backend: Node.js globals + type-checked rules
  {
    files: ['backend/src/**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: './backend/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  // Extension: browser/webextension globals + type-checked rules
  {
    files: ['extension/src/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
      parserOptions: {
        project: './extension/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  // Prettier must be last
  prettierConfig,
);
