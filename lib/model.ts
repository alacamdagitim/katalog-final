export const money=(n:number|null)=>n===null?'Fiyat girilmedi':new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(n/100);
