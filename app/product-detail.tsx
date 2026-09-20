'use client';
import {useState} from 'react';
import {ArrowUpRight,Check,Minus,Package,Plus,ShoppingCart,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Sheet,SheetContent,SheetDescription,SheetTitle} from '@/components/ui/sheet';
import type {CatalogItem} from '@/lib/live-catalog';
import {money} from '@/lib/model';

export default function ProductDetail({product,onClose,onAdd,onFilter}:{product:CatalogItem;onClose:()=>void;onAdd:(quantity:number)=>void;onFilter:(filter:{vendor?:string;type?:string;tag?:string})=>void}){
 const [quantity,setQuantity]=useState(1);
 const setCount=(count:number)=>setQuantity(Math.max(1,Math.min(100000,Math.floor(count)||1)));
 return <Sheet open onOpenChange={open=>{if(!open)onClose()}}><SheetContent side="right" className="product-detail-sheet catalog-product-sheet" showCloseButton={false}>
  <header className="product-detail-nav"><span>Ürün detayı</span><Button size="icon" variant="ghost" onClick={onClose} aria-label="Ürün detayını kapat"><X/></Button></header>
  <div className="product-detail-body">
   <div className="product-detail-brand"><button onClick={()=>onFilter({vendor:product.vendor})}>{product.vendor||'Alaçam Dağıtım'}</button>{product.type&&<><span>/</span><button onClick={()=>onFilter({type:product.type})}>{product.type}</button></>}</div>
   <SheetTitle className="product-detail-title">{product.title}</SheetTitle>
   <SheetDescription className="sr-only">Ürün bilgileri, katalog fiyatı ve sipariş adedi.</SheetDescription>
   <div className="product-detail-overview">
    <div className="product-detail-image">{product.image?<img src={product.image} alt={product.title}/>:<Package/>}</div>
    <div className="product-detail-summary"><span className={'product-detail-stock'+(!product.available?' is-unavailable':'')}>{product.available?<Check/>:<Minus/>}{product.available?'Satışa açık':'Şu anda tükendi'}</span><span className="product-detail-price-label">Birim fiyat</span><strong>{product.catalogPrice===null?'Fiyat sorunuz':money(product.catalogPrice)}</strong><p>{product.catalogPrice===null?'Sipariş listenize ekleyerek fiyat isteyebilirsiniz.':'Kataloğa özel fiyat. Sipariş öncesinde teyit edilir.'}</p></div>
   </div>
   <section className="product-detail-section"><h3>Ürün bilgileri</h3><dl><div><dt>Marka</dt><dd>{product.vendor?<button onClick={()=>onFilter({vendor:product.vendor})}>{product.vendor}<ArrowUpRight/></button>:'Belirtilmemiş'}</dd></div><div><dt>Ürün türü</dt><dd>{product.type?<button onClick={()=>onFilter({type:product.type})}>{product.type}<ArrowUpRight/></button>:'Belirtilmemiş'}</dd></div><div><dt>Barkod</dt><dd className="catalog-product-barcode">{product.barcode||'Belirtilmemiş'}</dd></div></dl></section>
   <section className="product-detail-section"><h3>Ürün açıklaması</h3><p className="product-detail-description">{product.description||'Bu ürün için henüz açıklama bulunmuyor.'}</p></section>
   {!!product.tags?.length&&<section className="product-detail-section"><h3>İlgili etiketler</h3><div className="product-detail-tags">{product.tags.map(tag=><button key={tag} onClick={()=>onFilter({tag})}>{tag}<ArrowUpRight/></button>)}</div></section>}
   <a className="product-detail-source" href={product.storefrontUrl} target="_blank" rel="noopener noreferrer">Sitede gör<ArrowUpRight/></a>
  </div>
  <footer className="product-detail-footer">
   <div className="product-detail-total"><span>{quantity.toLocaleString('tr-TR')} adet {product.catalogPrice!==null?'toplamı':''}</span><strong>{product.catalogPrice===null?'Fiyat teyidi istenecek':money(product.catalogPrice*quantity)}</strong></div>
   <div className="product-detail-order"><div className="product-detail-quantity"><button aria-label="Sipariş adedini azalt" disabled={quantity<=1||!product.available} onClick={()=>setCount(quantity-1)}><Minus/></button><input aria-label="Sipariş adedi" inputMode="numeric" disabled={!product.available} value={quantity} onChange={e=>setCount(Number(e.target.value))}/><button aria-label="Sipariş adedini artır" disabled={quantity>=100000||!product.available} onClick={()=>setCount(quantity+1)}><Plus/></button></div><Button disabled={!product.available} onClick={()=>onAdd(quantity)}><ShoppingCart/>{product.available?'Sepete ekle':'Ürün tükendi'}</Button></div>
   <p>Sipariş listesi ödeme değildir. Fiyat, stok, KDV ve teslimat teyit edilir.</p>
  </footer>
 </SheetContent></Sheet>;
}
