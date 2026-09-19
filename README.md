# Alaçam Katalog — bağımsız web uygulaması

Yayın hedefi **Netlify**. Next.js uygulaması, kalıcı libSQL veritabanı ve Shopify bildirimleriyle çalışan görev kuyruğu. ChatGPT oturumuna veya açık tarayıcı sekmesine ihtiyaç duymaz.

## Mevcut durum

- Bu klasör bağımsız geliştirme kopyasıdır. Eski canlı katalog değiştirilmedi; canlı veriler, kullanıcılar ve gizli anahtarlar buraya taşınmadı.
- Henüz GitHub'a gönderilmedi veya Netlify'a yayınlanmadı. Ücretli hizmet açılmadı.
- Yerel testlerde Shopify yanıtları taklit edilir. Gerçek Shopify, uzak veritabanı ve Netlify üzerinde uçtan uca kabul testi yayın öncesinde gereklidir.

## İş kuralları

- Müşteri kataloğu girişsizdir. Yalnızca kataloğa seçilmiş, uygun durumdaki ürünler yayımlanır; yönetim ve sipariş kayıtları oturum ve yetki kontrolü gerektirir.
- Firma sahibi dahil herkes ürünler üzerinde yalnızca **katalog fiyatını** ve **katalogda görünürlüğü** değiştirebilir. Diğer ürün alanlarının kaynağı Shopify'dır. Excel yüklemelerinde de aynı kurallar uygulanır.
- Shopify ürünlerine veya fiyatlarına yazılmaz. Bağlantı, ürün/stok okuma ve uygulamanın değişiklik bildirim aboneliklerini oluşturmak içindir.
- Yeni ürünler gizli ve fiyatsız gelir. Eşitleme yerel fiyat ve görünürlük tercihlerini korur. Kaynaktan silinen ürün yerelde arşivlenir; eski sipariş kayıtları silinmez.
- Kaynak alanlar: ürün/varyasyon adı, marka, tür, etiket, açıklama, barkod, SKU, stok, durum ve ana/varyasyon görseli. Tüm görsel galerisi ve tüm özel Shopify alanları bu sürümün kapsamı değildir.
- Müşteri sepeti geçicidir; WhatsApp listesini müşteri kendisi gönderir. Bu işlem ödeme veya resmi irsaliye oluşturmaz. Çalışan sipariş akışı ayrı tutulur.

## Yerel kurulum

Node.js 22.13 veya üzeri gerekir.

1. `npm ci`
2. `.env.example` dosyasını `.env.local` adıyla kopyalayın ve değerleri doldurun. Gerçek anahtarları Git'e eklemeyin.
3. `npm run db:migrate`
4. `npm run user:create` — ilk firma sahibi hesabını interaktif oluşturur. Parola komut satırı argümanı değildir.
5. `npm run dev`

Yerelde dosya tabanlı veritabanı kullanılabilir. Yayında **kullanılamaz**: sunucusuz dosya sistemi kalıcı değildir. Uygulama üretimde `file:` veritabanını reddeder.

Testler: `npm test`. Üretim derlemesi: `npm run build`.

## Netlify'a yayınlama

1. Kaynak kodunu size ait tercihen özel GitHub deposuna aktarın. `.env.local`, `.local`, `.next` ve `node_modules` dahil edilmemeli.
2. Kalıcı, SQLite FTS5 destekli libSQL veritabanını seçin. Bu, barındırmadan ayrı bir gereksinimdir; servis açma ve maliyet kararı henüz verilmedi. Netlify'ın Postgres veritabanı bu adaptörle doğrudan uyumlu değildir.
3. Netlify'da depoyu bağlayın; proje alt klasördeyse bu klasörü Base directory seçin. Derleme ve zamanlama ayarları `netlify.toml` içindedir.
4. Netlify üretim ortamına `.env.example` alanlarını girin. `APP_URL` gerçek HTTPS alan adı olmalı. `DATABASE_URL` uzak libSQL adresi, `DATABASE_AUTH_TOKEN` veritabanı erişim anahtarıdır. `SHOPIFY_TOKEN_KEY` rastgele 32 baytın base64 karşılığı, `CRON_SECRET` ondan farklı en az 32 karakterlik rastgele sır olmalı. Anahtarları tarayıcıya açan `NEXT_PUBLIC_` öneki kullanmayın.
5. Önce `SYNC_ENABLED=false` ile yayınlayın. Ayrı önizlemelere üretim veritabanı veya anahtarlarını vermeyin.
6. Güvenilir yerel ortamdan üretim veritabanına `db:migrate` ve `user:create` çalıştırın. Migrasyonlar derleme sırasında otomatik çalıştırılmaz.
7. Giriş, yetkisiz erişim engeli ve veritabanı bağlantısı doğrulandıktan sonra üretimde `SYNC_ENABLED=true` yapıp yeniden yayınlayın.
8. Shopify uygulamasında `read_products` ve `read_inventory` izinlerini sağlayın. Yönetim panelindeki Shopify bağlantısına istemci kimliği/gizli anahtarı güvenli alandan girin. Bağlantı doğrulanınca ilk tarama ve bildirim abonelikleri otomatik kuyruğa alınır.
9. Netlify Functions ekranında `catalog-sync` görevinin Scheduled olarak göründüğünü, sonraki çalışmasını ve günlüklerini doğrulayın. İlk çalışmayı Run now ile sınayın. Önizleme dağıtımlarında zamanlama otomatik çalışmaz.

