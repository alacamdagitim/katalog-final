import {identity} from '@/lib/auth';
import {fail, HttpError, ok} from '@/lib/http';
import {storageReadiness} from '@/lib/storage-runtime';
import {getPrices} from '@/lib/prices';
import {getVisibility} from '@/lib/catalog-visibility';

export async function GET() {
  try {
    if (!await identity()) throw new HttpError(401, 'Yönetici girişi gerekli.');
    const storage = storageReadiness();
    if (!storage.configured) return ok({...storage, reachable: false});
    try {
      // Read-only check: never create a price or publish a product for a probe.
      // A non-existent sentinel key also performs an actual read on Netlify,
      // where an empty ID list would otherwise short-circuit the probe.
      const probeIds = ['gid://shopify/ProductVariant/0'];
      await Promise.all([getPrices(probeIds), getVisibility(probeIds)]);
      return ok({...storage, reachable: true});
    } catch (error) {
      return ok({...storage, reachable: false, reason: error instanceof HttpError
        ? error.message : 'Katalog deposuna ulaşılamıyor. Fiyat ve yayın ayarları şu anda kaydedilemiyor.'});
    }
  } catch (error) { return fail(error); }
}
