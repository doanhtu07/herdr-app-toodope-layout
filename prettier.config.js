/** @type {import('prettier').Config} */
const config = {
  overrides: [
    {
      files: '*.svg',
      options: { parser: 'html' },
    },
  ],
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
}

export default config
