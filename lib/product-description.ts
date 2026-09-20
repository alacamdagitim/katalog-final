// Produce plain text, never executable HTML. Block boundaries keep Shopify's
// headings and feature lists readable without accepting embedded markup.
export function productDescription(html?:string, fallback=''):string {
 if(!html)return fallback;
 const entities:Record<string,string>={nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',ndash:'–',mdash:'—',bull:'•',hellip:'…'};
 return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
  .replace(/<\s*li\b[^>]*>/gi,'\n• ')
  .replace(/<\s*br\s*\/?\s*>/gi,'\n')
  .replace(/<\/(?:p|div|h[1-6]|ul|ol|section|tr)\s*>/gi,'\n\n')
  .replace(/<\/(?:li|td|th)\s*>/gi,'\n')
  .replace(/<[^>]*>/g,'')
  .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(original,entity:string)=>{
   if(entity[0]!=='#')return entities[entity.toLowerCase()]??original;
   const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
   return code>0&&code<=0x10ffff&&(code<0xd800||code>0xdfff)?String.fromCodePoint(code):'';
  }).replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/(^|\n)•\s+(?=\S)/g,'$1• ').replace(/\n{3,}/g,'\n\n').trim();
}
