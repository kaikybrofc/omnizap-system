import js from '@eslint/js';

const nodeGlobals = {
  process: 'readonly',
  Buffer: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  clearImmediate: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  history: 'readonly',
  location: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  FileReader: 'readonly',
  XMLHttpRequest: 'readonly',
  performance: 'readonly',
  MessageChannel: 'readonly',
  AbortController: 'readonly',
  Blob: 'readonly',
  Element: 'readonly',
  HTMLElement: 'readonly',
  HTMLFormElement: 'readonly',
  FormData: 'readonly',
  MSApp: 'readonly',
};

export default [
  {
    ignores: [
      'node_modules/**',
      'logs/**',
      'temp/**',
      '.eslintcache',
      '*.log',
      '**/*.min.js',
      'coverage/**',
      'dist/**',
      'build/**',
      '**/.venv/**',
      'ml/**/.venv/**',
      'public/assets/js/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: nodeGlobals,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'warn',
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-console': 'off',
    },
  },
  {
    files: ['public/js/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: browserGlobals,
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...nodeGlobals,
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
];
