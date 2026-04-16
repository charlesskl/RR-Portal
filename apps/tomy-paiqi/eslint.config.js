import tsParser from '@typescript-eslint/parser'

export default [
  {
    files: ['server/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
  },
]
