import {db,has,requirePermission,HttpError} from './server';
import {Member} from './model';
import {Cart,Customer,Order,OrderState,emptyCustomer,orderTotal} from './orders-model';

function textField(value:unknown,max:number){if(typeof value!=='string'||value.length>max)throw new HttpError(400,'Müşteri bilgisi çok uzun veya geçersiz.');return value.trim();}
export function cleanCustomer(input:any):Customer{
 if(!input||!['unspecified','included','excluded'].includes(input.tax))throw new HttpError(400,'Vergi durumunu seçin.');
 return {name:textField(input.name,120),company:textField(input.company,160),phone:textField(input.phone,40),note:textField(input.note,1500),tax:input.tax};
}
export async function readCart(u:Member):Promise<Cart>{
 requirePermission(u,'orders.create');
 const row=await db().prepare('SELECT version,payload FROM carts WHERE actor=?').bind(u.id).first<any>();
 return row?{...JSON.parse(row.payload),version:row.version}:{version:0,lines:[],customer:{...emptyCustomer}};
}
async function product(id:unknown){
 if(typeof id!=='string'||id.length>200)throw new HttpError(400,'Geçerli ürün seçin.');
 const p=await db().prepare("SELECT id,title,barcode,catalogPrice,stock FROM products WHERE id=? AND visible=1 AND status='active'").bind(id).first<any>();
 if(!p)throw new HttpError(404,'Ürün artık satış kataloğunda bulunmuyor.');
 if(!Number.isSafeInteger(p.catalogPrice)||p.catalogPrice<0)throw new HttpError(400,'Önce bu ürünün katalog fiyatını belirleyin.');
 return p;
}
const quantity=(value:unknown)=>{if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>100000)throw new HttpError(400,'Adet 1 ile 100.000 arasında tam sayı olmalı.');return value as number;};
async function currentProducts(cart:Cart){
 const result=new Map<string,any>();
 for(let i=0;i<cart.lines.length;i+=50){const ids=cart.lines.slice(i,i+50).map(l=>l.id);const rows=await db().prepare("SELECT id,title,barcode,catalogPrice,stock FROM products WHERE visible=1 AND status='active' AND id IN ("+ids.map(()=>'?').join(',')+")").bind(...ids).all<any>();for(const p of rows.results)result.set(p.id,p);}
 for(const line of cart.lines){const p=result.get(line.id);if(!p)throw new HttpError(409,'Sepetteki bir ürün artık katalogda değil. İlgili ürünü sepetten çıkarın.');if(!Number.isSafeInteger(p.catalogPrice)||p.catalogPrice<0)throw new HttpError(409,'Sepetteki bir ürünün fiyatı kaldırılmış. Katalog fiyatını kontrol edin.');}
 return result;
}
function totalCheck(cart:Cart){const total=orderTotal(cart.lines);if(!Number.isSafeInteger(total)||total>100000000000000)throw new HttpError(400,'Sipariş toplamı sınırı aşıldı.');return total;}
function assertVersion(actual:number,expected:unknown){if(!Number.isSafeInteger(expected)||expected!==actual)throw new HttpError(409,'Sepet veya sipariş başka bir pencerede değişti. Yenileyip tekrar deneyin.');}
export async function changeCart(u:Member,b:any){
 requirePermission(u,'orders.create');
 const cart=await readCart(u);assertVersion(cart.version,b.version);
 if(b.action==='add'){
  const p=await product(b.id),n=quantity(b.quantity),line=cart.lines.find(l=>l.id===p.id);
  if(line)line.quantity=quantity(line.quantity+n);
  else {if(cart.lines.length>=100)throw new HttpError(400,'Bir listede en fazla 100 farklı ürün olabilir.');cart.lines.push({id:p.id,title:p.title,barcode:p.barcode,price:p.catalogPrice,quantity:n,stock:p.stock});}
 }else if(b.action==='quantity'){
  const line=cart.lines.find(l=>l.id===b.id);if(!line)throw new HttpError(404,'Sepet satırı bulunamadı.');line.quantity=quantity(b.quantity);
 }else if(b.action==='remove'){cart.lines=cart.lines.filter(l=>l.id!==b.id);
 }else if(b.action==='customer'){cart.customer=cleanCustomer(b.customer);
 }else if(b.action==='refresh'){
  const products=await currentProducts(cart);for(const line of cart.lines){const p=products.get(line.id);line.price=p.catalogPrice;line.title=p.title;line.barcode=p.barcode;line.stock=p.stock;}
 }else throw new HttpError(400,'Sepet işlemi tanınmadı.');
 totalCheck(cart);
 const now=new Date().toISOString();
 await db().prepare("INSERT OR IGNORE INTO carts(actor,version,payload,updatedAt) VALUES(?,0,?,?)").bind(u.id,JSON.stringify({lines:[],customer:emptyCustomer}),now).run();
 const saved=await db().prepare('UPDATE carts SET payload=?,version=version+1,updatedAt=? WHERE actor=? AND version=?').bind(JSON.stringify({lines:cart.lines,customer:cart.customer}),now,u.id,cart.version).run();
 if(!saved.meta.changes)throw new HttpError(409,'Sepet başka bir pencerede değişti. Yenileyin.');
 return {...cart,version:cart.version+1};
}
function decodeOrder(row:any):Order{return {...row,...JSON.parse(row.payload),history:JSON.parse(row.history),payload:undefined};}
export async function readOrder(u:Member,id:string){
 if(!has(u,'orders.create')&&!has(u,'orders.view_all'))throw new HttpError(403,'Sipariş erişim yetkiniz yok.');
 const row=await db().prepare('SELECT * FROM orders WHERE id=?'+(has(u,'orders.view_all')?'':' AND actor=?')).bind(...(has(u,'orders.view_all')?[id]:[id,u.id])).first<any>();
 if(!row)throw new HttpError(404,'Sipariş bulunamadı.');return decodeOrder(row);
}
export async function prepareOrder(u:Member,b:any){
 requirePermission(u,'orders.create');
 if(typeof b.id!=='string'||! /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(b.id))throw new HttpError(400,'İşlem kimliği geçersiz.');
 const existing=await db().prepare('SELECT * FROM orders WHERE id=?').bind(b.id).first<any>();
 if(existing){if(existing.actor!==u.id)throw new HttpError(409,'İşlem kimliği kullanılmış.');return decodeOrder(existing);}
 const cart=await readCart(u);assertVersion(cart.version,b.version);cart.customer=cleanCustomer(b.customer);
 if(!cart.customer.name)throw new HttpError(400,'Müşteri adını girin.');
 if(cart.customer.tax==='unspecified')throw new HttpError(400,'Liste fiyatlarının KDV dahil veya hariç olduğunu seçin.');
 if(!cart.lines.length)throw new HttpError(400,'Sepete ürün ekleyin.');
 const products=await currentProducts(cart);for(const line of cart.lines){if(products.get(line.id).catalogPrice!==line.price)throw new HttpError(409,'Katalog fiyatı değişti. Sepette fiyatları güncelleyip müşteriye sunmadan önce kontrol edin.');}
 const total=totalCheck(cart),now=new Date().toISOString(),history=[{state:'prepared',actorName:u.name,at:now,note:'Sipariş listesi hazırlandı.'}];
 // The snapshot and cart reset commit together; a retry returns the same order.
 const results=await db().batch([
  db().prepare("INSERT INTO orders(id,actor,actorName,customerName,state,total,payload,history,createdAt,updatedAt) SELECT ?,?,?,?,'prepared',?,?,?,?,? FROM carts WHERE actor=? AND version=? AND NOT EXISTS(SELECT 1 FROM json_each(carts.payload,'$.lines') l LEFT JOIN products p ON p.id=json_extract(l.value,'$.id') WHERE p.id IS NULL OR p.visible<>1 OR p.status<>'active' OR p.catalogPrice IS NOT json_extract(l.value,'$.price'))").bind(b.id,u.id,u.name,cart.customer.name,total,JSON.stringify({lines:cart.lines,customer:cart.customer}),JSON.stringify(history),now,now,u.id,cart.version),
  db().prepare('UPDATE carts SET payload=?,version=version+1,updatedAt=? WHERE actor=? AND version=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND actor=?)').bind(JSON.stringify({lines:[],customer:emptyCustomer}),now,u.id,cart.version,b.id,u.id)
 ]);
 if(!results[0].meta.changes)throw new HttpError(409,'Sepet değişti. Yenileyip tekrar deneyin.');
 return readOrder(u,b.id);
}
export async function listOrders(u:Member,params:URLSearchParams){
 if(!has(u,'orders.create')&&!has(u,'orders.view_all'))throw new HttpError(403,'Sipariş erişim yetkiniz yok.');
 const page=Math.max(1,Math.floor(Number(params.get('page'))||1)),where=has(u,'orders.view_all')?'':' WHERE actor=?',args=has(u,'orders.view_all')?[]:[u.id];
 const rows=await db().prepare('SELECT id,actorName,customerName,state,total,createdAt,version FROM orders'+where+' ORDER BY createdAt DESC,id LIMIT 30 OFFSET ?').bind(...args,(page-1)*30).all();
 return {items:rows.results,page};
}
export async function transitionOrder(u:Member,b:any){
 const order=await readOrder(u,String(b.id));assertVersion(order.version,b.version);
 const next=b.state as OrderState;
 const allowed:Record<OrderState,OrderState[]>={prepared:['awaiting','cancelled'],awaiting:['approved','rejected','cancelled'],approved:['cancelled'],rejected:[],cancelled:[]};
 if(!allowed[order.state].includes(next))throw new HttpError(400,'Bu durum değişikliği yapılamaz.');
 const note=textField(b.note||'',1000);let customerContact='';
 if(next==='approved'||next==='rejected'){
  requirePermission(u,'orders.record_approval');
  customerContact=textField(b.customerContact||'',120);
  if(b.confirmed!==true||!customerContact||note.length<3)throw new HttpError(400,'Yanıt veren kişinin adını, yanıt bilgisini ve doğrulama kutusunu doldurun.');
 }
 if(next==='cancelled'&&note.length<3)throw new HttpError(400,'İptal nedenini yazın.');
 const now=new Date().toISOString();
 const history=[...order.history,{state:next,actorName:u.name,at:now,note,customerContact}];
 const result=await db().prepare('UPDATE orders SET state=?,history=?,version=version+1,updatedAt=? WHERE id=? AND version=?').bind(next,JSON.stringify(history),now,order.id,order.version).run();
 if(!result.meta.changes)throw new HttpError(409,'Sipariş başka bir pencerede değişti. Yenileyin.');
 return readOrder(u,order.id);
}
