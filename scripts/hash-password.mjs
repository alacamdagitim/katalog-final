import {hashPassword} from '../lib/password.mjs';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
process.stdout.write('En az 12 karakterlik yönetici parolası (gizli): ');
const rl=createInterface({input:process.stdin,output:new Writable({write(_chunk,_encoding,callback){callback()}}),terminal:true});
const password=await rl.question('');rl.close();process.stdout.write('\n');
console.log(await hashPassword(password));
