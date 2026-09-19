'use client';
import {useEffect,useRef,useState} from 'react';
import {api} from '@/lib/client';
// Status reader only. Closing this component cannot interrupt a server job.
export function useShopifyTransfer(enabled:boolean,_notify:(s:string)=>void,onChange:()=>void){
 const [info,setInfo]=useState<any>(null),[error,setError]=useState('');
 const callback=useRef(onChange),last=useRef('');callback.current=onChange;
 useEffect(()=>{if(!enabled)return;let active=true;const controller=new AbortController();
 const read=async()=>{try{const r=await api('/api/shopify',undefined,'GET',controller.signal);if(!active)return;setInfo(r);setError(r.sync?.error||'');if(last.current&&last.current!==r.sync?.lastProductSync)callback.current();last.current=r.sync?.lastProductSync||'';}catch(e){if(active)setError((e as Error).message)}};
 void read();const timer=setInterval(read,15000);return()=>{active=false;controller.abort();clearInterval(timer)};
 },[enabled]);
 return {running:!!info?.sync?.pending,waiting:!!info?.sync?.error,progress:info?.sync?.products??null,error,info};
}
export type ShopifyTransfer=ReturnType<typeof useShopifyTransfer>;
