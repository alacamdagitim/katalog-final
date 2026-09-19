import {money} from './model';
export type OrderLine={id:string;title:string;barcode:string;price:number;quantity:number;stock:number|null};
export type Customer={name:string;company:string;phone:string;note:string;tax:'unspecified'|'included'|'excluded'};
export type Cart={version:number;lines:OrderLine[];customer:Customer};
export type OrderState='prepared'|'awaiting'|'approved'|'rejected'|'cancelled';
export type OrderEvent={state:OrderState;actorName:string;at:string;note:string;customerContact?:string};
export type Order={id:string;actor:string;actorName:string;customerName:string;state:OrderState;total:number;version:number;createdAt:string;updatedAt:string;lines:OrderLine[];customer:Customer;history:OrderEvent[]};
export const emptyCustomer:Customer={name:'',company:'',phone:'',note:'',tax:'unspecified'};
export const orderStates:Record<OrderState,string>={prepared:'Liste hazır',awaiting:'Müşteri yanıtı bekleniyor',approved:'Onay kaydedildi',rejected:'Reddedildi',cancelled:'İptal edildi'};
export const taxLabels={unspecified:'Vergi durumu belirtilmedi',included:'Listelenen fiyatlara KDV dahildir.',excluded:'Listelenen fiyatlara KDV dahil değildir. KDV ayrıca hesaplanacaktır.'};
export const orderTotal=(lines:OrderLine[])=>lines.reduce((sum,l)=>sum+l.price*l.quantity,0);
export const orderNumber=(id:string)=>id.slice(0,13).toUpperCase();
export function orderText(order:Order){return [
 'ALAÇAM DAĞITIM · SİPARİŞ LİSTESİ',`Liste no: ${orderNumber(order.id)}`,`Müşteri: ${order.customer.name}${order.customer.company?' · '+order.customer.company:''}`,
 `Tarih: ${new Date(order.createdAt).toLocaleDateString('tr-TR',{timeZone:'Europe/Istanbul'})}`,`Durum: ${orderStates[order.state]}`,'',
 ...order.lines.map((l,i)=>`${i+1}. ${l.title}${l.barcode?' · Barkod: '+l.barcode:''}\n${l.quantity.toLocaleString('tr-TR')} adet × ${money(l.price)} = ${money(l.price*l.quantity)}`),'',
 `Liste toplamı: ${money(order.total)}`,taxLabels[order.customer.tax],order.customer.note?`Not: ${order.customer.note}`:'',
 ['prepared','awaiting'].includes(order.state)?'Lütfen liste numarasını belirterek onayınızı veya değişiklik talebinizi iletin.':'',
 'Bu liste fatura veya irsaliye değildir. Stok rezervasyonu ve ödeme işlemi yapılmamıştır.'
 ].filter(Boolean).join('\n');}
