import {publicCatalogFilters} from '@/lib/live-catalog';
import {ok, fail} from '@/lib/http';

export async function GET(request: Request) {
  try { return ok(await publicCatalogFilters(new URL(request.url).searchParams)); }
  catch (error) { return fail(error); }
}
