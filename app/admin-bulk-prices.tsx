'use client';

import {useState} from 'react';
import {ArrowRight, Check, ChevronLeft, ChevronRight, LoaderCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {money} from '@/lib/model';
import {previewBulkPrices, type BulkPriceItem, type BulkPriceOperation, type BulkPricePreview} from '@/lib/admin-bulk-prices';
import {PRICE_BATCH_SIZE, type PriceBatchResult} from '@/lib/price-excel';
import {readApiResponse} from '@/lib/client-response';

type Props = {
  items: BulkPriceItem[];
  scopeLabel: string;
  disabled?: boolean;
  onApplyingChange: (value: boolean) => void;
  onSaved: (prices: Record<string, number>) => void;
};
const labels: Record<BulkPriceOperation, string> = {
  'percent-up': 'Yüzde artır (%)', 'percent-down': 'Yüzde indir (%)',
  'amount-up': 'Tutar ekle (TL)', 'amount-down': 'Tutar düş (TL)', set: 'Sabit fiyat belirle',
};
const PAGE_SIZE = 30;

export default function AdminBulkPrices({items, scopeLabel, disabled = false, onApplyingChange, onSaved}: Props) {
  const [operation, setOperation] = useState<BulkPriceOperation>('percent-up');
  const [value, setValue] = useState('5');
  const [preview, setPreview] = useState<BulkPricePreview | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const rows = preview?.rows || [], changes = rows.filter(row => row.status === 'change');
  const excluded = rows.filter(row => row.status === 'skip'), invalid = rows.filter(row => row.status === 'error');
  const pending = changes.filter(row => !saved.has(row.id));
  const busy = disabled || applying;

  function clearPreview() { setPreview(null); setSaved(new Set()); setFailed({}); setError(''); setPage(0); }
  function createPreview() {
    const result = previewBulkPrices(items, operation, value);
    setPreview(result); setError(result.error); setSaved(new Set()); setFailed({}); setPage(0);
  }
  async function apply() {
    if (busy || !preview || preview.error || invalid.length || !pending.length) return;
    setApplying(true); onApplyingChange(true); setError(''); setFailed({}); setPage(0);
    const acknowledged = new Set(saved), written: Record<string, number> = {};
    const rowNumbers = new Map(rows.map((row, index) => [row.id, index + 2]));
    try {
      for (let offset = 0; offset < pending.length; offset += PRICE_BATCH_SIZE) {
        const batch = pending.slice(offset, offset + PRICE_BATCH_SIZE);
        const response = await fetch('/api/prices/excel', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({rows: batch.map(row => ({row: rowNumbers.get(row.id), id: row.id, price: row.next}))}),
        });
        const result = await readApiResponse<PriceBatchResult & {error?: string}>(response, true);
        for (const id of result.updated || []) {
          const row = batch.find(item => item.id === id);
          if (row?.next !== null && row?.next !== undefined) { acknowledged.add(id); written[id] = row.next; }
        }
        setSaved(new Set(acknowledged));
        if (result.failed?.length) setFailed(Object.fromEntries(result.failed.map(item => [item.id, item.error])));
        if (!response.ok || result.failed?.length) throw new Error(result.error || 'Bazı fiyatlar kaydedilemedi. Tamamlanan fiyatlar korundu; kalanları yeniden deneyebilirsiniz.');
        if (batch.some(row => !acknowledged.has(row.id))) throw new Error('Bazı satırlar doğrulanamadı. Tamamlanan fiyatlar korundu; kalanları yeniden deneyebilirsiniz.');
      }
    } catch (cause) { setError((cause as Error).message || 'Bağlantı kesildi. Kalan fiyatları yeniden deneyebilirsiniz.'); }
    finally {
      setApplying(false); onApplyingChange(false);
      if (Object.keys(written).length) onSaved(written);
    }
  }

  return <section className="admin-bulk" aria-label="Seçili ürün seçeneklerine toplu fiyat işlemi">
    <header className="admin-bulk-heading"><div><h2>Toplu fiyat düzenle</h2><p>{scopeLabel} · {items.length.toLocaleString('tr-TR')} seçenek seçili</p></div></header>
    <fieldset className="admin-bulk-controls" disabled={busy}>
      <label>İşlem<select value={operation} onChange={event => {setOperation(event.target.value as BulkPriceOperation); clearPreview();}}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>{operation.startsWith('percent') ? 'Oran (%)' : 'Tutar (TL)'}<Input value={value} inputMode="decimal" onChange={event => {setValue(event.target.value); clearPreview();}} placeholder={operation.startsWith('percent') ? 'Örn. 5' : 'Örn. 100,00'}/></label>
      <Button variant="outline" onClick={createPreview}>Önizle<ArrowRight/></Button>
    </fieldset>
    <p className="admin-bulk-note">{items.length.toLocaleString('tr-TR')} seçili seçenek · {operation === 'set' ? 'Fiyatı olmayanlara da bu fiyat atanır.' : 'Özel fiyatı olmayanlar atlanır; sonuçlar kuruşa yuvarlanır.'} Kaydetmeden önce değişiklikleri görebilirsiniz.</p>
    {error && <p className="price-excel-error" role="alert">{error}</p>}
    {preview && !preview.error && <div className="admin-bulk-preview">
      <div className="admin-bulk-summary" role="status"><span><b>{changes.length.toLocaleString('tr-TR')}</b> fiyat değişikliği</span><span>{excluded.length.toLocaleString('tr-TR')} atlanacak</span>{!!invalid.length && <strong>{invalid.length} geçersiz sonuç</strong>}{!!saved.size && <span className="aw-success-text"><Check/>{saved.size.toLocaleString('tr-TR')} kaydedildi</span>}</div>
      {!!invalid.length && <p className="price-excel-error">Sınır dışı fiyatlar var. İşlem değerini düzeltmeden fiyatlar uygulanamaz.</p>}
      <div className="price-excel-table-wrap" role="region" aria-label="Fiyat değişiklikleri önizlemesi" tabIndex={0}><table className="price-excel-table"><thead><tr><th scope="col">Ürün seçeneği</th><th scope="col">Mevcut fiyat</th><th scope="col">Yeni fiyat</th><th scope="col">Durum</th></tr></thead><tbody>{rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row => <tr key={row.id} data-invalid={row.status === 'error' || !!failed[row.id]}><td><b>{row.title}</b></td><td>{row.current === null ? 'Fiyat yok' : money(row.current)}</td><td><strong>{row.next === null ? '—' : money(row.next)}</strong></td><td>{failed[row.id] || (saved.has(row.id) ? 'Kaydedildi' : row.reason || 'Değişecek')}</td></tr>)}</tbody></table></div>
      {rows.length > PAGE_SIZE && <div className="price-excel-pagination"><Button size="icon" variant="outline" aria-label="Önceki fiyat önizleme sayfası" disabled={!page} onClick={() => setPage(current => current - 1)}><ChevronLeft/></Button><span>{page + 1} / {Math.ceil(rows.length / PAGE_SIZE)}</span><Button size="icon" variant="outline" aria-label="Sonraki fiyat önizleme sayfası" disabled={(page + 1) * PAGE_SIZE >= rows.length} onClick={() => setPage(current => current + 1)}><ChevronRight/></Button></div>}
      <div className="price-excel-apply"><p role="status">{applying ? `${saved.size.toLocaleString('tr-TR')} / ${changes.length.toLocaleString('tr-TR')} fiyat kaydedildi. Bu sayfayı açık tutun.` : changes.length > 0 && !pending.length ? 'Seçili fiyat değişiklikleri kaydedildi.' : 'Yalnızca özel katalog fiyatları değişir. Shopify fiyatlarına dokunulmaz.'}</p><Button disabled={busy || !!invalid.length || !pending.length} onClick={apply}>{applying ? <><LoaderCircle className="aw-spin"/>Kaydediliyor…</> : changes.length > 0 && !pending.length ? <><Check/>Kaydedildi</> : saved.size ? `Kalan ${pending.length.toLocaleString('tr-TR')} fiyatı kaydet` : `${changes.length.toLocaleString('tr-TR')} fiyatı kaydet`}</Button></div>
    </div>}
  </section>;
}
