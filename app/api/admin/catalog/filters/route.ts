import {identity} from '@/lib/auth';
import {catalogFilters} from '@/lib/catalog-filters';
import {ok,fail,HttpError} from '@/lib/http';

export async function GET(request:Request){
 try{
  if(!await identity())throw new HttpError(401,'Yönetici girişi gerekli.');
  return ok(await catalogFilters(new URL(request.url).searchParams));
 }catch(error){return fail(error);}
}
