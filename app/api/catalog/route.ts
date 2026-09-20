import {publicCatalog,liveQuote} from '@/lib/live-catalog';
import {ok,fail,jsonBody,sameOrigin} from '@/lib/http';
export async function GET(req:Request){try{return ok(await publicCatalog(new URL(req.url).searchParams))}catch(e){return fail(e)}}
export async function POST(req:Request){try{sameOrigin(req);return ok(await liveQuote(await jsonBody(req)))}catch(e){return fail(e)}}
