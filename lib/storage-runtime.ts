/** Netlify Functions exposes SITE_ID at runtime; NETLIFY is only guaranteed at
 * build time. Keep local next dev/start on files unless Netlify is identified.
 * Shared by every catalog store so prices and approvals cannot diverge.
 */
export function isNetlifyRuntime(environment:Record<string,string|undefined>=process.env):boolean{
 return environment.NETLIFY==='true'||Boolean(environment.SITE_ID?.trim()||environment.NETLIFY_SITE_ID?.trim());
}
