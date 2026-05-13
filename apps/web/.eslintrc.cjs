module.exports = {
  extends: [require.resolve('@cema/config/eslint/base.js')],
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  env: {
    browser: true,
    node: true,
    es2024: true,
  },
};
