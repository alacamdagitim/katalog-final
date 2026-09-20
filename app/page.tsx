import CustomerCatalog from './customer-catalog';
import {publicCatalog,type CatalogPage} from '@/lib/live-catalog';
export const dynamic='force-dynamic';
export default async function Home(){
 let initial:CatalogPage,error='';
 try{initial=await publicCatalog(new URLSearchParams())}
 catch{initial={items:[],cursor:null,hasNextPage:false,vendors:[],types:[]};error='Katalog şu anda yüklenemedi.'}
 return <CustomerCatalog initial={initial} initialError={error}/>;
}
