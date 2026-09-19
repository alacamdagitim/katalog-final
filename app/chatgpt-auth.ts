// Compatibility names for existing UI imports; identity is now our own cookie session.
export {identity as getChatGPTUser} from '@/lib/auth';
export function chatGPTSignInPath(_returnTo:string){return '/giris'}
export function chatGPTSignOutPath(_returnTo='/'){return '/cikis'}
