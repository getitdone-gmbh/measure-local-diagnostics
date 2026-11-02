import { FileUpload, toast } from '@getitdone-gmbh/kette-design-community';
import { useState } from 'react';

import { upload } from '../lib/api';
import type { ImportResult } from '../lib/types';

// Drop zone for one or more diagnostics export ZIPs
export function ExportUpload({ onImported }: { onImported: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: File[]) {
    setLoading(true);
    setError(null);
    let inserted = 0;
    let issues = 0;
    let duplicates = 0;
    try {
      for (const file of files) {
        const result = await upload<ImportResult>('/api/imports', file);
        inserted += result.inserted;
        issues += result.issues;
        if (result.duplicate) duplicates += 1;
      }
      toast({
        title: `${files.length} Export${files.length === 1 ? '' : 'e'} importiert`,
        description: `${inserted} neue Einträge, ${issues} ${issues === 1 ? 'Absturz oder Hänger' : 'Abstürze und Hänger'}${duplicates ? `, ${duplicates} bereits importiert` : ''}.`,
      });
      onImported();
    } catch (reason) {
      setError(`Import fehlgeschlagen: ${(reason as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <FileUpload
      accept=".zip,application/zip"
      multiple
      loading={loading}
      loadingText="Export wird importiert …"
      titleText="Diagnose-Export hierher ziehen oder auswählen"
      descriptionText="Diagnose-Export als ZIP mit manifest.json und *.jsonl, so wie ihn die App exportiert"
      error={error}
      onFilesSelected={handleFiles}
    />
  );
}
