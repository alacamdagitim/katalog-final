import {revokeSession} from '@/lib/auth';
import {sameOrigin,ok,fail} from '@/lib/http';
export async function POST(req:Request){try{sameOrigin(req);await revokeSession();return ok({signedOut:true})}catch(e){return fail(e)}}
