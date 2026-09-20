import {redirect} from 'next/navigation';
import {identity} from '@/lib/auth';
import PriceManager from '../price-manager';
export const dynamic='force-dynamic';
export default async function Management(){if(!await identity())redirect('/giris');return <PriceManager/>}
