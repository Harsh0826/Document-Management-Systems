// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'server/.data/**', 'server/storage/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Rows from SQL are typed loosely at the boundary; prefer specific types elsewhere.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
    },
  },
  {
    files: ['server/**/*.ts', 'server/**/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: {
      // Never build SQL from template literals with user values — use $n parameters.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='query'] > TemplateLiteral.arguments:first-child > TemplateLiteral",
          message: 'Nested template literal in SQL — bind values as parameters instead.',
        },
      ],
    },
  },
  {
    files: ['server/src/db/cli.ts', 'server/src/db/migrate-storage.ts', 'server/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Do not inject raw HTML.' },
        { selector: "CallExpression[callee.object.name='localStorage']", message: 'Never store tokens or document data in localStorage.' },
      ],
    },
  },
);
