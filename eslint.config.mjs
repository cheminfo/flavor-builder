import { defineConfig } from 'eslint/config';
import cheminfo from 'eslint-config-cheminfo';
import globals from 'globals';

export default defineConfig(cheminfo, {
  languageOptions: {
    globals: {
      ...globals.node,
    },
  },
  rules: {
    'no-console': 'off',
    'jsdoc/require-jsdoc': 'off',
    'no-await-in-loop': 'off',
  },
});
