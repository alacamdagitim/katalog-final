import {currentMember,listProducts,ok,fail,jsonBody,sameOrigin,applyChanges} from '@/lib/server';
export async function GET(req:Request){try{return ok(await listProducts(await currentMember(),new URL(req.url).searchParams))}catch(e){return fail(e)}}
export async function PATCH(req:Request){try{sameOrigin(req);const u=await currentMember();const body=await jsonBody(req);return ok(await applyChanges(u,body.changes,crypto.randomUUID()))}catch(e){return fail(e)}}