`SHOPIFY_TOKEN_KEY` değişirse kaydedilmiş Shopify kimlik bilgileri çözülemez; plansız değiştirmeyin. Veritabanı yedeklerini ve anahtarı güvenli, ayrı yerlerde saklayın.

## Eşitleme nasıl çalışır?

- Shopify'ın imzalı bildirimi doğrulanır ve kalıcı kuyruğa kaydedilir. Ardından kısa işleme denemesi yapılır.
- Netlify zamanlanmış görevi her dakika kuyruğu çalıştırır; başarısız işler yeniden denenir. Sekmenin açık olması gerekmez.
- Değişen ürün kontrolü ilk tam taramadan bağımsızdır. Yeni değişikliklere ilk aktarım kuyruğundan yüksek öncelik verilir.
- İlk tarama, varyasyon sayısına ve Shopify hız sınırına göre zaman alır. Dakikalık tetikleme, tüm ürünlerin bir dakikada geleceği garantisi değildir.
- Günlük tam tarama kaçırılmış/silinmiş ürünleri yeniden kontrol eder. Tekrarlanan veya sırası değişmiş bildirimlerde Shopify'daki güncel kaynak tekrar okunur.
- Fiyat ve görünürlük korunur. Ürün ve varyasyon sayıları ayrı gösterilir.

## Yayın öncesi kabul listesi

- [ ] Mevcut canlı katalogdan fiyat/görünürlük, ekip ve sipariş verileri için ayrı yedekleme ve taşıma planı onaylandı. Yeni veritabanı boş başlayacaktır; otomatik eski veri taşıması yapılmaz.
- [ ] Yetkisiz kullanıcı yönetim API'lerine erişemiyor; sadece menü gizleme kullanılmıyor.
- [ ] Sahip dahil kullanıcılar ürün adını/açıklamasını değiştiremiyor; Excel de bu sınırı koruyor.
- [ ] Shopify'da oluşturulan test ürünü tarayıcı kapalıyken yönetimde gizli/fiyatsız görünüyor.
- [ ] Açıklama, görsel ve stok güncelleniyor; katalog fiyatı korunuyor.
- [ ] Silinen ürün arşivleniyor; tekrar bildirim ürün çoğaltmıyor.
- [ ] Tüm varyasyon sayfaları geliyor; ürün ve varyasyon sayıları ayrı karşılaştırılıyor.
- [ ] Kesinti sonrası görev devam ediyor; scheduler durursa panelde eski çalışma zamanı fark ediliyor.
- [ ] Excel indir/düzenle/yükle ve çalışan sipariş/WhatsApp/yazdır akışları gerçek tarayıcıda doğrulandı.
- [ ] Mobil görünüm, düşük hızlı bağlantı, kota takibi ve yedek geri yükleme denendi.

## Plan ve maliyet sınırları

Netlify zamanlanmış görevleri tüm planlarda destekler; görev başına süre sınırı 30 saniyedir. Bu projede zamanlanmış işleyici kısa bir sunucu görevini çağırır; uzun aktarım parçalar halinde ilerler. Ücretsiz plan sınırsız değildir. Yayın, trafik, işlem ve veritabanı tüketimi ölçülmeden sürekli ücretsiz çalışma vaat edilmez. Ücretli plan veya otomatik ek bakiye ayrıca onaylanmalıdır.

- [Netlify zamanlanmış görevler](https://docs.netlify.com/build/functions/scheduled-functions/)
- [Netlify güncel fiyatlandırma](https://www.netlify.com/pricing/)

Vercel dosyaları yalnızca ileride taşınabilirlik için örnektir; seçilen hedef Netlify'dır.
