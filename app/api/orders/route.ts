import {currentMember,ok,fail,sameOrigin,jsonBody} from '@/lib/server';
import {readOrder,listOrders,transitionOrder} from '@/lib/orders';
export async function GET(req:Request){try{const u=await currentMember(),p=new URL(req.url).searchParams;return ok(p.get('id')?await readOrder(u,p.get('id')!):await listOrders(u,p))}catch(e){return fail(e)}}
export async function POST(req:Request){try{sameOrigin(req);return ok(await transitionOrder(await currentMember(),await jsonBody(req)))}catch(e){return fail(e)}}
