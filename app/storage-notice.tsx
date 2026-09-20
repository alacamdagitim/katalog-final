'use client';

import {useEffect, useState} from 'react';
import {AlertCircle, RefreshCw} from 'lucide-react';
import {readApiResponse} from '@/lib/client-response';
import './storage-notice.css';

type Status = {provider: string; configured: boolean; durable: boolean; reachable: boolean; reason: string | null};
export default function StorageNotice() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setChecking(true);
    fetch('/api/admin/status', {signal: controller.signal, cache: 'no-store'})
      .then(readApiResponse<Status>).then(value => {setStatus(value); setError('');})
      .catch(cause => {if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Kayıt bağlantısı kontrol edilemedi.');})
      .finally(() => {if (!controller.signal.aborted) setChecking(false);});
    return () => controller.abort();
  }, [revision]);
  if (!error && (!status || (status.reachable && status.durable))) return null;
  const isLocal = !error && status?.provider === 'local' && status.reachable;
  return <aside className="storage-notice" data-local={isLocal} role={isLocal ? 'note' : 'alert'}>
    <AlertCircle size={17} aria-hidden="true"/>
    <div><strong>{isLocal ? 'Yerel önizleme' : 'Kayıt bağlantısı hazır değil'}</strong>
      <p>{error || status?.reason} {isLocal ? 'Buradaki değişiklikler canlı siteye aktarılmaz.' : 'Kaydedildi onayı gelmeden işlemi tamamlanmış kabul etmeyin.'}</p></div>
    {!isLocal && <button type="button" disabled={checking} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14}/>{checking ? 'Kontrol ediliyor…' : 'Tekrar kontrol et'}</button>}
  </aside>;
}
