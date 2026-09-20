'use client';

import {useEffect, useRef, useState} from 'react';
import {Check, ChevronLeft, ChevronRight, Download, FileSpreadsheet, LoaderCircle, Upload, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {CatalogItem} from '@/lib/live-catalog';
import {money} from '@/lib/model';
import {readApiResponse} from '@/lib/client-response';
import './price-excel.css';
import {
  makePriceWorkbook, readPriceWorkbook, MAX_PRICE_FILE_BYTES, MAX_PRICE_ROWS, PRICE_BATCH_SIZE,
  type PriceImport, type PriceBatchResult,
} from '@/lib/price-excel';

type Props = {items: CatalogItem[]; onSaved: () => void; exportContext?: 'selected' | 'page'; onBusyChange?: (value: boolean) => void};
const PREVIEW_SIZE = 50;

export default function PriceExcel({items, onSaved, exportContext = 'page', onBusyChange}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PriceImport | null>(null);
  const [filename, setFilename] = useState('');
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const running = useRef(false);
  const changed = preview?.rows.filter(row => !row.error && row.price !== null) || [];
  const invalid = preview?.rows.filter(row => row.error) || [];
  const displayed = preview?.rows.filter(row => !onlyErrors || row.error || failed[row.id]) || [];
  const pageCount = Math.max(1, Math.ceil(displayed.length / PREVIEW_SIZE));
  const pending = changed.filter(row => !saved.has(row.id));
  useEffect(() => { onBusyChange?.(busy || applying); }, [busy, applying, onBusyChange]);
  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);

  async function download(empty = false) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError('');
    try {
      const workbook = await makePriceWorkbook(empty ? [] : items);
      const bytes = await workbook.xlsx.writeBuffer();
      const blob = new Blob([new Uint8Array(bytes)], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = empty ? 'alacam-fiyat-sablonu.xlsx' : exportContext === 'selected' ? 'alacam-secili-urunler-fiyatlar.xlsx' : 'alacam-arama-sonuclari-fiyatlar.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setDownloaded(true);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); running.current = false; }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(''); setPreview(null); setSaved(new Set()); setFailed({}); setPage(0); setOnlyErrors(false);
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new Error('Lütfen .xlsx biçiminde bir Excel dosyası seçin.');
      if (file.size > MAX_PRICE_FILE_BYTES) throw new Error('Dosya en fazla 5 MB olabilir.');
      setPreview(await readPriceWorkbook(await file.arrayBuffer()));
      setFilename(file.name);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); running.current = false; if (fileInput.current) fileInput.current.value = ''; }
  }

  async function apply() {
    if (invalid.length || !pending.length || running.current) return;
    running.current = true;
    setApplying(true); setError(''); setFailed({}); setPage(0);
    const acknowledged = new Set(saved);
    let wrote = false;
    try {
      for (let index = 0; index < pending.length; index += PRICE_BATCH_SIZE) {
        const batch = pending.slice(index, index + PRICE_BATCH_SIZE);
        const response = await fetch('/api/prices/excel', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({rows: batch.map(({row, id, price}) => ({row, id, price}))}),
        });
        const result = await readApiResponse<PriceBatchResult & {error?: string}>(response, true);
        for (const id of result.updated || []) { acknowledged.add(id); wrote = true; }
        setSaved(new Set(acknowledged));
        if (result.failed?.length) setFailed(Object.fromEntries(result.failed.map(item => [item.id, item.error])));
        if (!response.ok || result.failed?.length) throw new Error(result.error || 'Bazı fiyatlar kaydedilemedi. Kaydedilenler korundu; kalan satırları aşağıdan kontrol edin.');
        if (batch.some(row => !acknowledged.has(row.id))) throw new Error('Sunucu bazı satırları doğrulamadı. Kaydedilenler korundu; kalan satırlar yeniden denenebilir.');
      }
    } catch (cause) {
      setError((cause as Error).message || 'Bağlantı kesildi. Kaydedilen fiyatlar korundu; kalanları yeniden deneyebilirsiniz.');
    } finally { running.current = false; setApplying(false); if (wrote) onSaved(); }
  }

  return <section className="price-excel excel-workspace" aria-label="Excel ile toplu fiyat yönetimi" aria-busy={busy || applying}>
    <div className="excel-steps">
      <div className="excel-step"><span className="excel-step-number">1</span><div><h3>Listeyi indir</h3><p>{exportContext === 'selected' ? 'Seçili' : 'Bu sayfadaki'} {items.length.toLocaleString('tr-TR')} seçenek. Excel’de yalnız <strong>Yeni fiyat (TL)</strong> sütununu doldurun.</p><div className="price-excel-actions">
        <Button variant="outline" disabled={busy || applying || !items.length || items.length > MAX_PRICE_ROWS} onClick={() => download()}><Download/>{exportContext === 'selected' ? 'Seçilenleri indir' : 'Bu sayfayı indir'}</Button>
        <Button variant="ghost" disabled={busy || applying} onClick={() => download(true)}><FileSpreadsheet/>Boş şablon</Button>
      </div></div></div>
      <div className="excel-step"><span className="excel-step-number">2</span><div><h3>Dosyayı yükle ve kontrol et</h3><p>.xlsx dosyası · En fazla 5 MB / 5.000 satır. Önizlemeyi onaylamadan hiçbir fiyat değişmez.</p>
        <Button variant="outline" disabled={busy || applying} onClick={() => fileInput.current?.click()}>{busy ? <LoaderCircle className="excel-spinner"/> : <Upload/>}{busy ? 'Dosya işleniyor…' : 'Excel dosyası seç'}</Button>
        <input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden aria-label="Fiyat Excel dosyası" onChange={event => upload(event.target.files?.[0])}/>
      </div></div>
    </div>
    {downloaded && !preview && <p className="excel-download-feedback" role="status"><Check size={14}/>Dosya hazırlandı. Tarayıcınızın İndirilenler bölümünden açabilirsiniz.</p>}
    {error && <p className="price-excel-error" role="alert">{error}</p>}
    {preview && <div className="price-excel-preview">
      <div className="price-excel-heading"><div><h2>3. Değişiklikleri onayla</h2><p>{filename}</p></div><Button size="icon" variant="ghost" disabled={applying} aria-label="Excel önizlemesini kapat" onClick={() => {setPreview(null); setError('');}}><X/></Button></div>
      <div className="price-excel-summary" role="status">
        <span>{changed.length.toLocaleString('tr-TR')} fiyat değişikliği</span><span>{preview.skipped.toLocaleString('tr-TR')} boş fiyat atlanacak</span>
        {!!invalid.length && <strong>{invalid.length.toLocaleString('tr-TR')} hatalı satır</strong>}
        {!!saved.size && <span><Check/>{saved.size.toLocaleString('tr-TR')} kaydedildi</span>}
      </div>
      {invalid.length > 0 && <p className="price-excel-error">Henüz fiyat yazılmadı. Hatalı satırları Excel’de düzeltip dosyayı yeniden yükleyin.</p>}
      {!changed.length && !invalid.length && <p className="excel-empty-note">Yüklenecek yeni fiyat yok. Excel’de <strong>Yeni fiyat (TL)</strong> sütununu doldurun; boş hücreler mevcut fiyatları değiştirmez.</p>}
      {applying && <progress className="excel-progress" value={saved.size} max={changed.length} aria-label="Fiyatların kaydedilme ilerlemesi"/>}
      <div className="price-excel-review-controls"><label><input type="checkbox" checked={onlyErrors} onChange={event => {setOnlyErrors(event.target.checked); setPage(0);}}/>Yalnızca hatalı satırlar</label><span>{displayed.length.toLocaleString('tr-TR')} satır</span></div>
      <div className="price-excel-table-wrap"><table className="price-excel-table"><thead><tr><th>Satır / ürün</th><th>Dosyadaki eski fiyat</th><th>Yeni fiyat</th><th>Durum</th></tr></thead><tbody>
        {displayed.slice(page * PREVIEW_SIZE, (page + 1) * PREVIEW_SIZE).map(row => <tr key={row.row} data-invalid={!!row.error || !!failed[row.id]}>
          <td><b>{row.row}. {row.title || 'Ürün adı yok'}</b><small>{row.barcode || row.id}</small></td>
          <td>{row.previousPrice === null ? '—' : money(row.previousPrice)}</td><td>{row.price === null ? '—' : money(row.price)}</td>
          <td>{row.error || failed[row.id] || (saved.has(row.id) ? 'Kaydedildi' : row.price === null ? 'Atlanacak' : 'Hazır')}</td>
        </tr>)}
        {!displayed.length && <tr><td colSpan={4}>Gösterilecek satır yok.</td></tr>}
      </tbody></table></div>
      {pageCount > 1 && <div className="price-excel-pagination"><Button size="icon" variant="outline" aria-label="Önceki önizleme sayfası" disabled={!page} onClick={() => setPage(value => value - 1)}><ChevronLeft/></Button><span>{page + 1} / {pageCount}</span><Button size="icon" variant="outline" aria-label="Sonraki önizleme sayfası" disabled={page + 1 >= pageCount} onClick={() => setPage(value => value + 1)}><ChevronRight/></Button></div>}
      <div className="price-excel-apply"><p>{applying ? `${saved.size.toLocaleString('tr-TR')} / ${changed.length.toLocaleString('tr-TR')} fiyat kaydedildi. İşlem tamamlanana kadar sayfayı açık tutun.` : changed.length > 0 && !pending.length ? 'Tüm fiyatlar kaydedildi.' : 'Onayladığınızda yalnızca özel katalog fiyatları güncellenir.'}</p><Button disabled={applying || !!invalid.length || !pending.length} onClick={apply}>{applying ? 'Fiyatlar kaydediliyor…' : saved.size ? `Kalan ${pending.length.toLocaleString('tr-TR')} fiyatı uygula` : `${changed.length.toLocaleString('tr-TR')} fiyatı uygula`}</Button></div>
    </div>}
  </section>;
}
