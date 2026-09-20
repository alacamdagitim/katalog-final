import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogFilters} from '../lib/catalog-filters';

const facet=(id:string,field:string,labels:string[])=>({id,values:labels.map(label=>({label,input:JSON.stringify({[field]:label})}))});

test('brand facets continue past Shopify’s 100 values without copying product records',async()=>{
 const original=globalThis.fetch;const queries:string[]=[];
 globalThis.fetch=async(_url,init)=>{
  const request=JSON.parse(String(init?.body));queries.push(request.query);
  if(request.query.includes('productTypes'))return Response.json({data:{productTypes:{nodes:['Çay','Şurup'],pageInfo:{hasNextPage:false}}}});
  const next=request.variables.query.includes('-vendor:');
  return Response.json({data:{search:{productFilters:[
   facet('filter.p.vendor','productVendor',next?['Son marka']:Array.from({length:100},(_,index)=>`Marka ${index}`)),
   facet('filter.p.product_type','productType',['Çay']),
   facet('filter.p.tag','tag',Array.from({length:100},(_,index)=>`Etiket ${index}`)),
  ]}}});
 };
 try{
  const result=await catalogFilters();
  assert.equal(result.vendors.length,101);assert.equal(result.limits.vendors,false);
  assert.deepEqual(result.types,['Çay','Şurup']);assert.equal(result.limits.types,false);
  assert.equal(result.limits.tags,true);
  assert.ok(queries.every(query=>!query.includes('variants')&&!query.includes('description')));
 }finally{globalThis.fetch=original;}
});

test('admin type selection narrows tags without hiding alternative brands and types',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
  const request=JSON.parse(String(init?.body)),query=String(request.variables.query);
  const selectedType=query.includes('product_type:'),selectedVendor=query.includes('vendor:');
  return Response.json({data:{search:{productFilters:[
   facet('filter.p.vendor','productVendor',selectedVendor?['Test Marka']:['Başka Marka','Test Marka']),
   facet('filter.p.product_type','productType',selectedType?['Siyah Çay']:['Bitki Çayı','Siyah Çay']),
   facet('filter.p.tag','tag',selectedType?['Bergamotlu']:['Bergamotlu','Nane']),
  ]}}});
 };
 try{
  const result=await catalogFilters(new URLSearchParams({q:'test-context',vendor:'Test Marka',type:'Siyah Çay'}));
  assert.deepEqual(result.vendors,['Başka Marka','Test Marka']);
  assert.deepEqual(result.types,['Bitki Çayı','Siyah Çay']);
  assert.deepEqual(result.tags,['Bergamotlu']);
 }finally{globalThis.fetch=original;}
});
