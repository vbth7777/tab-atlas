import '@/src/ui/app.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import Dashboard from './App';
import { I18nProvider } from '@/src/shared/i18n';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <Dashboard />
    </I18nProvider>
  </React.StrictMode>,
);
