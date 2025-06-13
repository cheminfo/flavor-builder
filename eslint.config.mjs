import { defineConfig } from 'eslint/config';
import cheminfo from 'eslint-config-cheminfo';

export default defineConfig(cheminfo, {
  rules: {
    'no-console': 'off',
    'jsdoc/require-jsdoc': 'off',
    'no-await-in-loop': 'off',
  },
});
