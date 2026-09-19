import CustomerCatalog from './customer-catalog';
import {customerCatalog} from '@/lib/customer-catalog';
import {currentMember,HttpError,has} from '@/lib/server';
import {getChatGPTUser,chatGPTSignInPath} from './chatgpt-auth';
export const dynamic='force-dynamic';
export default async function Home(){
 const identity=await getChatGPTUser();let employee=false,canSync=false;
 if(identity){try{const member=await currentMember();employee=true;canSync=has(member,'shopify.sync');}catch(e){if(!(e instanceof HttpError)||e.status!==403)throw e;}}
 const initial=await customerCatalog(new URLSearchParams());
 return <CustomerCatalog initial={initial} employee={employee} canSync={canSync} signedIn={!!identity} signInPath={chatGPTSignInPath('/yonetim')}/>;
}
