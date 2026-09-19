import {ArrowUpRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {Product} from '@/lib/model';
import {productStorefrontUrl} from '@/lib/storefront';

export function StorefrontLink({product}:{product:Pick<Product,'handle'|'shopifyVariantId'|'status'>}){
 const href=productStorefrontUrl(product);
 if(!href)return <p className="storefront-note">Bu ürünün mağaza bağlantısı henüz bulunmuyor.</p>;
 return <div className="storefront-link">
  <Button asChild variant="outline" className="storefront-button">
   <a href={href} target="_blank" rel="noopener noreferrer" aria-label="Sitede gör — Alaçam Dağıtım (yeni sekme)">
    Sitede gör <ArrowUpRight aria-hidden="true"/>
   </a>
  </Button>
  <p className="storefront-note">Web sitesi fiyatı katalog fiyatından farklı olabilir.
   {['draft','archived'].includes(product.status)&&' Taslak veya arşivlenmiş ürün mağazada açılmayabilir.'}
  </p>
 </div>;
}
