import {identity} from '@/lib/auth';
import {liveCatalog} from '@/lib/live-catalog';
import {getVisibility} from '@/lib/catalog-visibility';
import {ok,fail,HttpError} from '@/lib/http';

export async function GET(request:Request){
 try{
  if(!await identity())throw new HttpError(401,'Yönetici girişi gerekli.');
  const page=await liveCatalog(new URL(request.url).searchParams);
  const visibility=await getVisibility(page.items.map(item=>item.id));
  return ok({...page,items:page.items.map(item=>({...item,catalogVisible:!!visibility[item.id]}))});
 }catch(error){return fail(error);}
}
