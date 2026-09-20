'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import Link from 'next/link';
import {AlertCircle, Check, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, FileSpreadsheet, Info, LayoutList, LoaderCircle, LogOut, Package, Percent, Search, ShoppingBag, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import type {CatalogItem, CatalogPage} from '@/lib/live-catalog';
import type {CatalogFilters} from '@/lib/catalog-filters';
import {collectMatchingProducts} from '@/lib/admin-bulk-prices';
import {readApiResponse} from '@/lib/client-response';
import PriceExcel from './price-excel';
import FilterPicker from './catalog-filter-picker';
import AdminBulkPrices from './admin-bulk-prices';
import AdminVisibility from './admin-visibility';
import StorageNotice from './storage-notice';
import './admin-workspace.css';

type AdminCatalogItem = CatalogItem & {catalogVisible?: boolean};
// Reuse the stable per-instance ref as the read owner without adding a state hook.
const catalogReads = new WeakMap<object, AbortController>();

const request = async<T,>(url: string, init?: RequestInit): Promise<T> => {
  return readApiResponse<T>(await fetch(url, init));
};
const priceText = (price: number | null) => price === null ? '' : (price / 100).toLocaleString('tr-TR', {minimumFractionDigits: 2, maximumFractionDigits: 2});

function PriceRow({item, checked, disabled, editorDisabled, visibilityPending, visibilitySaved, onSelect, onSaved, onSavingChange, onVisibilityRequest}: {
  item: AdminCatalogItem; checked: boolean; disabled: boolean; editorDisabled: boolean;
  visibilityPending: boolean; visibilitySaved: boolean;
  onSelect: (checked: boolean) => void; onSaved: (price: number | null) => void; onSavingChange: (value: boolean) => void;
  onVisibilityRequest: () => void;
}) {
  const [value, setValue] = useState(priceText(item.catalogPrice)), [saving, setSaving] = useState(false);
  const [savedPrice, setSavedPrice] = useState<number | null | undefined>(undefined), [error, setError] = useState('');
  const saved = savedPrice !== undefined && savedPrice === item.catalogPrice;
  const dirty = value.trim() !== priceText(item.catalogPrice);
  useEffect(() => { setValue(priceText(item.catalogPrice)); }, [item.catalogPrice]);
  async function save() {
    if (disabled || editorDisabled || saving) return;
    setSaving(true); onSavingChange(true); setSavedPrice(undefined); setError('');
    try {
      const result = await request<{price: number | null}>('/api/prices', {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: item.id, price: value})});
      onSaved(result.price); setSavedPrice(result.price);
    } catch (cause) { setError((cause as Error).message); }
    finally { setSaving(false); onSavingChange(false); }
  }
  return <tr className={'aw-product-row' + (checked ? ' is-selected' : '')}>
    <td className="aw-select-cell"><Checkbox checked={checked} disabled={disabled} onCheckedChange={value => onSelect(value === true)} aria-label={item.title + ' seçeneğini seç'}/></td>
    <td className="aw-product-cell"><div className="aw-product"><div className="aw-product-image">{item.image ? <img src={item.image} alt="" loading="lazy" width={44} height={44}/> : <Package aria-hidden="true"/>}</div><div className="aw-product-copy"><b>{item.title}</b><span>{[item.vendor, item.type].filter(Boolean).join(' · ') || 'Marka ve tür belirtilmemiş'}</span><small>{item.barcode || 'Barkod yok'}</small></div></div></td>
    <td className="aw-visibility-cell"><span className="aw-mobile-label">Katalog</span><Button className={'aw-visibility-button' + (item.catalogVisible === true ? ' is-visible' : '')} size="sm" variant="ghost" disabled={disabled} aria-pressed={item.catalogVisible === true} aria-label={item.title + (item.catalogVisible === true ? ' seçeneği katalogda. Gizlemek için aç' : ' seçeneği gizli. Kataloğa eklemek için aç')} onClick={onVisibilityRequest}>{visibilityPending ? <LoaderCircle className="aw-spin"/> : item.catalogVisible === true ? <Eye/> : <EyeOff/>}{visibilityPending ? 'Kaydediliyor' : item.catalogVisible === true ? 'Katalogda' : 'Gizli'}{!visibilityPending && <ChevronDown/>}</Button>{visibilitySaved && !visibilityPending && <small className="aw-row-success" role="status"><Check/>Kaydedildi</small>}</td>
    <td className="aw-price-cell"><form onSubmit={event => {event.preventDefault(); if (dirty) void save();}} className="aw-price-editor"><label><span className="aw-mobile-label">Özel fiyat</span><span className="aw-price-input"><Input disabled={disabled || editorDisabled} value={value} inputMode="decimal" aria-label={item.title + ' özel katalog fiyatı, TL'} aria-invalid={!!error} title="Boş bırakıp kaydetmek bu seçeneğin özel fiyatını kaldırır." placeholder="Fiyat yok" onChange={event => {setValue(event.target.value); setSavedPrice(undefined); setError('');}}/><span aria-hidden="true">TL</span></span></label><Button size="sm" variant={dirty ? 'default' : 'outline'} type="submit" disabled={saving || disabled || editorDisabled || !dirty} aria-label={item.title + ' özel fiyatını kaydet'}>{saving ? <LoaderCircle className="aw-spin"/> : saved ? <Check/> : null}{saved ? 'Kaydedildi' : saving ? 'Kaydediliyor' : 'Kaydet'}</Button>{error && <small className="aw-row-error" role="alert"><AlertCircle/>{error}</small>}</form></td>
  </tr>;
}

