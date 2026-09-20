'use client';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowUpRight,Check,ChevronLeft,ChevronRight,Menu,Minus,Package,Plus,Search,ShoppingCart,SlidersHorizontal,Trash2,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Sheet,SheetContent,SheetDescription,SheetHeader,SheetTitle} from '@/components/ui/sheet';
import FilterPicker from './catalog-filter-picker';
import ProductDetail from './product-detail';
import type {CatalogItem,CatalogPage} from '@/lib/live-catalog';
import {money} from '@/lib/model';

type Line={product:CatalogItem;quantity:number};
type Filters={vendor:string;type:string;tag:string;stock:string;minPrice:string;maxPrice:string};
type Facets={vendors:string[];types:string[];tags:string[];limits?:{vendors:boolean;types:boolean;tags:boolean}};
const emptyFilters:Filters={vendor:'',type:'',tag:'',stock:'',minPrice:'',maxPrice:''};
const logo='https://alacamdagitim.com/cdn/shop/files/LOGO_DENEME_SON_865056f4-5f9d-4701-a37e-f1d9be001d1a.webp?v=1774724316&width=400';
const normalize=(value:string)=>value.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
const request=async<T=any>(url:string,init?:RequestInit):Promise<T>=>{
 const response=await fetch(url,init),data=await response.json() as T & {error?:string};
 if(!response.ok)throw new Error(data.error||'İşlem tamamlanamadı.');
 return data;
};
function Quantity({value,onChange,label}:{value:number;onChange:(value:number)=>void;label:string}){
 return <div className="trade-quantity">
  <Button size="icon" variant="ghost" aria-label={label+' adedini azalt'} disabled={value<=1} onClick={()=>onChange(value-1)}><Minus/></Button>
  <Input value={value} inputMode="numeric" aria-label={label+' adedi'} onChange={e=>onChange(Math.max(1,Math.min(100000,Math.floor(Number(e.target.value)||1))))}/>
  <Button size="icon" variant="ghost" aria-label={label+' adedini artır'} onClick={()=>onChange(Math.min(100000,value+1))}><Plus/></Button>
 </div>;
}
function FilterPanel({filters,facets,loading,error,onChange,onClear}:{filters:Filters;facets:Facets;loading:boolean;error:string;onChange:(next:Partial<Filters>)=>void;onClear:()=>void}){
 const [typeSearch,setTypeSearch]=useState(''),[expanded,setExpanded]=useState(false);
 const [min,setMin]=useState(filters.minPrice),[max,setMax]=useState(filters.maxPrice),[priceError,setPriceError]=useState('');
 const stockName=useId();
 useEffect(()=>{setMin(filters.minPrice);setMax(filters.maxPrice)},[filters.minPrice,filters.maxPrice]);
 const matching=facets.types.filter(item=>normalize(item).includes(normalize(typeSearch)));
 const types=expanded||typeSearch?matching:matching.slice(0,8);
 const applyPrice=(event:React.FormEvent)=>{
  event.preventDefault();
  const a=min.trim().replace(',','.'),b=max.trim().replace(',','.');
  if((a&&(!Number.isFinite(Number(a))||Number(a)<0))||(b&&(!Number.isFinite(Number(b))||Number(b)<0))||(a&&b&&Number(a)>Number(b))){setPriceError('Geçerli bir alt ve üst fiyat girin.');return}
  setPriceError('');onChange({minPrice:a,maxPrice:b});
 };
 return <div className="catalog-filter-panel">
  <div className="catalog-filter-heading"><h2>Filtreler</h2><button type="button" onClick={onClear}>Temizle</button></div>
  <section className="catalog-filter-section"><FilterPicker label="Marka" placeholder="Tüm markalar" value={filters.vendor} options={facets.vendors} onChange={vendor=>onChange({vendor,type:'',tag:''})} loading={loading}/>{facets.limits?.vendors&&<p className="catalog-filter-hint">Daha fazla marka için ürün aramasını daraltın.</p>}</section>
  <section className="catalog-filter-section">
   <h3>Ürün türü</h3>
   <div className="catalog-type-search"><Search/><input aria-label="Ürün türlerinde ara" placeholder="Tür ara" value={typeSearch} onChange={e=>setTypeSearch(e.target.value)}/></div>
   <div className="catalog-type-options" aria-label="Ürün türleri">
    <button type="button" className={!filters.type?'is-selected':''} aria-pressed={!filters.type} onClick={()=>onChange({type:''})}><span>Tüm türler</span>{!filters.type&&<Check/>}</button>
    {filters.type&&!types.includes(filters.type)&&<button type="button" className="is-selected" aria-pressed="true" onClick={()=>onChange({type:''})}><span>{filters.type}</span><Check/></button>}
    {types.map(type=><button type="button" key={type} className={filters.type===type?'is-selected':''} aria-pressed={filters.type===type} onClick={()=>onChange({type:filters.type===type?'':type})}><span>{type}</span>{filters.type===type&&<Check/>}</button>)}
   </div>
   {matching.length>8&&!typeSearch&&<button className="catalog-show-more" type="button" onClick={()=>setExpanded(!expanded)}>{expanded?'Daha az göster':'Tüm türleri göster ('+matching.length+')'}</button>}
   {!matching.length&&<p className="catalog-filter-hint">{loading?'Türler yükleniyor…':'Bu aramada tür bulunamadı.'}</p>}
  </section>
  <section className="catalog-filter-section"><FilterPicker label="Etiket" placeholder="Tüm etiketler" value={filters.tag} options={facets.tags} onChange={tag=>onChange({tag})} loading={loading}/>{facets.limits?.tags&&<p className="catalog-filter-hint">Daha fazla etiket için marka seçin veya aramanızı daraltın.</p>}</section>
  <fieldset className="catalog-filter-section catalog-stock-options"><legend>Stok durumu</legend>
   {[['','Tümü'],['available','Satışa açık'],['unavailable','Tükenenler']].map(([value,label])=><label key={value}><input type="radio" name={stockName} value={value} checked={filters.stock===value} onChange={()=>onChange({stock:value})}/><span>{label}</span></label>)}
  </fieldset>
  <form className="catalog-filter-section catalog-price-filter" onSubmit={applyPrice}>
   <h3>Fiyat aralığı <span>TL</span></h3>
   <div><input aria-label="En düşük katalog fiyatı" inputMode="decimal" placeholder="En az" value={min} onChange={e=>setMin(e.target.value)}/><span>–</span><input aria-label="En yüksek katalog fiyatı" inputMode="decimal" placeholder="En çok" value={max} onChange={e=>setMax(e.target.value)}/></div>
   <button type="submit">Fiyatı uygula</button>
   <p className="catalog-filter-hint">Yalnızca katalog fiyatı belirlenmiş ürünler.</p>{priceError&&<p className="customer-error" role="alert">{priceError}</p>}
  </form>
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
   try{const next=await request<Facets>('/api/catalog/filters?'+new URLSearchParams({q:query,vendor:filters.vendor}),{signal:controller.signal});if(!controller.signal.aborted)setFacets(next)}
   catch{if(!controller.signal.aborted)setFacetsError('Filtre seçenekleri şu anda yüklenemedi.')}
   finally{if(!controller.signal.aborted)setFacetsLoading(false)}
  },250);
  return()=>{clearTimeout(timer);controller.abort()};
 },[query,filters.vendor]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),2200);return()=>clearTimeout(timer)},[notice]);
 const pendingResults=()=>{loadRevision.current++;setLoading(true);setError('')};
 const changeFilters=(next:Partial<Filters>)=>{pendingResults();setFilters(old=>({...old,...next}));setCursors([null])};
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
 const preferred=['Siyah Çay','Bitki Çayı','Kahve','Şurup','Sos','Karton Bardak','PET Bardak','Peçete','Kutu'];
 const quickTypes=(query||filters.vendor?facets.types:[...preferred.filter(t=>facets.types.includes(t)),...facets.types.filter(t=>!preferred.includes(t))]).slice(0,10);
 if(filters.type&&!quickTypes.includes(filters.type))quickTypes.unshift(filters.type);
 const filterPanel=<FilterPanel filters={filters} facets={facets} loading={facetsLoading} error={facetsError} onChange={changeFilters} onClear={clearFilters}/>;
 const chips=[
  filters.vendor&&{label:filters.vendor,clear:{vendor:'',type:'',tag:''}},
  filters.type&&{label:filters.type,clear:{type:''}},
  filters.tag&&{label:filters.tag,clear:{tag:''}},
  filters.stock&&{label:filters.stock==='available'?'Satışa açık':'Tükenenler',clear:{stock:''}},
  (filters.minPrice||filters.maxPrice)&&{label:(filters.minPrice?money(Math.round(Number(filters.minPrice)*100)):'0 TL')+' – '+(filters.maxPrice?money(Math.round(Number(filters.maxPrice)*100)):'Üst sınır yok'),clear:{minPrice:'',maxPrice:''}}
 ].filter(Boolean) as {label:string;clear:Partial<Filters>}[];

 return <div className={'customer-site trade-catalog'+(lines.length?' has-cart':'')}>
  <div className="catalog-top">
   <header className="customer-header">
    <Button size="icon" variant="ghost" aria-label="Menüyü aç" onClick={()=>setMenu(true)}><Menu/></Button>
    <Link className="customer-brand" href="/" aria-label="Alaçam Dağıtım katalog ana sayfası"><img src={logo} alt="Alaçam Dağıtım"/><small>Toptan katalog</small></Link>
    <div className="customer-search"><Search/><Input value={query} onChange={e=>search(e.target.value)} placeholder="Ürün veya marka ara" aria-label="Ürün veya marka ara"/>{query&&<Button className="trade-search-clear" size="icon" variant="ghost" aria-label="Aramayı temizle" onClick={()=>search('')}><X/></Button>}</div>
    <Button className="customer-cart-button" onClick={()=>setCartOpen(true)}><ShoppingCart/><span>Sepet</span><b>{count.toLocaleString('tr-TR')}</b></Button>
   </header>
   <div className="catalog-mobile-tools"><FilterPicker label="Marka" placeholder="Tüm markalar" value={filters.vendor} options={facets.vendors} onChange={vendor=>changeFilters({vendor,type:'',tag:''})} loading={facetsLoading} error={facetsError}/><button className="catalog-filter-toggle" type="button" onClick={()=>setFilterOpen(true)}><SlidersHorizontal/>Filtrele{filterCount>0&&<b>{filterCount}</b>}</button></div>
   <nav className="catalog-type-tabs" aria-label="Hızlı ürün türü seçimi"><button aria-pressed={!filters.type} className={!filters.type?'is-selected':''} onClick={()=>changeFilters({type:''})}>Tüm ürünler</button>{quickTypes.map(type=><button key={type} aria-pressed={filters.type===type} className={filters.type===type?'is-selected':''} onClick={()=>changeFilters({type})}>{type}</button>)}</nav>
  </div>
  <main className="customer-main catalog-layout">
   <aside className="catalog-sidebar" aria-label="Katalog filtreleri">{filterPanel}</aside>
   <section className="customer-results" ref={resultRef}>
    <div className="trade-result-bar"><div><h1>{filters.type||filters.vendor||(query?'“'+query+'” sonuçları':'Tüm ürünler')}</h1><span role="status">{loading?'Aranıyor…':'Bu sayfada '+data.items.length.toLocaleString('tr-TR')+' seçenek'}</span></div></div>
    {chips.length>0&&<div className="trade-active-filters">{chips.map((chip,index)=><button key={index+chip.label} onClick={()=>changeFilters(chip.clear)} aria-label={chip.label+' filtresini kaldır'}>{chip.label}<X/></button>)}<button onClick={clearFilters}>Tümünü temizle</button></div>}
    {error?<div className="empty" role="alert"><p>{error}</p><Button onClick={()=>load()}>Yeniden dene</Button></div>:!data.items.length?<div className="empty"><Package/><h2>{loading?'Ürünler aranıyor…':data.hasNextPage?'Bu sayfada eşleşme yok':!query.trim()&&!filterCount?'Henüz ürün yayınlanmadı':'Ürün bulunamadı'}</h2><p>{data.hasNextPage?'Diğer ürünleri taramak için sonraki sayfaya geçin.':!query.trim()&&!filterCount?'Kataloğa eklenen ürünler burada görünecek.':'Başka bir tür seçebilir veya filtreleri kaldırabilirsiniz.'}</p>{filterCount>0&&<Button variant="outline" onClick={clearFilters}>Filtreleri temizle</Button>}</div>:<div className="trade-list" aria-busy={loading}>{data.items.map(product=>{
     const line=lines.find(item=>item.product.id===product.id);
     return <article className={'trade-row'+(line?' in-cart':'')} key={product.id}>
      <button className="trade-product" onClick={()=>setDetail(product)}><div className="trade-image">{product.image?<img src={product.image} alt="" loading="lazy"/>:<Package/>}</div><div className="trade-product-text"><h2>{product.title}</h2><p>{product.vendor}{product.type?' · '+product.type:''}</p></div></button>
      <div className="trade-purchase"><div className="trade-price"><strong>{product.catalogPrice===null?'Fiyat sorunuz':money(product.catalogPrice)}</strong>{line&&<small><Check/>Sepette</small>}</div>{line?<div className="trade-row-actions"><Quantity value={line.quantity} label={product.title} onChange={value=>quantity(product.id,value)}/><Button size="icon" variant="ghost" aria-label={product.title+' sepetten çıkar'} onClick={()=>remove(product.id)}><Trash2/></Button></div>:<Button className="trade-add" disabled={!product.available} onClick={()=>add(product)}>{product.available?<><Plus/>Ekle</>:'Tükendi'}</Button>}</div>
     </article>;
    })}</div>}
    <div className="customer-pagination"><Button size="icon" variant="outline" aria-label="Önceki sayfa" disabled={page===1||loading} onClick={()=>{pendingResults();setCursors(old=>old.slice(0,-1));resultRef.current?.scrollIntoView({block:'start'})}}><ChevronLeft/></Button><span>Sayfa {page}</span><Button size="icon" variant="outline" aria-label="Sonraki sayfa" disabled={!data.hasNextPage||loading} onClick={()=>{if(data.cursor){pendingResults();setCursors(old=>[...old,data.cursor])}resultRef.current?.scrollIntoView({block:'start'})}}><ChevronRight/></Button></div>
    <p className="customer-disclaimer">Fiyat, stok, KDV ve teslimat sipariş öncesinde teyit edilir.</p>
   </section>
  </main>
  <Sheet open={filterOpen} onOpenChange={setFilterOpen}><SheetContent side="left" className="catalog-filter-sheet"><SheetHeader><SheetTitle>Ürünleri filtrele</SheetTitle><SheetDescription>Marka, tür, etiket, stok ve fiyat seçin.</SheetDescription></SheetHeader><div className="catalog-filter-sheet-body">{filterPanel}</div><div className="catalog-filter-sheet-footer"><Button onClick={()=>setFilterOpen(false)}>Ürünleri göster<ChevronRight/></Button></div></SheetContent></Sheet>
  <Sheet open={menu} onOpenChange={setMenu}><SheetContent side="left" className="customer-drawer"><SheetHeader><SheetTitle>Alaçam Dağıtım</SheetTitle><SheetDescription>Dijital ürün kataloğu</SheetDescription></SheetHeader><nav className="customer-menu"><button onClick={()=>setMenu(false)}><Package/>Ürün kataloğu</button><button onClick={()=>{setMenu(false);setCartOpen(true)}}><ShoppingCart/>Sepetim</button><div className="nav-divider"/><Link href="/giris">Fiyat yönetimi<ArrowUpRight/></Link></nav></SheetContent></Sheet>
  {detail&&<ProductDetail key={detail.id} product={detail} onClose={()=>setDetail(null)} onAdd={amount=>{add(detail,amount);setDetail(null)}} onFilter={filter=>{setQuery('');changeFilters({...emptyFilters,...filter});setDetail(null)}}/>}
  <Sheet open={cartOpen} onOpenChange={setCartOpen}><SheetContent className="customer-cart-sheet"><SheetHeader><SheetTitle>Sepetim ({count.toLocaleString('tr-TR')} adet)</SheetTitle><SheetDescription>Talep listenizi WhatsApp’tan iletin. {lines.length}/100 ürün seçeneği.</SheetDescription></SheetHeader><div className="customer-cart-body">{!lines.length?<div className="empty"><ShoppingCart/><h2>Sepetiniz boş</h2></div>:<>{lines.map(line=><article className="customer-cart-line" key={line.product.id}><h3>{line.product.title}</h3><small>{line.product.catalogPrice===null?'Fiyat sorunuz':money(line.product.catalogPrice)}</small><div><Quantity value={line.quantity} label={line.product.title} onChange={value=>quantity(line.product.id,value)}/><strong>{line.product.catalogPrice===null?'—':money(line.product.catalogPrice*line.quantity)}</strong><Button size="icon" variant="ghost" aria-label={line.product.title+' sepetten çıkar'} onClick={()=>remove(line.product.id)}><Trash2/></Button></div></article>)}<div className="customer-total"><span>{missing?'Fiyatı belli ürünler':'Liste toplamı'}</span><strong>{anyPriced?money(total):'Fiyat istenecek'}</strong></div><label>Adınız / firma<Input value={name} onChange={e=>{setName(e.target.value);invalidateQuote()}}/></label><label>Not<textarea value={note} onChange={e=>{setNote(e.target.value);invalidateQuote()}}/></label><Button disabled={preparing} onClick={prepare}>{preparing?'Hazırlanıyor…':'Listeyi hazırla'}</Button>{quote&&<div className="customer-share"><p><Check/>Liste hazır.</p><a className="login-button" target="_blank" rel="noopener noreferrer" href={'https://wa.me/?text='+encodeURIComponent(quote)}>WhatsApp’ta paylaş<ArrowUpRight/></a><Button variant="outline" onClick={copy}>Listeyi kopyala</Button></div>}</>}</div></SheetContent></Sheet>
  {lines.length>0&&!cartOpen&&<div className="trade-cart-bar"><div><span>{lines.length} ürün · {count.toLocaleString('tr-TR')} adet</span><strong>{anyPriced?money(total):'Fiyat istenecek'}</strong></div><Button onClick={()=>setCartOpen(true)}><ShoppingCart/>Sepeti görüntüle</Button></div>}
  {notice&&<div className="customer-toast" role="status">{notice}</div>}
 </div>;
}
