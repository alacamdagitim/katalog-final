type AdminCredentials={email:string;passwordHash:string};
type AdminEnvironment=Record<string,string|undefined>;

export function resolveAdminCredentials(environment:AdminEnvironment,builtIn:AdminCredentials):AdminCredentials|null{
 // Partial or explicitly empty overrides must never reactivate the built-in account.
 const overridden=environment.ADMIN_EMAIL!==undefined||environment.ADMIN_PASSWORD_HASH!==undefined;
 const email=(overridden?environment.ADMIN_EMAIL:builtIn.email)?.trim().toLowerCase()||'';
 const passwordHash=(overridden?environment.ADMIN_PASSWORD_HASH:builtIn.passwordHash)?.trim()||'';
 if(!email||!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(passwordHash))return null;
 return {email,passwordHash};
}
