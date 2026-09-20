import 'server-only';
import {resolveAdminCredentials} from './admin-login-config';

// Owner-requested built-in account. Never store a plaintext password or session
// signing key here. A public verifier permits offline password guessing; prefer
// overriding BOTH account values through the hosting provider's private settings.
const builtInAccount = {
 email: 'feridun@alacam.co',
 passwordHash: 'scrypt$cbc9a8728b89e118e81c4cb6c1e99ee2$13fc71c935f58e6804c37bde47e788ca0a669bf8dcc56b5e63e83908308454da78c31ecea16b747f1f00df87424bbb0f01a4a30f90fb08c1cbe69349b73b0f64',
};

export function adminCredentials(){
 return resolveAdminCredentials(process.env,builtInAccount);
}
