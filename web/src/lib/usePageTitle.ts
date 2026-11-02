import { useEffect } from 'react';

// Distinguishable browser tabs, e.g. "EXC_BREAKPOINT in … · Diagnose"
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Diagnose` : 'Diagnose';
  }, [title]);
}
