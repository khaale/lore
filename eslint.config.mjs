import js from '@eslint/js';
import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
export default [
  js.configs.recommended,
  ...plugin.configs['flat/recommended-type-checked'].map((config) => ({
    ...config,
    files: config.files ?? ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
  })),
  { ignores: ['**/dist/**', 'node_modules/**', 'experiments/**', '_tmp/**'] },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser,
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        structuredClone: 'readonly',
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.ts', 'test/e2e/cli/*.ts', 'test/toolchain/*.ts'],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': plugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    files: ['test/types/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.consumer.json',
      },
    },
  },
];
