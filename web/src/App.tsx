import {
  Button,
  DataStatePanel,
  Toaster,
  TopBar,
  TopBarBrand,
  TopBarEnd,
  TopBarMobileMenu,
  TopBarNav,
  TopBarStart,
} from '@getitdone-gmbh/kette-design-community';
import { useState, type MouseEvent } from 'react';
import { Link as RouterLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { signOut } from './lib/api';
import { usePageTitle } from './lib/usePageTitle';
import { ImportsPage } from './pages/ImportsPage';
import { IssueDetailPage } from './pages/IssueDetailPage';
import { IssuesPage } from './pages/IssuesPage';
import { SymbolsPage } from './pages/SymbolsPage';
import { TimelinePage } from './pages/TimelinePage';

const NAVIGATION = [
  { href: '/imports', label: 'Imports', match: (path: string) => path.startsWith('/imports') },
  { href: '/', label: 'Issues', match: (path: string) => path === '/' || path.startsWith('/issues') },
  { href: '/timeline', label: 'Entries', match: (path: string) => path.startsWith('/timeline') },
  { href: '/symbols', label: 'Symbols', match: (path: string) => path.startsWith('/symbols') },
];

function NotFoundPage() {
  usePageTitle('Page not found');
  return (
    <DataStatePanel
      kind="empty"
      title="Page not found"
      description="This address does not exist in the diagnostics app."
      action={
        <Button asChild variant="secondary">
          <RouterLink to="/">Go to issues</RouterLink>
        </Button>
      }
    />
  );
}

export function App({ user }: { user: string }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Client-side navigation instead of a full page load, a modifier key still opens a new tab
  const go = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
    event.preventDefault();
    setMenuOpen(false);
    navigate(href);
  };
  const items = NAVIGATION.map((item) => ({
    href: item.href,
    label: item.label,
    current: item.match(pathname) ? ('page' as const) : undefined,
    onClick: go(item.href),
  }));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar>
        <TopBarStart>
          <TopBarBrand name="Diagnostics" />
          <TopBarNav items={items} className="hidden md:flex" />
        </TopBarStart>
        <TopBarEnd>
          <span className="hidden typography-small text-text-subtle md:inline">{user}</span>
          <Button variant="ghost" size="sm" className="hidden md:inline-flex" onClick={() => signOut()}>
            Sign out
          </Button>
          <TopBarMobileMenu
            items={items}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            title="Navigation"
            triggerLabel="Open menu"
            closeLabel="Close menu"
            footer={
              <div className="flex items-center justify-between gap-3">
                <span className="typography-small text-text-subtle">{user}</span>
                <Button variant="secondary" size="sm" onClick={() => signOut()}>
                  Sign out
                </Button>
              </div>
            }
          />
        </TopBarEnd>
      </TopBar>
      <main className="mx-auto max-w-content px-4 py-8 sm:px-6">
        <Routes>
          <Route path="/" element={<IssuesPage />} />
          <Route path="/issues/:issueId" element={<IssueDetailPage />} />
          <Route path="/imports" element={<ImportsPage />} />
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/symbols" element={<SymbolsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <Toaster />
    </div>
  );
}
