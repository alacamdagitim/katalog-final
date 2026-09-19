import {customerCatalog,customerQuote} from '@/lib/customer-catalog';
import {ok,fail,jsonBody,sameOrigin} from '@/lib/server';
export async function GET(req:Request){try{return ok(await customerCatalog(new URL(req.url).searchParams))}catch(e){return fail(e)}}
export async function POST(req:Request){try{sameOrigin(req);return ok(await customerQuote(await jsonBody(req)))}catch(e){return fail(e)}}
