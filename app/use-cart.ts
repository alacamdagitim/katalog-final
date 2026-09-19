'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from '@/lib/client';
import {Cart,Customer,Order,emptyCustomer} from '@/lib/orders-model';
export function useCart(enabled:boolean,notify:(s:string)=>void){
 const [cart,setCart]=useState<Cart>({version:0,lines:[],customer:{...emptyCustomer}}),[loading,setLoading]=useState(enabled),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),submitId=useRef<{version:number;id:string}|null>(null);
 const reload=useCallback(async()=>{if(!enabled)return;setLoading(true);try{setCart(await api('/api/cart'));setError('')}catch(e){setError((e as Error).message)}finally{setLoading(false)}},[enabled]);
 useEffect(()=>{void reload()},[reload]);
 const mutate=async(body:Record<string,unknown>)=>{
  if(lock.current||loading||!enabled)return;lock.current=true;setBusy(true);setError('');
  try{const next=await api('/api/cart',{...body,version:cart.version});setCart(next);return next as Cart}
  catch(e){setError((e as Error).message);notify((e as Error).message);if((e as any).status===409)await reload()}
  finally{lock.current=false;setBusy(false)}
 };
 const prepare=async(customer:Customer):Promise<Order|undefined>=>{
  if(lock.current||loading||!enabled)return;lock.current=true;setBusy(true);setError('');
  if(submitId.current?.version!==cart.version)submitId.current={version:cart.version,id:crypto.randomUUID()};
  try{const r=await api('/api/cart',{action:'prepare',id:submitId.current.id,version:cart.version,customer});await reload();return r.order}
  catch(e){setError((e as Error).message);notify((e as Error).message)}finally{lock.current=false;setBusy(false)}
 };
 return {cart,loading,busy,error,reload,mutate,prepare,add:async(id:string)=>{const next=await mutate({action:'add',id,quantity:1});if(next)notify('Ürün sepete eklendi.')}};
}
export type CartController=ReturnType<typeof useCart>;
