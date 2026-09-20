'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';

export default function Logout(){
 const router=useRouter();
 const logout=async()=>{
  const response=await fetch('/api/auth/logout',{method:'POST'});
  if(response.ok)router.replace('/');
 };
 return <main className="login"><h1>Oturumu kapat</h1><button className="login-button" onClick={logout}>Çıkış yap</button><Link href="/">Kataloğa dön</Link></main>;
}
