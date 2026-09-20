/** Parse API responses without showing HTML error pages or JSON parser errors. */
export async function readApiResponse<T>(response: Response, allowErrorPayload = false): Promise<T> {
  let data: unknown;
  try { data = await response.json(); }
  catch {
    throw new Error(response.status === 401
      ? 'Oturumunuz sona erdi. Yeniden giriş yapın; değişiklikler henüz kaydedilmedi.'
      : 'Sunucuya ulaşılamadı. Kaydın tamamlandığı doğrulanmadı; bağlantınızı kontrol edip yeniden deneyin.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Sunucudan geçerli yanıt alınamadı. Lütfen yeniden deneyin.');
  }
  if (!response.ok && !allowErrorPayload) {
    const message = (data as {error?: unknown}).error;
    throw new Error(typeof message === 'string' ? message : response.status === 401
      ? 'Oturumunuz sona erdi. Lütfen yeniden giriş yapın.' : 'İşlem kaydedilemedi. Lütfen yeniden deneyin.');
  }
  return data as T;
}
