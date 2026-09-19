import {createClient, type Client, type InStatement, type ResultSet} from '@libsql/client';
let client: Client | undefined;
export function databaseClient() {
 const url=process.env.DATABASE_URL;
 if(!url)throw new Error('DATABASE_URL is required');
 if(process.env.NODE_ENV==='production' && url.startsWith('file:'))throw new Error('Production requires a persistent remote database, not a serverless filesystem');
 return client??=createClient({url,authToken:process.env.DATABASE_AUTH_TOKEN});
}
const result=<T>(r:ResultSet)=>({results:r.rows as unknown as T[],meta:{changes:r.rowsAffected},success:true});
export class Statement {
 constructor(readonly sql:string,readonly args:any[]=[]){}
 bind(...args:any[]){return new Statement(this.sql,args)}
 get query():InStatement{return {sql:this.sql,args:this.args}}
 async all<T=Record<string,unknown>>(){return result<T>(await databaseClient().execute(this.query))}
 async first<T=Record<string,unknown>>():Promise<T|null>{return (await this.all<T>()).results[0]??null}
 async run(){return this.all()}
}
export const database={prepare:(sql:string)=>new Statement(sql),async batch<T=Record<string,unknown>>(statements:Statement[]){
 // One atomic transaction preserves existing optimistic concurrency and audit semantics.
 return (await databaseClient().batch(statements.map(s=>s.query),'write')).map(r=>result<T>(r));
}};
