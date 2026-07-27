import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Groupify Your Tabs',
    description: 'Group your open browser tabs automatically.',
    permissions: [
      "tabs",
      "tabGroups",
      "storage"
    ]
  },
});
