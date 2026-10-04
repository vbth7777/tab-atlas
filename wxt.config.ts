import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Tab Atlas',
    version: '0.1.8',
    description: 'Save, organize, and restore browser workspaces.',
    permissions: ['tabs', 'storage'],
    incognito: 'spanning',
    web_accessible_resources: [
      {
        resources: ['*'],
        matches: ['<all_urls>'],
      },
    ],
    browser_specific_settings: {
      gecko: {
        id: 'tab-atlas@example.com',
      },
    },
  },
});
