'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useState} from 'react';

export default function Login(){
 const router=useRouter(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const submit=async(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault();setBusy(true);setError('');const form=new FormData(event.currentTarget);
  try{
   const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.get('email'),password:form.get('password')})});
   const result=await response.json() as {error?:string};
   if(!response.ok)throw new Error(result.error||'Giriş yapılamadı.');
   router.replace('/yonetim');
  }catch(reason){setError((reason as Error).message)}finally{setBusy(false)}
 };
 return <main className="login"><img className="login-logo" src="https://alacamdagitim.com/cdn/shop/files/LOGO_DENEME_SON_865056f4-5f9d-4701-a37e-f1d9be001d1a.webp?v=1774724316&width=400" alt="Alaçam Dağıtım"/><h1>Yönetici girişi</h1><form className="form-grid" onSubmit={submit}><label>E-posta<input className="field" name="email" type="email" autoComplete="username" required/></label><label>Parola<input className="field" name="password" type="password" autoComplete="current-password" required minLength={12} maxLength={256}/></label>{error&&<p role="alert">{error}</p>}<button className="login-button" disabled={busy}>{busy?'Kontrol ediliyor…':'Giriş yap'}</button></form><p>Katalog görünürlüğünü ve özel fiyatları yönetin.</p><Link href="/">Müşteri kataloğuna dön</Link></main>;
}
