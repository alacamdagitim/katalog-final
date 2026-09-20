'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowUpRight,Check,ChevronLeft,ChevronRight,LoaderCircle,Menu,Minus,Package,Plus,Search,ShieldCheck,ShoppingCart,SlidersHorizontal,Trash2,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Sheet,SheetContent,SheetDescription,SheetHeader,SheetTitle} from '@/components/ui/sheet';
import ProductDetail from './product-detail';
import type {CatalogItem,CatalogPage} from '@/lib/live-catalog';
import {money} from '@/lib/model';
import {readApiResponse} from '@/lib/client-response';
import {parsePrice} from '@/lib/price-excel';
import './catalog-workspace.css';

type Line={product:CatalogItem;quantity:number};
type Filters={vendor:string;type:string;tag:string;stock:string;minPrice:string;maxPrice:string};
type Facets={vendors:string[];types:string[];tags:string[];limits?:{vendors:boolean;types:boolean;tags:boolean}};
const emptyFilters:Filters={vendor:'',type:'',tag:'',stock:'',minPrice:'',maxPrice:''};
const logo='https://alacamdagitim.com/cdn/shop/files/LOGO_DENEME_SON_865056f4-5f9d-4701-a37e-f1d9be001d1a.webp?v=1774724316&width=400';
const request=async<T=any>(url:string,init?:RequestInit):Promise<T>=>{
 return readApiResponse<T>(await fetch(url,init));
};
function Quantity({value,onChange,label}:{value:number;onChange:(value:number)=>void;label:string}){
 return <div className="trade-quantity">
  <Button size="icon" variant="ghost" aria-label={label+' adedini azalt'} disabled={value<=1} onClick={()=>onChange(value-1)}><Minus/></Button>
  <Input value={value} inputMode="numeric" aria-label={label+' adedi'} onChange={e=>onChange(Math.max(1,Math.min(100000,Math.floor(Number(e.target.value)||1))))}/>
  <Button size="icon" variant="ghost" aria-label={label+' adedini artır'} disabled={value>=100000} onClick={()=>onChange(Math.min(100000,value+1))}><Plus/></Button>
 </div>;
}
function FilterPanel({filters,facets,loading,error,onChange,onClear}:{filters:Filters;facets:Facets;loading:boolean;error:string;onChange:(next:Partial<Filters>)=>void;onClear:()=>void}){
 const [min,setMin]=useState(filters.minPrice),[max,setMax]=useState(filters.maxPrice),[priceError,setPriceError]=useState('');
 useEffect(()=>{setMin(filters.minPrice);setMax(filters.maxPrice)},[filters.minPrice,filters.maxPrice]);
 const applyPrice=(event:React.FormEvent)=>{
  event.preventDefault();
  const a=parsePrice(min),b=parsePrice(max);
  if(a.error||b.error){setPriceError(a.error||b.error);return}
  if(a.price!==null&&b.price!==null&&a.price>b.price){setPriceError('En düşük fiyat, en yüksek fiyattan büyük olamaz.');return}
  setPriceError('');onChange({minPrice:a.price===null?'':String(a.price/100),maxPrice:b.price===null?'':String(b.price/100)});
 };
 const options=(items:string[],selected:string)=><>{selected&&!items.includes(selected)&&<option value={selected}>{selected}</option>}{items.map(item=><option key={item} value={item}>{item}</option>)}</>;
 return <div className="catalog-filter-panel catalog-workspace-filters">
  <div className="catalog-filter-heading"><div><h2>Ürünleri filtrele</h2><p>Aradığınız grubu hızlıca daraltın.</p></div><button type="button" onClick={onClear}>Tümünü temizle</button></div>
  <div className="catalog-filter-fields">
   <label className="catalog-select-field"><span>Marka</span><select value={filters.vendor} disabled={loading&&!facets.vendors.length} onChange={event=>onChange({vendor:event.target.value,type:'',tag:''})}><option value="">Tüm markalar</option>{options(facets.vendors,filters.vendor)}</select></label>
   <label className="catalog-select-field"><span>Ürün türü</span><select value={filters.type} disabled={loading&&!facets.types.length} onChange={event=>onChange({type:event.target.value,tag:''})}><option value="">Tüm ürün türleri</option>{options(facets.types,filters.type)}</select></label>
   <label className="catalog-select-field"><span>Etiket</span><select value={filters.tag} disabled={loading&&!facets.tags.length} onChange={event=>onChange({tag:event.target.value})}><option value="">Tüm etiketler</option>{options(facets.tags,filters.tag)}</select></label>
   <label className="catalog-select-field"><span>Stok</span><select value={filters.stock} onChange={event=>onChange({stock:event.target.value})}><option value="">Tüm ürünler</option><option value="available">Satışa açık</option><option value="unavailable">Tükenenler</option></select></label>
   <form className="catalog-price-filter" onSubmit={applyPrice}><span>Fiyat aralığı</span><div><input aria-label="En düşük katalog fiyatı" inputMode="decimal" placeholder="En az" value={min} onChange={e=>setMin(e.target.value)}/><i>–</i><input aria-label="En yüksek katalog fiyatı" inputMode="decimal" placeholder="En çok" value={max} onChange={e=>setMax(e.target.value)}/><button type="submit">Uygula</button></div>{priceError&&<p className="customer-error" role="alert">{priceError}</p>}</form>
  </div>
  {(facets.limits?.vendors||facets.limits?.tags)&&<p className="catalog-filter-hint">Daha fazla seçenek için arama alanını kullanarak sonuçları daraltabilirsiniz.</p>}
  {error&&<p className="catalog-filter-hint" role="status">{error}</p>}
 </div>;
}

