import { useEffect } from 'react';

// Distinguishable browser tabs, e.g. "EXC_BREAKPOINT in … · Diagnostics"
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Diagnostics` : 'Diagnostics';
  }, [title]);
}
