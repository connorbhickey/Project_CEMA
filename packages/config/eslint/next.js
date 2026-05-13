module.exports = {
  extends: [require.resolve('./base.js'), 'next/core-web-vitals'],
  rules: {
    '@next/next/no-html-link-for-pages': 'off',
  },
};