export default function CustomerCatalog({initial,initialError=''}:{initial:CatalogPage;initialError?:string}){
 const [data,setData]=useState(initial),[query,setQuery]=useState(''),[filters,setFilters]=useState<Filters>(emptyFilters);
 const [cursors,setCursors]=useState<(string|null)[]>([null]),[loading,setLoading]=useState(false),[error,setError]=useState(initialError);
 const [facets,setFacets]=useState<Facets>({vendors:initial.vendors,types:initial.types,tags:[]}),[facetsLoading,setFacetsLoading]=useState(true),[facetsError,setFacetsError]=useState('');
 const [menu,setMenu]=useState(false),[filterOpen,setFilterOpen]=useState(false),[cartOpen,setCartOpen]=useState(false),[detail,setDetail]=useState<CatalogItem|null>(null);
 const [lines,setLines]=useState<Line[]>([]),[notice,setNotice]=useState(''),[name,setName]=useState(''),[note,setNote]=useState(''),[quote,setQuote]=useState(''),[preparing,setPreparing]=useState(false);
 const firstLoad=useRef(true),resultRef=useRef<HTMLElement>(null),loadRevision=useRef(0),quoteRevision=useRef(0),quoteRequest=useRef(0);
 const cursor=cursors.at(-1)||'',page=cursors.length,filterCount=Object.entries(filters).filter(([key,value])=>value&&key!=='maxPrice').length+(filters.maxPrice&&!filters.minPrice?1:0);
 const load=useCallback(async(signal?:AbortSignal)=>{
  const revision=++loadRevision.current;
  setLoading(true);setError('');
  try{const params=new URLSearchParams({q:query,...filters});if(cursor)params.set('after',cursor);const next=await request<CatalogPage>('/api/catalog?'+params,{signal});if(!signal?.aborted&&revision===loadRevision.current)setData(next)}
  catch(e){if(!signal?.aborted&&revision===loadRevision.current)setError((e as Error).message)}
  finally{if(!signal?.aborted&&revision===loadRevision.current)setLoading(false)}
 },[query,filters,cursor]);
 useEffect(()=>{
  if(firstLoad.current){firstLoad.current=false;return}
  const controller=new AbortController(),timer=setTimeout(()=>void load(controller.signal),250);
  return()=>{clearTimeout(timer);controller.abort()};
 },[load]);
 useEffect(()=>{
  const controller=new AbortController();
  const timer=setTimeout(async()=>{
   setFacetsLoading(true);setFacetsError('');
   try{const next=await request<Facets>('/api/catalog/filters?'+new URLSearchParams({q:query,vendor:filters.vendor,type:filters.type}),{signal:controller.signal});if(!controller.signal.aborted)setFacets(next)}
   catch{if(!controller.signal.aborted)setFacetsError('Filtre seçenekleri şu anda yüklenemedi.')}
   finally{if(!controller.signal.aborted)setFacetsLoading(false)}
  },250);
  return()=>{clearTimeout(timer);controller.abort()};
 },[query,filters.vendor,filters.type]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),2200);return()=>clearTimeout(timer)},[notice]);
 const pendingResults=()=>{loadRevision.current++;setLoading(true);setError('')};
 const changeFilters=(next:Partial<Filters>)=>{if(Object.entries(next).every(([key,value])=>filters[key as keyof Filters]===value)&&!cursor)return;pendingResults();setFilters(old=>({...old,...next}));setCursors([null])};
 const clearFilters=()=>changeFilters(emptyFilters);
 const search=(value:string)=>{if(value===query&&!cursor)return;pendingResults();setQuery(value);setCursors([null])};
 const invalidateQuote=()=>{quoteRevision.current++;setQuote('')};
 const add=(product:CatalogItem,amount=1)=>{
  if(lines.length>=100&&!lines.some(line=>line.product.id===product.id)){setNotice('Bir sipariş listesine en fazla 100 farklı ürün seçeneği ekleyebilirsiniz.');return;}
  setLines(old=>old.some(line=>line.product.id===product.id)?old.map(line=>line.product.id===product.id?{...line,quantity:Math.min(100000,line.quantity+amount)}:line):old.length>=100?old:[...old,{product,quantity:amount}]);
  invalidateQuote();setNotice('Sepete eklendi');
 };
 const quantity=(id:string,value:number)=>{setLines(old=>old.map(line=>line.product.id===id?{...line,quantity:value}:line));invalidateQuote()};
 const remove=(id:string)=>{setLines(old=>old.filter(line=>line.product.id!==id));invalidateQuote()};
 const count=lines.reduce((sum,line)=>sum+line.quantity,0),total=lines.reduce((sum,line)=>sum+(line.product.catalogPrice||0)*line.quantity,0),missing=lines.some(line=>line.product.catalogPrice===null),anyPriced=lines.some(line=>line.product.catalogPrice!==null);
 const prepare=async()=>{
  const revision=quoteRevision.current,requestId=++quoteRequest.current;
  setPreparing(true);setQuote('');
  try{
   const response=await request('/api/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,note,lines:lines.map(line=>({id:line.product.id,title:line.product.title,quantity:line.quantity}))})});
   if(revision!==quoteRevision.current||requestId!==quoteRequest.current)return;
   setLines(old=>old.map(line=>({...line,product:{...line.product,catalogPrice:response.lines.find((x:any)=>x.id===line.product.id)?.price??null}})));setQuote(response.text);
  }catch(e){if(revision===quoteRevision.current&&requestId===quoteRequest.current)setNotice((e as Error).message)}
  finally{if(requestId===quoteRequest.current)setPreparing(false)}
 };
 const copy=async()=>{try{await navigator.clipboard.writeText(quote);setNotice('Liste kopyalandı')}catch{setNotice('Kopyalanamadı; WhatsApp paylaşımını kullanabilirsiniz.')}};
 const filterPanel=<FilterPanel filters={filters} facets={facets} loading={facetsLoading} error={facetsError} onChange={changeFilters} onClear={clearFilters}/>;
 const chips=[
  filters.vendor&&{label:filters.vendor,clear:{vendor:'',type:'',tag:''}},
  filters.type&&{label:filters.type,clear:{type:'',tag:''}},
  filters.tag&&{label:filters.tag,clear:{tag:''}},
  filters.stock&&{label:filters.stock==='available'?'Satışa açık':'Tükenenler',clear:{stock:''}},
 (filters.minPrice||filters.maxPrice)&&{label:(filters.minPrice?money(Math.round(Number(filters.minPrice)*100)):'0 TL')+' – '+(filters.maxPrice?money(Math.round(Number(filters.maxPrice)*100)):'Üst sınır yok'),clear:{minPrice:'',maxPrice:''}}
 ].filter(Boolean) as {label:string;clear:Partial<Filters>}[];
 const quickTypes=facets.types.slice(0,8);

 return <div className={'customer-site trade-catalog catalog-workspace'+(lines.length?' has-cart':'')}>
  <a className="catalog-skip-link" href="#catalog-products">Ürünlere geç</a>
  <div className="catalog-top">
   <header className="customer-header">
    <Button size="icon" variant="ghost" aria-label="Menüyü aç" onClick={()=>setMenu(true)}><Menu/></Button>
    <Link className="customer-brand" href="/" aria-label="Alaçam Dağıtım katalog ana sayfası"><img src={logo} alt="Alaçam Dağıtım"/><small>Dijital katalog</small></Link>
    <form className="customer-search" role="search" onSubmit={event=>{event.preventDefault();void load()}}><Search aria-hidden="true"/><Input type="search" value={query} onChange={e=>search(e.target.value)} placeholder="Ürün, marka veya barkod ara…" aria-label="Ürün, marka veya barkod ara" autoComplete="off"/>{query&&<Button type="button" className="trade-search-clear" size="icon" variant="ghost" aria-label="Aramayı temizle" onClick={()=>search('')}><X/></Button>}<button className="catalog-search-submit" type="submit" aria-label="Ürünleri ara">Ara</button></form>
    <Button className="customer-cart-button" aria-label={'Sepetim, '+count.toLocaleString('tr-TR')+' adet'} onClick={()=>setCartOpen(true)}><ShoppingCart/><span>Sepetim</span><b>{count.toLocaleString('tr-TR')}</b></Button>
   </header>
  </div>
  <main className="customer-main catalog-layout">
   <section className="customer-results" id="catalog-products" ref={resultRef}>
    <div className="catalog-breadcrumb"><span>Dijital katalog</span><ChevronRight/><span>{filters.vendor||'Tüm ürünler'}</span>{filters.type&&<><ChevronRight/><span>{filters.type}</span></>}</div>
    <div className="trade-result-bar"><div><h1>{query?'“'+query+'” için sonuçlar':filters.type||filters.vendor||'Ürün kataloğu'}</h1><p>Marka ve ürün grupları arasında hızlıca gezin, sipariş listenizi oluşturun.</p></div></div>
    <nav className="catalog-quick-types" aria-label="Popüler ürün türleri"><button type="button" className={!filters.type?'is-active':''} onClick={()=>changeFilters({type:'',tag:''})}>Tüm ürünler</button>{quickTypes.map(type=><button type="button" key={type} className={filters.type===type?'is-active':''} onClick={()=>changeFilters({type:filters.type===type?'':type,tag:''})}>{type}</button>)}</nav>
    <div className="catalog-results-toolbar"><button className={'catalog-filter-toggle'+(filterOpen?' is-open':'')} type="button" aria-expanded={filterOpen} aria-controls="catalog-inline-filters" onClick={()=>setFilterOpen(open=>!open)}><SlidersHorizontal/>Filtrele{filterCount>0&&<b>{filterCount}</b>}<ChevronRight/></button><span role="status">{loading?<><LoaderCircle className="catalog-loading-icon"/>Ürünler yükleniyor…</>:<><strong>{data.items.length.toLocaleString('tr-TR')}</strong> ürün gösteriliyor</>}</span><span className="catalog-page-label">Sayfa {page}</span></div>
    <div id="catalog-inline-filters" className={'catalog-inline-filters'+(filterOpen?' is-open':'')}>{filterPanel}<button className="catalog-filter-close" type="button" onClick={()=>setFilterOpen(false)}>Filtreleri kapat</button></div>
    {(chips.length>0||query)&&<div className="trade-active-filters">{query&&<button onClick={()=>search('')} aria-label="Aramayı temizle">Arama: {query}<X/></button>}{chips.map((chip,index)=><button key={index+chip.label} onClick={()=>changeFilters(chip.clear)} aria-label={chip.label+' filtresini kaldır'}>{chip.label}<X/></button>)}{filterCount>0&&<button className="catalog-clear-filters" onClick={clearFilters}>Filtreleri temizle</button>}</div>}
    {error?<div className="empty catalog-empty" role="alert"><Package/><h2>Ürünler yüklenemedi</h2><p>{error}</p><Button onClick={()=>load()}>Yeniden dene</Button></div>:!data.items.length?<div className="empty catalog-empty">{loading?<LoaderCircle className="catalog-loading-icon"/>:<Package/>}<h2>{loading?'Ürünler yükleniyor…':data.hasNextPage?'Bu sayfada eşleşme bulunamadı':!query.trim()&&!filterCount?'Katalog hazırlanıyor':'Aramanızla eşleşen ürün yok'}</h2><p>{loading?'Sonuçlar birkaç saniye içinde burada görünecek.':data.hasNextPage?'Diğer ürünlere bakmak için sonraki sayfaya geçebilirsiniz.':!query.trim()&&!filterCount?'Kataloğa eklenen ürünler burada listelenecek.':'Aramanızı değiştirebilir veya filtreleri temizleyebilirsiniz.'}</p>{!loading&&(filterCount>0||query)&&<Button variant="outline" onClick={()=>{setQuery('');changeFilters(emptyFilters);if(!filterCount)search('')}}>Tüm ürünleri göster</Button>}</div>:<div className="trade-list catalog-product-grid" aria-busy={loading}>{data.items.map(product=>{
     const line=lines.find(item=>item.product.id===product.id);
     return <article className={'trade-row'+(line?' in-cart':'')} key={product.id}>
      <button className="trade-product" onClick={()=>setDetail(product)} aria-label={product.title+' ürün detayını aç'}><div className="trade-image">{product.image?<img src={product.image} alt="" loading="lazy"/>:<Package/>}{!product.available&&<span>Tükendi</span>}</div><div className="trade-product-text"><p className="catalog-product-brand">{product.vendor||'Alaçam Dağıtım'}</p><h2>{product.title}</h2><p className="catalog-product-meta">{product.type&&<span>{product.type}</span>}</p></div></button>
      <div className="trade-purchase"><div className="trade-price"><strong>{product.catalogPrice===null?'Fiyat sorunuz':money(product.catalogPrice)}</strong><small>{line?<><Check/>Sepette {line.quantity.toLocaleString('tr-TR')} adet</>:'Birim fiyat'}</small></div>{line?<div className="trade-row-actions"><Quantity value={line.quantity} label={product.title} onChange={value=>quantity(product.id,value)}/><Button size="icon" variant="ghost" aria-label={product.title+' sepetten çıkar'} onClick={()=>remove(product.id)}><Trash2/></Button></div>:<Button className="trade-add" disabled={!product.available} onClick={()=>add(product)}>{product.available?<><Plus/>Sepete ekle</>:'Tükendi'}</Button>}</div>
     </article>;
    })}</div>}
    <div className="customer-pagination"><Button variant="outline" aria-label="Önceki sayfa" disabled={page===1||loading} onClick={()=>{pendingResults();setCursors(old=>old.slice(0,-1));resultRef.current?.scrollIntoView({block:'start'})}}><ChevronLeft/>Önceki</Button><span>Sayfa {page}</span><Button variant="outline" aria-label="Sonraki sayfa" disabled={!data.hasNextPage||loading} onClick={()=>{if(data.cursor){pendingResults();setCursors(old=>[...old,data.cursor])}resultRef.current?.scrollIntoView({block:'start'})}}>Sonraki<ChevronRight/></Button></div>
    <p className="customer-disclaimer">Fiyat, stok, KDV ve teslimat sipariş öncesinde teyit edilir.</p>
   </section>
  </main>
  <Sheet open={menu} onOpenChange={setMenu}><SheetContent side="left" className="customer-drawer catalog-workspace-sheet"><SheetHeader><SheetTitle>Alaçam Dağıtım</SheetTitle><SheetDescription>Dijital ürün kataloğu</SheetDescription></SheetHeader><nav className="customer-menu"><button className="is-current" onClick={()=>setMenu(false)}><Package/>Ürün kataloğu<ChevronRight/></button><button onClick={()=>{setMenu(false);setCartOpen(true)}}><ShoppingCart/>Sepetim<span>{count.toLocaleString('tr-TR')}</span></button><div className="nav-divider"/><p className="catalog-menu-label">YÖNETİM</p><Link href="/giris"><ShieldCheck/>Yönetici girişi<ArrowUpRight/></Link></nav></SheetContent></Sheet>
  {detail&&<ProductDetail key={detail.id} product={detail} onClose={()=>setDetail(null)} onAdd={amount=>{add(detail,amount);setDetail(null)}} onFilter={filter=>{setQuery('');changeFilters({...emptyFilters,...filter});setDetail(null)}}/>}
  <Sheet open={cartOpen} onOpenChange={setCartOpen}><SheetContent className="customer-cart-sheet catalog-workspace-sheet"><SheetHeader><SheetTitle>Sepetim <span className="catalog-cart-count">{lines.length} seçenek</span></SheetTitle><SheetDescription>Sipariş listenizi hazırlayın ve WhatsApp’tan paylaşın.</SheetDescription></SheetHeader><div className="customer-cart-body">{!lines.length?<div className="empty catalog-empty"><ShoppingCart/><h2>Sepetiniz henüz boş</h2><p>Katalogdan ürün ekleyerek başlayın.</p><Button onClick={()=>setCartOpen(false)}>Ürünlere dön</Button></div>:<>{lines.map(line=><article className="customer-cart-line" key={line.product.id}><h3>{line.product.title}</h3><small>Birim fiyat: {line.product.catalogPrice===null?'Fiyat sorunuz':money(line.product.catalogPrice)}</small><div><Quantity value={line.quantity} label={line.product.title} onChange={value=>quantity(line.product.id,value)}/><strong>{line.product.catalogPrice===null?'Fiyat sorunuz':money(line.product.catalogPrice*line.quantity)}</strong><Button size="icon" variant="ghost" aria-label={line.product.title+' sepetten çıkar'} onClick={()=>remove(line.product.id)}><Trash2/></Button></div></article>)}<div className="customer-total"><span>{missing?'Fiyatı belli ürünler':'Liste toplamı'}<small>{count.toLocaleString('tr-TR')} adet</small></span><strong>{anyPriced?money(total):'Fiyat istenecek'}</strong></div>{missing&&<p className="catalog-cart-note">Fiyatı belirtilmeyen ürünler için ayrıca teklif istenecektir.</p>}<label>Adınız veya firma adınız<Input value={name} autoComplete="organization" placeholder="Örn. Alaçam Kafe" onChange={e=>{setName(e.target.value);invalidateQuote()}}/></label><label>Sipariş notu <span className="catalog-optional">(isteğe bağlı)</span><textarea value={note} placeholder="Teslimat veya ürünlerle ilgili notunuz" onChange={e=>{setNote(e.target.value);invalidateQuote()}}/></label><Button className="catalog-prepare-order" disabled={preparing} onClick={prepare}>{preparing?<><LoaderCircle className="catalog-loading-icon"/>Güncel fiyatlar kontrol ediliyor…</>:'Sipariş listesini oluştur'}</Button><p className="catalog-cart-note">Bu işlem ödeme veya kesin sipariş oluşturmaz.</p>{quote&&<div className="customer-share"><p><Check/>Sipariş listeniz hazır.</p><a className="login-button" target="_blank" rel="noopener noreferrer" href={'https://wa.me/?text='+encodeURIComponent(quote)}>WhatsApp’ta paylaş<ArrowUpRight/></a><Button variant="outline" onClick={copy}>Listeyi kopyala</Button></div>}</>}</div></SheetContent></Sheet>
  {lines.length>0&&!cartOpen&&<div className="trade-cart-bar"><div><span>{lines.length} ürün · {count.toLocaleString('tr-TR')} adet</span><strong>{anyPriced?money(total):'Fiyat istenecek'}</strong></div><Button onClick={()=>setCartOpen(true)}><ShoppingCart/>Sepeti görüntüle</Button></div>}
  {notice&&<div className="customer-toast" role="status">{notice}</div>}
 </div>;
}
