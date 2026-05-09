export default [
  {
    ignores: [
      'tests/resources/**',
      '**/jquery*.js',
      '**/*tmp*.*',
      '**/*tmp*/',
      'eslint.config.js',
      'node_modules/',
    ],
  },
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },

    rules: {
      /*
       * ───────── Formatting ─────────
       */
      indent: ['error', 2, {SwitchCase: 1}],
      semi: ['error', 'always'],
      quotes: ['error', 'single', {avoidEscape: true}],
      'comma-dangle': ['error', 'always-multiline'],
      'object-curly-spacing': ['error', 'never'],
      'array-bracket-spacing': ['error', 'never'],
      'no-trailing-spaces': 'error',
      'no-multiple-empty-lines': ['error', {max: 1, maxEOF: 0}],

      /*
       * ───────── Strictness ─────────
       */
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-redeclare': 'error',
      'no-shadow': 'error',
      'no-return-await': 'error',
      'no-useless-catch': 'error',

      /*
       * ───────── Predictability ─────────
       */
      'consistent-return': 'error',
      'dot-notation': 'error',
      'no-fallthrough': 'error',
      'no-unreachable': 'error',
      'no-throw-literal': 'error',

      /*
       * ───────── Clean Refactors ─────────
       */
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-debugger': 'error',

      /*
       * ───────── Modern JS Discipline ─────────
       */
      'prefer-arrow-callback': 'error',
      'prefer-spread': 'error',
      'prefer-rest-params': 'error',
      'object-shorthand': ['error', 'always'],
    },
  },
];
