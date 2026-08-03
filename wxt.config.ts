import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Tab Atlas',
    description: 'Save, organize, and restore browser workspaces.',
    permissions: ['tabs', 'storage'],
  },
});