export default function PriceManager() {
  const [query, setQuery] = useState(''), [vendor, setVendor] = useState(''), [type, setType] = useState(''), [tag, setTag] = useState('');
  const [data, setData] = useState<CatalogPage | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [facets, setFacets] = useState<CatalogFilters | null>(null), [facetsLoading, setFacetsLoading] = useState(false), [facetsError, setFacetsError] = useState('');
  const [cursors, setCursors] = useState<(string | null)[]>([null]), [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<Map<string, CatalogItem>>(new Map()), [selectionVersion, setSelectionVersion] = useState(0), [allSelected, setAllSelected] = useState(false);
  const [collecting, setCollecting] = useState(false), [progress, setProgress] = useState({items: 0, pages: 0}), [selectionNotice, setSelectionNotice] = useState('');
  const [applying, setApplying] = useState(false), [excelBusy, setExcelBusy] = useState(false), [singleBusy, setSingleBusy] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false), [visibilityPlan, setVisibilityPlan] = useState<{items: AdminCatalogItem[]; visible: boolean; scopeLabel: string} | null>(null);
  const [visibilityReceipt, setVisibilityReceipt] = useState<Set<string>>(new Set());
  const collection = useRef<AbortController | null>(null);
  const selectedItems = useMemo(() => [...selected.values()], [selected]);
  const cursor = cursors.at(-1) || '', locked = applying || excelBusy || singleBusy || collecting || visibilityBusy;
  const hasFilter = query.trim().length >= 2 || !!vendor || !!type || !!tag;
  const pageSelected = !!data?.items.length && data.items.every(item => selected.has(item.id));

  useEffect(() => () => collection.current?.abort(), []);
  useEffect(() => {
    catalogReads.get(collection)?.abort();
    if (!hasFilter) { setData(null); setLoading(false); setError(''); return; }
    const controller = new AbortController();
    catalogReads.set(collection, controller);
    setLoading(true); setError('');
    const timer = setTimeout(async () => {
      try {
        const result = await request<CatalogPage>('/api/admin/catalog?' + new URLSearchParams({q: query, vendor, type, tag, after: cursor}), {signal: controller.signal});
        if (!controller.signal.aborted && catalogReads.get(collection) === controller) setData(result);
      }
      catch (cause) { if (!controller.signal.aborted && catalogReads.get(collection) === controller) setError((cause as Error).message); }
      finally { if (!controller.signal.aborted && catalogReads.get(collection) === controller) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); if (catalogReads.get(collection) === controller) catalogReads.delete(collection); };
  }, [query, vendor, type, tag, cursor, refresh, hasFilter]);
  useEffect(() => {
    const controller = new AbortController();
    setFacetsLoading(true); setFacetsError(''); setFacets(null);
    const timer = setTimeout(async () => {
      try { setFacets(await request<CatalogFilters>('/api/admin/catalog/filters?' + new URLSearchParams({q: query, vendor, type}), {signal: controller.signal})); }
      catch (cause) { if (!controller.signal.aborted) setFacetsError((cause as Error).message); }
      finally { if (!controller.signal.aborted) setFacetsLoading(false); }
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, vendor, type]);

  function clearSelection() {
    collection.current?.abort();
    setSelected(new Map()); setAllSelected(false); setSelectionVersion(value => value + 1); setSelectionNotice(''); setVisibilityPlan(null);
  }
  function changeFilter(field: 'query' | 'vendor' | 'type' | 'tag', value: string) {
    if (locked || {query, vendor, type, tag}[field] === value) return;
    catalogReads.get(collection)?.abort();
    const nextQuery = field === 'query' ? value : query;
    const nextVendor = field === 'vendor' ? value : vendor;
    const nextType = field === 'vendor' ? '' : field === 'type' ? value : type;
    const nextTag = field === 'vendor' || field === 'type' ? '' : field === 'tag' ? value : tag;
    setLoading(nextQuery.trim().length >= 2 || !!nextVendor || !!nextType || !!nextTag);
    clearSelection(); setData(null); setCursors([null]);
    if (field === 'query') setQuery(value);
    else if (field === 'vendor') { setVendor(value); setType(''); setTag(''); }
    else if (field === 'type') { setType(value); setTag(''); }
    else setTag(value);
  }
  function selectItems(items: CatalogItem[], checked: boolean) {
    if (locked || loading) return;
    const next = new Map(selected);
    for (const item of items) { if (checked) next.set(item.id, item); else next.delete(item.id); }
    if (next.size > 5000) { setSelectionNotice('En fazla 5.000 ürün seçeneği seçilebilir. Seçimi daraltın.'); return; }
    setSelected(next); setAllSelected(false); setSelectionVersion(value => value + 1); setSelectionNotice(''); setVisibilityPlan(null);
  }
  async function selectAllMatches() {
    if (locked || loading || !hasFilter) return;
    const controller = new AbortController(); collection.current = controller;
    setCollecting(true); setProgress({items: 0, pages: 0}); setSelectionNotice(''); setVisibilityPlan(null);
    try {
      const products = await collectMatchingProducts(
        {q: query, vendor, type, tag}, (params, signal) => request<CatalogPage>('/api/admin/catalog?' + params, {signal}), controller.signal, setProgress,
      );
      setSelected(new Map(products.map(product => [product.id, product]))); setAllSelected(true); setSelectionVersion(value => value + 1);
      setSelectionNotice(`Bu filtreye uyan ${products.length.toLocaleString('tr-TR')} ürün seçeneğinin tamamı seçildi.`);
    } catch (cause) {
      setSelectionNotice(controller.signal.aborted ? 'Tümünü seçme iptal edildi. Önceki seçiminiz korundu.' : (cause as Error).message);
    } finally { if (collection.current === controller) { collection.current = null; setCollecting(false); } }
  }
  function bulkSaved(prices: Record<string, number>) {
    setData(old => old ? {...old, items: old.items.map(item => Object.hasOwn(prices, item.id) ? {...item, catalogPrice: prices[item.id]} : item)} : old);
    setSelected(old => new Map([...old].map(([id, item]) => [id, Object.hasOwn(prices, id) ? {...item, catalogPrice: prices[id]} : item])));
  }
  function showVisibilityPreview(items: AdminCatalogItem[], visible: boolean, scopeLabel: string) {
    if (locked || loading || !items.length) return;
    setSelectionNotice(''); setVisibilityReceipt(new Set()); setVisibilityPlan({items, visible, scopeLabel});
  }
  function visibilitySaved(ids: string[], visible: boolean) {
    const changed = new Set(ids);
    setVisibilityReceipt(changed);
    setData(old => old ? {...old, items: old.items.map(item => changed.has(item.id) ? {...item, catalogVisible: visible} : item)} : old);
    setSelected(old => new Map([...old].map(([id, item]) => [id, changed.has(id) ? {...item, catalogVisible: visible} : item])));
  }
  function movePage(next: (current: (string | null)[]) => (string | null)[]) {
    if (locked || loading) return;
    const nextCursors = next(cursors);
    if ((nextCursors.at(-1) || '') === cursor) return;
    catalogReads.get(collection)?.abort(); setLoading(true); setCursors(nextCursors);
  }
  function refreshProducts() {
    catalogReads.get(collection)?.abort(); setLoading(hasFilter); setRefresh(value => value + 1);
  }

  return <main className="admin-workspace">
    <nav className="aw-nav" aria-label="Katalog ve yönetim"><Link className="aw-brand" href="/">ALAÇAM <span>Yönetim</span></Link><div><Link href="/"><ShoppingBag/>Katalog</Link><span aria-current="page"><LayoutList/>Ürün yönetimi</span></div><Link className="aw-logout" href="/cikis"><LogOut/><span>Çıkış</span></Link></nav>
    <div className="aw-content">
      <header className="aw-heading"><div><h1>Ürün yönetimi</h1><p>Katalogda gösterilecek ürünleri seçin, özel fiyatlarını düzenleyin.</p></div><details className="aw-help"><summary><Info/><span>Nasıl çalışır?</span></summary><div><b>Ürün bilgileri Shopify’dan gelir.</b><p>Yalnız katalog fiyatını ve görünürlüğünü değiştirebilirsiniz. Fiyat kaydetmek ürünü yayınlamaz.</p><p>Her satır bir ürün seçeneğidir. Tekli fiyatı boş bırakıp kaydetmek özel fiyatı kaldırır; Excel’de boş fiyat atlanır.</p><p>Filtre değişince seçim temizlenir. Bu bağlantı yalnız Shopify’da yayınlı ürünleri gösterir; taslak ve arşiv erişimi henüz bağlı değil.</p></div></details></header>
      <StorageNotice/>
      <fieldset className="aw-filters" disabled={locked}>
        <legend className="sr-only">Ürün arama ve filtreler</legend>
        <div className="aw-search"><Search aria-hidden="true"/><Input value={query} maxLength={120} onChange={event => changeFilter('query', event.target.value)} placeholder="Ürün adı, marka veya barkod ara…" aria-label="Ürün adı, marka veya barkod ara"/>{query && <Button variant="ghost" size="icon-sm" aria-label="Aramayı temizle" onClick={() => changeFilter('query', '')}><X/></Button>}</div>
        <div className="aw-filter-pickers"><FilterPicker label="Marka" placeholder="Tüm markalar" value={vendor} options={facets?.vendors || []} onChange={value => changeFilter('vendor', value)} loading={facetsLoading} error={facetsError}/><FilterPicker label="Ürün türü" placeholder="Tüm türler" value={type} options={facets?.types || []} onChange={value => changeFilter('type', value)} loading={facetsLoading} error={facetsError}/><FilterPicker label="Etiket" placeholder="Tüm etiketler" value={tag} options={facets?.tags || []} onChange={value => changeFilter('tag', value)} loading={facetsLoading} error={facetsError}/></div>
        {(query || vendor || type || tag) && <Button className="aw-clear-filters" size="sm" variant="ghost" onClick={() => {catalogReads.get(collection)?.abort(); setLoading(false); setError(''); clearSelection(); setQuery(''); setVendor(''); setType(''); setTag(''); setCursors([null]); setData(null);}}><X/>Filtreleri temizle</Button>}
      </fieldset>
      <details className="aw-excel-workspace"><summary onClick={event => {if (excelBusy) event.preventDefault();}} aria-disabled={excelBusy}><FileSpreadsheet/><b>Excel ile fiyat yönetimi</b><span>{excelBusy ? 'İşlem sürüyor…' : 'İndir / yükle'}</span><ChevronDown/></summary><fieldset disabled={loading || applying || singleBusy || collecting || visibilityBusy}><PriceExcel items={selectedItems.length ? selectedItems : data?.items || []} exportContext={selectedItems.length ? 'selected' : 'page'} onBusyChange={setExcelBusy} onSaved={() => {clearSelection(); refreshProducts();}}/></fieldset></details>
      <p className="aw-scope-note"><Info/>Kataloğa eklemediğiniz seçenekler müşteriye görünmez. Fiyat kaydetmek yayınlamaz.</p>
      {data && !error && <div className={'aw-selection-bar' + (selected.size ? ' has-selection' : '')}>
        <label className="aw-page-selection"><Checkbox checked={pageSelected ? true : data.items.some(item => selected.has(item.id)) ? 'indeterminate' : false} disabled={locked || loading || !data.items.length} onCheckedChange={checked => selectItems(data.items, checked === true)}/>Bu sayfa <span>({data.items.length.toLocaleString('tr-TR')})</span></label>
        <strong className="aw-selection-count">{selected.size ? `${selected.size.toLocaleString('tr-TR')} seçenek seçili` : 'Seçim yapın'}{allSelected && <small>Tüm eşleşenler</small>}</strong>
        <Button className="aw-select-all" size="sm" variant="ghost" disabled={locked || loading || !hasFilter || allSelected || !data.items.length} onClick={selectAllMatches}>Tüm eşleşenleri seç</Button>
        {!!selected.size && <><div className="aw-selection-actions"><Button size="sm" variant="outline" disabled={locked || loading} onClick={() => showVisibilityPreview(selectedItems, true, allSelected ? 'Bu filtreye uyan tüm sonuçlar' : 'İşaretlediğiniz seçenekler')}><Eye/>Kataloğa ekle</Button><Button size="sm" variant="outline" disabled={locked || loading} onClick={() => showVisibilityPreview(selectedItems, false, allSelected ? 'Bu filtreye uyan tüm sonuçlar' : 'İşaretlediğiniz seçenekler')}><EyeOff/>Gizle</Button></div><Button className="aw-clear-selection" size="icon-sm" variant="ghost" disabled={locked} onClick={clearSelection} aria-label="Seçimi temizle"><X/></Button></>}
      </div>}
      {collecting && <div className="aw-progress" role="status"><LoaderCircle className="aw-spin"/><span>{progress.items.toLocaleString('tr-TR')} seçenek bulundu · {progress.pages} sayfa tarandı</span><Button size="sm" variant="outline" onClick={() => collection.current?.abort()}>İptal</Button></div>}
      {selectionNotice && <p className="aw-notice" role="status">{selectionNotice}</p>}
      {!!selectedItems.length && <details className="aw-bulk-workspace"><summary onClick={event => {if (applying) event.preventDefault();}} aria-disabled={applying}><Percent/><b>Seçili fiyatları düzenle</b><span>{applying ? 'Fiyatlar kaydediliyor…' : 'Yüzde, tutar veya sabit fiyat'}</span><ChevronDown/></summary><AdminBulkPrices key={selectionVersion} items={selectedItems} scopeLabel={allSelected ? 'Bu filtreye uyan tüm sonuçlar' : 'İşaretlediğiniz seçenekler'} disabled={loading || excelBusy || singleBusy || collecting || visibilityBusy} onApplyingChange={setApplying} onSaved={bulkSaved}/></details>}
      {loading && <div className="aw-progress" role="status"><LoaderCircle className="aw-spin"/>Ürünler yükleniyor…</div>}
      {error && <div className="aw-empty aw-error" role="alert"><AlertCircle/><h2>Ürünler yüklenemedi</h2><p>{error}</p><Button disabled={locked || loading} variant="outline" onClick={refreshProducts}>Yeniden dene</Button></div>}
      {!loading && !data && !error && <div className="aw-empty"><Search/><h2>Yönetmek istediğiniz ürünleri bulun</h2><p>Yukarıdan marka veya tür seçin ya da en az iki karakterle arayın.</p><small>Toplu işlem için sonuçlardan birden fazla seçenek seçebilirsiniz.</small></div>}
      {data && !loading && !data.items.length && !error && <div className="aw-empty"><Search/><h2>Eşleşen ürün bulunamadı</h2><p>Aramayı kısaltın veya filtrelerden birini kaldırın.</p></div>}
      {data && !!data.items.length && !error && <><div className="aw-table-wrap" aria-busy={loading}><table className="aw-product-table"><caption className="sr-only">Ürün seçenekleri, katalog görünürlüğü ve özel fiyatları</caption><thead><tr><th scope="col" className="aw-select-cell"><span className="sr-only">Seç</span></th><th scope="col">Ürün <span>· {data.items.length} seçenek</span></th><th scope="col">Katalog durumu</th><th scope="col">Özel fiyat (TL)</th></tr></thead><tbody>{data.items.map(item => <PriceRow key={item.id} item={item} checked={selected.has(item.id)} disabled={locked || loading} editorDisabled={!!selected.size} visibilityPending={visibilityBusy && !!visibilityPlan?.items.some(selected => selected.id === item.id)} visibilitySaved={visibilityReceipt.has(item.id)} onSelect={checked => selectItems([item], checked)} onSavingChange={setSingleBusy} onVisibilityRequest={() => showVisibilityPreview([item], (item as AdminCatalogItem).catalogVisible !== true, 'Seçtiğiniz ürün seçeneği')} onSaved={price => {setData(old => old ? {...old, items: old.items.map(product => product.id === item.id ? {...product, catalogPrice: price} : product)} : old);}}/>)}</tbody></table></div>
        <footer className="aw-pagination"><span>Sayfa {cursors.length} · {data.items.length.toLocaleString('tr-TR')} seçenek</span>{!!selected.size && <small>Tekli fiyat düzenlemek için seçimi temizleyin.</small>}<div><Button size="icon-sm" variant="outline" aria-label="Önceki sonuç sayfası" disabled={cursors.length === 1 || loading || locked} onClick={() => movePage(old => old.slice(0, -1))}><ChevronLeft/></Button><Button size="icon-sm" variant="outline" aria-label="Sonraki sonuç sayfası" disabled={!data.hasNextPage || loading || locked} onClick={() => {if (data.cursor) movePage(old => [...old, data.cursor]);}}><ChevronRight/></Button></div></footer>
      </>}
      {visibilityPlan && <AdminVisibility {...visibilityPlan} onClose={() => setVisibilityPlan(null)} onApplyingChange={setVisibilityBusy} onSaved={visibilitySaved}/>}
    </div>
  </main>;
}
