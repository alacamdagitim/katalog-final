'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import Link from 'next/link';
import {ArrowLeft, Check, ChevronLeft, ChevronRight, Eye, EyeOff, LogOut, Package, Search, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {CatalogItem, CatalogPage} from '@/lib/live-catalog';
import type {CatalogFilters} from '@/lib/catalog-filters';
import {collectMatchingProducts} from '@/lib/admin-bulk-prices';
import PriceExcel from './price-excel';
import FilterPicker from './catalog-filter-picker';
import AdminBulkPrices from './admin-bulk-prices';
import AdminVisibility from './admin-visibility';

type AdminCatalogItem = CatalogItem & {catalogVisible?: boolean};
// Reuse the stable per-instance ref as the read owner without adding a state hook.
const catalogReads = new WeakMap<object, AbortController>();

const request = async<T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init), data = await response.json() as T & {error?: string};
  if (!response.ok) throw new Error(data.error || 'İşlem tamamlanamadı.');
  return data;
};
const priceText = (price: number | null) => price === null ? '' : (price / 100).toLocaleString('tr-TR', {minimumFractionDigits: 2, maximumFractionDigits: 2});

function PriceRow({item, checked, disabled, editorDisabled, onSelect, onSaved, onSavingChange, onVisibilityRequest}: {
  item: AdminCatalogItem; checked: boolean; disabled: boolean; editorDisabled: boolean;
  onSelect: (checked: boolean) => void; onSaved: (price: number | null) => void; onSavingChange: (value: boolean) => void;
  onVisibilityRequest: () => void;
}) {
  const [value, setValue] = useState(priceText(item.catalogPrice)), [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false), [error, setError] = useState('');
  useEffect(() => { setValue(priceText(item.catalogPrice)); setSaved(false); }, [item.catalogPrice]);
  async function save() {
    if (disabled || editorDisabled || saving) return;
    setSaving(true); onSavingChange(true); setSaved(false); setError('');
    try {
      const result = await request<{price: number | null}>('/api/prices', {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: item.id, price: value})});
      onSaved(result.price); setSaved(true);
    } catch (cause) { setError((cause as Error).message); }
    finally { setSaving(false); onSavingChange(false); }
  }
  return <article className={'price-row admin-selectable-row' + (checked ? ' is-selected' : '')}>
    <input className="admin-product-checkbox" type="checkbox" checked={checked} disabled={disabled} onChange={event => onSelect(event.target.checked)} aria-label={item.title + ' seçeneğini seç'}/>
    <div className="price-product"><div className="thumb">{item.image ? <img src={item.image} alt="" loading="lazy"/> : <Package/>}</div><div><b>{item.title}</b><small>{item.vendor}{item.type ? ' · ' + item.type : ''}</small><small>{item.barcode || 'Barkod yok'}</small><Button className={'admin-row-visibility' + (item.catalogVisible === true ? ' is-visible' : '')} variant="ghost" disabled={disabled} aria-pressed={item.catalogVisible === true} aria-label={item.title + (item.catalogVisible === true ? ' seçeneğini katalogdan gizle' : ' seçeneğini kataloğa ekle')} onClick={onVisibilityRequest}>{item.catalogVisible === true ? <><Eye/>Katalogda</> : <><EyeOff/>Katalogda gizli</>}</Button></div></div>
    <div className="price-editor"><label><span>Özel fiyat (TL)</span><Input disabled={disabled || editorDisabled} value={value} inputMode="decimal" aria-label={item.title + ' özel fiyatı'} title="Boş bırakıp kaydetmek bu seçeneğin özel fiyatını kaldırır." placeholder="Örn. 1.250,90" onChange={event => {setValue(event.target.value); setSaved(false);}}/></label><Button disabled={saving || disabled || editorDisabled} onClick={save}>{saved ? <><Check/>Kaydedildi</> : saving ? 'Kaydediliyor…' : 'Kaydet'}</Button>{error && <small className="customer-error" role="alert">{error}</small>}</div>
  </article>;
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
    setSelectionNotice(''); setVisibilityPlan({items, visible, scopeLabel});
  }
  function visibilitySaved(ids: string[], visible: boolean) {
    const changed = new Set(ids);
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

  return <main className="price-admin">
    <header><div><Link href="/"><ArrowLeft/>Kataloğa dön</Link><h1>Katalog ve fiyat yönetimi</h1><p>Marka, tür ve etiketle ürünleri bulun; katalog görünürlüğünü ve özel fiyatlarını yönetin.</p></div><Link href="/cikis"><LogOut/>Çıkış</Link></header>
    <p className="admin-source-note">Yalnız Shopify’da yayınlı ürünler listelenir. Shopify ürün bilgileri değiştirilemez.</p>
    <fieldset className="admin-filter-controls" disabled={locked}>
      <div className="price-search"><Search/><Input value={query} maxLength={120} onChange={event => changeFilter('query', event.target.value)} placeholder="Ürün, marka veya barkod ara" aria-label="Fiyatlandırılacak ürünleri ara"/></div>
      <div className="admin-filter-pickers"><FilterPicker label="Marka" placeholder="Tüm markalar" value={vendor} options={facets?.vendors || []} onChange={value => changeFilter('vendor', value)} loading={facetsLoading} error={facetsError}/><FilterPicker label="Ürün türü" placeholder="Tüm türler" value={type} options={facets?.types || []} onChange={value => changeFilter('type', value)} loading={facetsLoading} error={facetsError}/><FilterPicker label="Etiket" placeholder="Tüm etiketler" value={tag} options={facets?.tags || []} onChange={value => changeFilter('tag', value)} loading={facetsLoading} error={facetsError}/>{(query || vendor || type || tag) && <Button variant="ghost" onClick={() => {catalogReads.get(collection)?.abort(); setLoading(false); setError(''); clearSelection(); setQuery(''); setVendor(''); setType(''); setTag(''); setCursors([null]); setData(null);}}><X/>Temizle</Button>}</div>
    </fieldset>
    <fieldset className="admin-excel-controls" disabled={loading || applying || singleBusy || collecting || visibilityBusy}>
      <PriceExcel items={selectedItems.length ? selectedItems : data?.items || []} exportContext={selectedItems.length ? 'selected' : 'page'} onBusyChange={setExcelBusy} onSaved={() => {clearSelection(); refreshProducts();}}/>
    </fieldset>
    <p className="price-state">Kataloğa eklemediğiniz seçenekler müşteriye görünmez. Fiyat kaydetmek yayınlamaz.</p>
    <details className="admin-price-help"><summary>Fiyat ve seçim yardımı</summary><p>Her satır bir ürün seçeneğidir; varyasyonlar ayrı yönetilir. Tekli fiyatı boş bırakıp kaydetmek özel fiyatı kaldırır. Filtre değişince seçim temizlenir.</p></details>
    {data && !error && <div className="admin-selection-bar">
      <label><input type="checkbox" checked={pageSelected} disabled={locked || loading || !data.items.length} onChange={event => selectItems(data.items, event.target.checked)}/>Bu sayfayı seç ({data.items.length.toLocaleString('tr-TR')} seçenek)</label>
      <span>{selected.size.toLocaleString('tr-TR')} seçenek seçili{allSelected ? ' · Tüm eşleşenler' : ''}</span>
      <Button variant="outline" disabled={locked || loading || !hasFilter} onClick={selectAllMatches}>Tüm eşleşenleri seç</Button>
      {!!selected.size && <Button variant="ghost" disabled={locked} onClick={clearSelection}>Seçimi temizle</Button>}
    </div>}
    {collecting && <div className="admin-selection-progress" role="status"><span>{progress.pages} sayfa tarandı · {progress.items.toLocaleString('tr-TR')} seçenek bulundu</span><Button variant="outline" onClick={() => collection.current?.abort()}>Seçimi durdur</Button></div>}
    {selectionNotice && <p className="price-state" role="status">{selectionNotice}</p>}
    {!!selectedItems.length && <><div className="admin-catalog-actions"><span>Seçili seçeneklerin katalog görünürlüğü</span><Button variant="outline" disabled={locked || loading} onClick={() => showVisibilityPreview(selectedItems, true, allSelected ? 'Bu filtreye uyan tüm sonuçlar' : 'İşaretlediğiniz seçenekler')}><Eye/>Kataloğa ekle</Button><Button variant="outline" disabled={locked || loading} onClick={() => showVisibilityPreview(selectedItems, false, allSelected ? 'Bu filtreye uyan tüm sonuçlar' : 'İşaretlediğiniz seçenekler')}><EyeOff/>Katalogdan gizle</Button></div><AdminBulkPrices key={selectionVersion} items={selectedItems} scopeLabel={allSelected ? 'Bu filtreye uyan tüm sonuçlar' : 'İşaretlediğiniz seçenekler'} disabled={loading || excelBusy || singleBusy || collecting || visibilityBusy} onApplyingChange={setApplying} onSaved={bulkSaved}/></>}
    {loading && <p className="price-state" role="status">Shopify’da aranıyor…</p>}
    {error && <div className="empty" role="alert">{error}<Button disabled={locked || loading} variant="outline" onClick={refreshProducts}>Yeniden dene</Button></div>}
    {!loading && !data && !error && <div className="empty"><Search/><h2>Fiyatlandıracağınız ürünleri bulun</h2><p>Marka veya tür seçin, en az iki karakterle arayın ya da Excel dosyanızı yükleyin.</p></div>}
    {data && !loading && !data.items.length && !error && <div className="empty">Ürün bulunamadı.</div>}
    {data && !error && <><div className="price-list" aria-busy={loading}>{data.items.map(item => <PriceRow key={item.id} item={item} checked={selected.has(item.id)} disabled={locked || loading} editorDisabled={!!selected.size} onSelect={checked => selectItems([item], checked)} onSavingChange={setSingleBusy} onVisibilityRequest={() => showVisibilityPreview([item], (item as AdminCatalogItem).catalogVisible !== true, 'Seçtiğiniz ürün seçeneği')} onSaved={price => {setData(old => old ? {...old, items: old.items.map(product => product.id === item.id ? {...product, catalogPrice: price} : product)} : old);}}/>)}</div>
      <div className="customer-pagination"><Button size="icon" variant="outline" aria-label="Önceki sonuç sayfası" disabled={cursors.length === 1 || loading || locked} onClick={() => movePage(old => old.slice(0, -1))}><ChevronLeft/></Button><span>Sayfa {cursors.length} · {data.items.length} seçenek</span><Button size="icon" variant="outline" aria-label="Sonraki sonuç sayfası" disabled={!data.hasNextPage || loading || locked} onClick={() => {if (data.cursor) movePage(old => [...old, data.cursor]);}}><ChevronRight/></Button></div>
    </>}
    {visibilityPlan && <AdminVisibility {...visibilityPlan} onClose={() => setVisibilityPlan(null)} onApplyingChange={setVisibilityBusy} onSaved={visibilitySaved}/>}
  </main>;
}
