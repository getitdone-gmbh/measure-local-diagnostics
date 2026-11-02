import { FileUpload, toast } from '@getitdone-gmbh/kette-design-community';
import { useState } from 'react';

import { upload } from '../lib/api';
import type { ImportResult } from '../lib/types';

// Drop zone for one or more diagnostics export ZIPs
export function ExportUpload({ onImported }: { onImported: (importIds: number[]) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: File[]) {
    setLoading(true);
    setError(null);
    let inserted = 0;
    let issues = 0;
    let duplicates = 0;
    const ids: number[] = [];
    try {
      for (const file of files) {
        const result = await upload<ImportResult>('/api/imports', file);
        inserted += result.inserted;
        issues += result.issues;
        if (result.duplicate) duplicates += 1;
        else ids.push(result.import_id);
      }
      toast({
        title: `${files.length} export${files.length === 1 ? '' : 's'} imported`,
        description: `${inserted} new entries, ${issues} ${issues === 1 ? 'crash or hang' : 'crashes and hangs'}${duplicates ? `, ${duplicates} already imported` : ''}.${ids.length === 1 ? ' The list now shows only this export.' : ''}`,
      });
      onImported(ids);
    } catch (reason) {
      setError(`Import failed: ${(reason as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <FileUpload
      accept=".zip,application/zip"
      multiple
      loading={loading}
      loadingText="Importing export …"
      titleText="Drop a diagnostics export here or choose one"
      descriptionText="Diagnostics export as a ZIP with manifest.json and *.jsonl, as the app exports it"
      error={error}
      onFilesSelected={handleFiles}
    />
  );
}
