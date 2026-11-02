import { DataStatePanel, DesignSystemProvider } from '@getitdone-gmbh/kette-design-community';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import { ensureSignedIn, loadConfig } from './lib/api';
import './index.css';

const root = createRoot(document.getElementById('root')!);

async function start() {
  try {
    await loadConfig();
    const user = await ensureSignedIn();
    // null means the browser is on its way to the login page
    if (!user) return;
    root.render(
      <StrictMode>
        <DesignSystemProvider locale="en">
          <BrowserRouter>
            <App user={user} />
          </BrowserRouter>
        </DesignSystemProvider>
      </StrictMode>,
    );
  } catch (error) {
    root.render(
      <DesignSystemProvider locale="en">
        <main className="mx-auto max-w-xl p-8">
          <DataStatePanel kind="error" title="Sign-in failed" description={(error as Error).message} onRetry={() => window.location.assign('/')} retryLabel="Reload" />
        </main>
      </DesignSystemProvider>,
    );
  }
}

start();
