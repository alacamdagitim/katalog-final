import {db, HttpError, listProducts} from './server';
import {money, type Product} from './model';
import {productStorefrontUrl} from './storefront';

export type CatalogItem = Pick<Product,'id'|'title'|'vendor'|'type'|'description'|'barcode'|'catalogPrice'|'image'> & {stockState:'available'|'empty'|'unknown';storefrontUrl:string|null};
export type CatalogPage = {items:CatalogItem[];total:number;page:number;pages:number;vendors:string[];types:string[]};
export function customerItem(p:Product):CatalogItem {
 return {id:p.id,title:p.title,vendor:p.vendor,type:p.type,description:p.description,barcode:p.barcode,catalogPrice:p.catalogPrice,image:p.image,stockState:p.stock===null?'unknown':p.stock>0?'available':'empty',storefrontUrl:productStorefrontUrl(p)};
}
export async function customerCatalog(params:URLSearchParams):Promise<CatalogPage> {
 const safe=new URLSearchParams();
 for(const key of ['q','vendor','type','page','sort','stock'])if(params.has(key))safe.set(key,params.get(key)!);
 safe.set('view','catalog');
 const page=await listProducts(null,safe);
 return {items:page.items.map(customerItem),total:page.total,page:page.page,pages:page.pages,vendors:page.vendors,types:page.types};
}
// Read-only quote refresh: visitors cannot write orders, prices or inventory.
export async function customerQuote(body:any) {
 if(!body||!Array.isArray(body.lines)||!body.lines.length||body.lines.length>100)throw new HttpError(400,'Sepette 1–100 farklı ürün olmalı.');
 const ids=new Set<string>();
 for(const line of body.lines){
  if(!line||typeof line.id!=='string'||line.id.length>200||ids.has(line.id)||!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>100000)throw new HttpError(400,'Ürün adedi veya sepet bilgisi geçersiz.');
  ids.add(line.id);
 }
 const found:Product[]=[];const keys=[...ids];
 for(let i=0;i<keys.length;i+=40){const batch=keys.slice(i,i+40);const r=await db().prepare(`SELECT id,title,vendor,type,description,barcode,catalogPrice,image,stock,handle,shopifyVariantId FROM products WHERE visible=1 AND status='active' AND id IN (${batch.map(()=>'?').join(',')})`).bind(...batch).all<Product>();found.push(...r.results);}
 const map=new Map(found.map(p=>[p.id,p]));
 const lines=body.lines.map((line:any)=>{const p=map.get(line.id);if(!p||p.catalogPrice===null)throw new HttpError(409,'Sepette artık sunulmayan veya fiyatı olmayan bir ürün var. Sepetinizi kontrol edin.');return {product:customerItem(p),quantity:line.quantity};});
 const total=lines.reduce((sum:number,line:any)=>sum+line.product.catalogPrice*line.quantity,0);
 if(!Number.isSafeInteger(total)||total>100_000_000_000_000)throw new HttpError(400,'Sepet toplamı sınırı aşıldı.');
 const name=typeof body.name==='string'?body.name.trim().slice(0,120):'';
 const note=typeof body.note==='string'?body.note.trim().slice(0,500):'';
 const text=['Alaçam Dağıtım · Sipariş talebi',name?'Müşteri: '+name:'',...lines.map((l:any,i:number)=>`${i+1}. ${l.product.title}${l.product.barcode?' · Barkod: '+l.product.barcode:''}\n${l.quantity.toLocaleString('tr-TR')} adet × ${money(l.product.catalogPrice)} = ${money(l.quantity*l.product.catalogPrice)}`),'Liste toplamı: '+money(total),note?'Not: '+note:'','Stok, teslimat ve KDV durumu satıcı tarafından teyit edilecektir. Bu liste kesinleşmiş sipariş veya ödeme değildir.'].filter(Boolean).join('\n\n');
 return {lines,total,text};
}
