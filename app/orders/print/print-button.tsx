'use client';
import {Button} from '@/components/ui/button';
export default function PrintButton(){return <Button className="no-print" onClick={()=>window.print()}>Yazdır / PDF olarak kaydet</Button>}
