'use client';
export default function Logout(){return <main className="login"><h1>Oturumu kapat</h1><button className="login-button" onClick={async()=>{const r=await fetch('/api/auth/logout',{method:'POST'});if(r.ok)location.assign('/')}}>Çıkış yap</button><a href="/">Kataloğa dön</a></main>}
