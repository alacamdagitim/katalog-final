import {getChatGPTUser,chatGPTSignInPath} from '../chatgpt-auth';
import Workspace from '../workspace';
import {currentMember,listProducts,HttpError} from '@/lib/server';
export const dynamic='force-dynamic';
export default async function Management(){
 const identity=await getChatGPTUser();
 if(!identity)return <main className="login"><div className="brand-icon">k.</div><h1>Çalışan girişi</h1><p>Ürün, fiyat ve sipariş yönetimi yalnızca yetkili ekibimize açıktır.</p><a className="login-button" href={chatGPTSignInPath('/yonetim')} target="_top">E-posta ve parola ile giriş</a><a href="/">Müşteri kataloğuna dön</a></main>;
 try{const user=await currentMember();const initial=await listProducts(user,new URLSearchParams());return <Workspace initial={initial} user={user}/>;}
 catch(e){return <main className="login"><h1>Yönetim alanına erişilemiyor</h1><p>{e instanceof HttpError?e.message:'Bağlantı geçici olarak kullanılamıyor.'}</p><a className="login-button" href="/">Müşteri kataloğuna dön</a><a href="/cikis" target="_top">Başka hesapla giriş yap</a></main>;}
}
