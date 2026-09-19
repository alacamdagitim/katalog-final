import {currentMember,ok,fail,sameOrigin,jsonBody} from '@/lib/server';
import {readCart,changeCart,prepareOrder} from '@/lib/orders';
export async function GET(){try{return ok(await readCart(await currentMember()))}catch(e){return fail(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await currentMember(),b=await jsonBody(req);return ok(b.action==='prepare'?{order:await prepareOrder(u,b)}:await changeCart(u,b))}catch(e){return fail(e)}}
