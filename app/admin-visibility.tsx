'use client';

import {useState} from 'react';
import {Check, ChevronLeft, ChevronRight, Eye, EyeOff, LoaderCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {previewCatalogVisibility, type CatalogVisibilityItem} from '@/lib/admin-bulk-prices';
import {readApiResponse} from '@/lib/client-response';

type Props = {
  items: CatalogVisibilityItem[];
  visible: boolean;
  scopeLabel: string;
  onClose: () => void;
  onApplyingChange: (value: boolean) => void;
  onSaved: (ids: string[], visible: boolean) => void;
};
type VisibilityResponse = {updated?: string[]; failed?: {id: string; error: string}[]; error?: string};
const PAGE_SIZE = 30;

export default function AdminVisibility({items, visible, scopeLabel, onClose, onApplyingChange, onSaved}: Props) {
  const [applying, setApplying] = useState(false), [saved, setSaved] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Record<string, string>>({}), [error, setError] = useState(''), [page, setPage] = useState(0);
  const rows = previewCatalogVisibility(items, visible), changes = rows.filter(row => row.changed);
  const pending = changes.filter(row => !saved.has(row.id));
  const label = visible ? 'Kataloğa ekle' : 'Katalogdan gizle';

  async function apply() {
    if (applying || !pending.length) return;
    setApplying(true); onApplyingChange(true); setError(''); setFailed({}); setPage(0);
    const acknowledged = new Set(saved), written: string[] = [];
    try {
      for (let offset = 0; offset < pending.length; offset += 100) {
        const ids = pending.slice(offset, offset + 100).map(row => row.id), allowed = new Set(ids);
        const response = await fetch('/api/admin/catalog/visibility', {
          method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ids, visible}),
        });
        const result = await readApiResponse<VisibilityResponse>(response, true);
        for (const id of result.updated || []) if (allowed.has(id)) { acknowledged.add(id); written.push(id); }
        setSaved(new Set(acknowledged));
        if (result.failed?.length) setFailed(Object.fromEntries(result.failed.map(item => [item.id, item.error])));
        if (!response.ok || result.failed?.length) throw new Error(result.error || 'Bazı ürünlerin görünürlüğü kaydedilemedi. Tamamlananlar korundu; kalanları yeniden deneyebilirsiniz.');
        if (ids.some(id => !acknowledged.has(id))) throw new Error('Bazı ürünler doğrulanamadı. Tamamlananlar korundu; kalanları yeniden deneyebilirsiniz.');
      }
    } catch (cause) { setError((cause as Error).message || 'Bağlantı kesildi. Kalan ürünleri yeniden deneyebilirsiniz.'); }
    finally { setApplying(false); onApplyingChange(false); if (written.length) onSaved(written, visible); }
  }

  return <Dialog open onOpenChange={open => {if (!open && !applying) onClose();}}>
    <DialogContent className="admin-visibility-dialog aw-visibility-dialog" showCloseButton={!applying} onEscapeKeyDown={event => {if (applying) event.preventDefault();}} onPointerDownOutside={event => {if (applying) event.preventDefault();}}>
      <DialogHeader><DialogTitle>{visible ? <Eye/> : <EyeOff/>}{label}</DialogTitle><DialogDescription>{scopeLabel}. {visible ? 'Bu seçenekler müşterilere görünür olacak.' : 'Bu seçenekler müşteri kataloğundan kaldırılacak.'} Ürünler silinmez, fiyatlar korunur.</DialogDescription></DialogHeader>
      <div className="admin-visibility-summary" role="status"><span><b>{changes.length.toLocaleString('tr-TR')}</b> seçenek {visible ? 'yayınlanacak' : 'gizlenecek'}</span>{rows.length > changes.length && <span>{(rows.length - changes.length).toLocaleString('tr-TR')} değişmeyecek</span>}{!!saved.size && <span className="aw-success-text"><Check/>{saved.size.toLocaleString('tr-TR')} kaydedildi</span>}</div>
      {error && <p className="price-excel-error" role="alert">{error}</p>}
      <div className="price-excel-table-wrap" role="region" aria-label="Katalog görünürlüğü değişiklikleri" tabIndex={0}><table className="price-excel-table"><thead><tr><th scope="col">Ürün seçeneği</th><th scope="col">Şimdi</th><th scope="col">İşlem sonrası</th></tr></thead><tbody>{rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row => <tr key={row.id} data-invalid={!!failed[row.id]}><td><b>{row.title}</b></td><td>{row.current ? 'Katalogda' : 'Gizli'}</td><td>{failed[row.id] || (saved.has(row.id) ? 'Kaydedildi' : row.changed ? visible ? 'Katalogda' : 'Gizli' : 'Değişmeyecek')}</td></tr>)}</tbody></table></div>
      {rows.length > PAGE_SIZE && <div className="price-excel-pagination"><Button size="icon" variant="outline" aria-label="Önceki görünürlük önizleme sayfası" disabled={!page} onClick={() => setPage(value => value - 1)}><ChevronLeft/></Button><span>{page + 1} / {Math.ceil(rows.length / PAGE_SIZE)}</span><Button size="icon" variant="outline" aria-label="Sonraki görünürlük önizleme sayfası" disabled={(page + 1) * PAGE_SIZE >= rows.length} onClick={() => setPage(value => value + 1)}><ChevronRight/></Button></div>}
      <div className="admin-visibility-actions"><p role="status">{applying ? `${saved.size.toLocaleString('tr-TR')} / ${changes.length.toLocaleString('tr-TR')} seçenek kaydedildi. İşlem tamamlanana kadar sayfayı açık tutun.` : changes.length > 0 && !pending.length ? 'Görünürlük değişiklikleri kaydedildi.' : 'Yalnızca bu listedeki seçenekler güncellenir.'}</p><Button variant="outline" disabled={applying} onClick={onClose}>{saved.size && !pending.length ? 'Tamam' : 'Vazgeç'}</Button>{!!pending.length && <Button disabled={applying} onClick={apply}>{applying ? <><LoaderCircle className="aw-spin"/>Kaydediliyor…</> : saved.size ? `Kalan ${pending.length.toLocaleString('tr-TR')} seçeneği uygula` : `${pending.length.toLocaleString('tr-TR')} seçeneği ${visible ? 'kataloğa ekle' : 'gizle'}`}</Button>}</div>
    </DialogContent>
  </Dialog>;
}
