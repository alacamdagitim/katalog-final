import {redirect} from 'next/navigation';
import {localAdminPreview} from '@/lib/auth';

export default async function LoginLayout({children}:{children:React.ReactNode}){
 if(await localAdminPreview())redirect('/yonetim');
 return children;
}
