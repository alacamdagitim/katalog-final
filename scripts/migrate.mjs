import {createClient} from '@libsql/client';
import {readdir,readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL first');
await mkdir('.local',{recursive:true});
const db=createClient({url:process.env.DATABASE_URL,authToken:process.env.DATABASE_AUTH_TOKEN});
await db.execute('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL)');
for(const name of (await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort()){
 const sql=await readFile('drizzle/'+name,'utf8'),hash=createHash('sha256').update(sql).digest('hex');
 const old=await db.execute({sql:'SELECT hash FROM schema_migrations WHERE name=?',args:[name]});
 if(old.rows.length){if(old.rows[0].hash!==hash)throw new Error('Applied migration changed: '+name);continue;}
 await db.batch([...sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean),{sql:'INSERT INTO schema_migrations VALUES(?,?)',args:[name,hash]}],'write');
 console.log('Applied',name);
}
db.close();
