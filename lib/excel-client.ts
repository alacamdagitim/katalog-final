
export function excelWork(data: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    // Resolve against the browser origin, never an SSR-rewritten import.meta.url.
    const worker = new Worker(new URL('./excel.worker.ts', import.meta.url), {type: 'module'});
    const finish = () => { clearTimeout(timeout); worker.terminate(); };
    const timeout = setTimeout(() => { finish(); reject(new Error('Excel işlemi zaman aşımına uğradı. Daha küçük bir dosya deneyin.')); }, 120_000);
    worker.onmessage = e => { finish(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data); };
    worker.onerror = () => { finish(); reject(new Error('Excel işlenemedi. Dosya biçimini kontrol edin.')); };
    worker.onmessageerror = () => { finish(); reject(new Error('Excel sonucu okunamadı. Yeniden deneyin.')); };
    try { worker.postMessage(data); } catch (e) { finish(); reject(e); }
  });
}
