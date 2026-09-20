import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAdminCredentials} from '../lib/admin-login-config';

const hash=`scrypt$${'a'.repeat(32)}$${'b'.repeat(128)}`;
const builtIn={email:'owner@example.test',passwordHash:hash};

test('built-in account is used only when both environment overrides are absent',()=>{
 assert.deepEqual(resolveAdminCredentials({},builtIn),builtIn);
});

test('complete environment override replaces the entire built-in account',()=>{
 const alternateHash=`scrypt$${'c'.repeat(32)}$${'d'.repeat(128)}`;
 assert.deepEqual(resolveAdminCredentials({ADMIN_EMAIL:' NEW@EXAMPLE.TEST ',ADMIN_PASSWORD_HASH:alternateHash},builtIn),{email:'new@example.test',passwordHash:alternateHash});
});

test('partial, empty and malformed overrides fail closed instead of falling back',()=>{
 for(const environment of [
  {ADMIN_EMAIL:'new@example.test'},
  {ADMIN_PASSWORD_HASH:hash},
  {ADMIN_EMAIL:'',ADMIN_PASSWORD_HASH:''},
  {ADMIN_EMAIL:' '},
  {ADMIN_EMAIL:'new@example.test',ADMIN_PASSWORD_HASH:'not-a-password-hash'},
 ])assert.equal(resolveAdminCredentials(environment,builtIn),null);
});
