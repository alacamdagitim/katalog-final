# Alaçam Dağıtım Dijital Katalog

Vercel veya Netlify'da çalışan, Shopify'ı canlı ürün kaynağı olarak kullanan mobil öncelikli toptan katalog.

## Mimari

- Ürün adı, marka, tür, açıklama, görsel, barkod ve satışa açıklık Shopify Storefront API'den istek anında okunur.
- Ürünler ayrı bir veritabanına kopyalanmaz; ilk aktarım, kuyruk, zamanlanmış görev ve senkron düğmesi yoktur.
- Yalnızca Shopify varyasyon kimliğine bağlı özel katalog fiyatı ve katalogda gösterme onayı saklanır: Vercel'de Private Blob, Netlify'da Netlify Blobs kullanılır. Shopify ürünleri depoya kopyalanmaz.
- Müşteri kataloğu girişsizdir. Fiyat yönetimi imzalı, HTTP-only oturumla korunur.
- Sepet tarayıcıda geçicidir. Paylaşım öncesinde fiyatlar sunucudan yeniden okunur ve WhatsApp talep metni hazırlanır.
- Uygulama Shopify'a yazmaz; ürün bilgilerini ve Shopify fiyatlarını değiştirmez.
- Ürünler varsayılan olarak katalogda gizlidir. Fiyat girmek otomatik yayınlama değildir; yönetimde ayrıca kataloğa eklemek gerekir. Müşteri sorguları ve sepet paylaşımı sunucuda bu onayla sınırlandırılır.

Shopify'da ilgili satış kanalına yayınlanmayan taslak veya arşivli ürünler Storefront API tarafından gösterilmez. Shopify'daki yayınlanmış bir değişiklik kataloğun sonraki sorgusunda güncel haliyle gelir.

## Katalog kullanımı

- Marka listesi arama yapılmadan açılabilir; tür ve etiket seçenekleri aramaya ve markaya göre daralır. Hafif filtre etiketleri en fazla bir dakika önbelleğe alınır.
- Masaüstünde sol filtre sütunu, mobilde marka seçici ve açılır filtre paneli bulunur.
- Stok filtresi Shopify'ın satışa açıklık bilgisini kullanır; bu fiziksel depo adedi değildir.
- Fiyat aralığı Shopify fiyatına değil, burada belirlenmiş özel katalog fiyatına uygulanır. Fiyatsız ürünler bu aralığa dahil edilmez.
- Ürün detayında marka, tür, barkod ve açıklama ayrıdır. Adet seçilerek talep sepetine eklenir; bu işlem ödeme veya kesin sipariş oluşturmaz.
- Shopify'ın etiket seçenek sınırına ulaşıldığında aramayı daraltma uyarısı gösterilir. Çok seyrek fiyat/stok eşleşmelerinde boş bir sayfadan sonra taranacak sayfa kalabilir.

## Excel fiyatları

- Yönetimdeki Excel şablonu varyasyon kimliği, ürün adı, metin biçiminde barkod, mevcut ve yeni TL fiyatını içerir.
- Yalnızca “Yeni fiyat (TL)” değiştirilir. Boş fiyat atlanır, sıfır geçerlidir; ürün bilgileri yazılmaz.
- En fazla 5.000 satır ve 5 MB dosya kabul edilir. Açılmış içerik 32 MB ile sınırlandırılır; formüller, tekrar eden kimlikler ve bozuk arşivler reddedilir.
- Dosya önce önizlenir; açık onaydan sonra 100'er satırlık gruplarla uygulanır. Başarılı kayıtlar korunur, kalanlar yeniden denenebilir. İşlem sırasında yönetim sayfası açık kalmalıdır.
- Tekil fiyat düzenlemesinde boş bırakıp kaydetmek fiyatı kaldırır; bu davranış Excel'deki “boşu atla”dan farklıdır.

Fiyat aralığı aramaları için Netlify'da yalnızca fiyatların sürüm kontrollü bir önbelleği tutulur. Asıl varyasyon fiyatları korunur; ilk okumadan sonra yalnız değişen fiyatlar yeniden okunur. Bu bir ürün veritabanı değildir.

Vercel'de fiyatlar ve yayın onayları ayrı iki özel JSON belgesidir. Bir fiyat grubu tek belge yazımıyla kaydedilir; her ürün için ayrı Blob yüklemesi yapılmaz. ETag koşullu yazımı eşzamanlı işlemlerin birbirinin ilgisiz kayıtlarını silmesini önler. Çakışma ve geçici istek sınırı durumunda sınırlı yeniden deneme yapılır; çözülmezse işlem açık hata verir. Belge başına uygulama sınırı 8 MiB ve 100.000 kayıttır. Güncel onayları görebilmek için okumalar Blob CDN önbelleğini atlar; bu okumalar kullanım kotasına dahildir.

## Toplu yönetim

- Marka, ürün türü ve etiketle yönetim listesini daraltın. Seçim birimi satırdaki Shopify varyasyonudur.
- “Bu sayfayı seç” yalnız görünen sayfayı; “Tüm eşleşenleri seç” filtreye uyan tüm sayfaları tarar. Seçim 5.000 satırla sınırlıdır; filtre değişince temizlenir.
- Seçili fiyatlara yüzde artış/indirim, sabit tutar ekleme/çıkarma veya aynı fiyatı verme uygulanabilir. Önce eski–yeni fiyatları kontrol edin; açık onay olmadan kaydedilmez.
- Fiyatı olmayanlar yüzde veya tutar işlemlerinde atlanır. Aynı fiyatı verme işlemiyle fiyatlandırılabilir. Negatif sonuçlar reddedilir.
- Katalogda gösterme/gizleme tek satıra veya seçili gruba uygulanır; önce değişecek kayıt sayısı ve liste gösterilir. Fiyatları değiştirmez.
- Excel ve toplu işlemler kaydedilirken diğer yönetim değişiklikleri kilitlenir. Sayfayı işlem bitene kadar açık tutun; başarılı gruplar korunur ve kalanlar yeniden denenebilir.
- Yalnız Shopify’da yayınlı ürünler kapsam dahilindedir. Taslak ve arşivlenmiş ürünler bu Storefront bağlantısında okunmaz; Shopify Admin bağlantısı veya yazma izni kullanılmaz.

## Yerel çalıştırma

Node.js 22.13 veya üzeri gerekir.

1. `npm ci`
2. `.env.example` dosyasını `.env.local` olarak kopyalayıp değerleri doldurun.
3. `npm run dev`
4. `http://localhost:3000` adresini açın.

Yerel geliştirmede özel fiyatlar `.local/prices.json`, katalog onayları `.local/visibility.json` dosyasına yazılır. Bu dosyalar Git'e girmez. Netlify'da aynı kod otomatik olarak Netlify Blobs kullanır. Vercel ortamı tespit edildiğinde yalnız Private Blob kullanılır; bağlantı eksik veya bozuksa yerel dosyaya geri dönüş yapılmaz.

GitHub'a kod göndermek yerel fiyatları, katalog seçimlerini veya gizli ayarları canlıya taşımaz. Bunlar ortamlar arasında ayrıdır. Canlı katalogda fiyat ve yayın seçimi yönetici girişiyle yapılır; Excel fiyat aktarımı da kullanılabilir.

## Yönetici parolası

`npm run password:hash` komutu parolayı ekranda göstermeden sorar ve yalnızca hash değerini üretir. Düz parolayı Git'e veya hosting ortam değişkenlerine koymayın.

Firma sahibinin isteğiyle `lib/admin-account.server.ts` dosyasında yalnız sunucuda kullanılan bir varsayılan hesap ve salt içeren scrypt parola özeti tanımlıdır; düz parola bulunmaz. Her iki yönetici ortam değişkeni de hiç tanımlı değilse bu hesap kullanılır. Değişkenlerden biri tanımlanmışsa ikisinin de geçerli olması gerekir; eksik veya boş ayarlar varsayılan hesaba geri dönmez. Örnek ortam dosyasındaki boş yönetici alanları da girişi kapatır: ya ikisini doldurun ya da varsayılan hesabı kullanmak için ikisini kaldırın.

Açık depodaki parola özeti çevrimdışı parola tahminlerine açık olduğundan canlı kullanımda güçlü bir parola ve özel ortam ayarları tercih edilmelidir. `SESSION_SECRET` hiçbir zaman koda eklenmez ve hash'ten türetilmez: en az 32 karakterlik bağımsız rastgele değer sunucu ortamında tanımlanmadan giriş çalışmaz. Hesabı değiştirdiğinizde mevcut oturumları da iptal etmek için bu anahtarı yenileyin.

## Sunucu ortam değişkenleri

- `SHOPIFY_SHOP_DOMAIN`: `dx0nin-1q.myshopify.com`
- `ADMIN_EMAIL`: fiyat yönetimi hesabı (varsayılan hesabı değiştirmek için)
- `ADMIN_PASSWORD_HASH`: `npm run password:hash` çıktısı (`ADMIN_EMAIL` ile birlikte)
- `SESSION_SECRET`: en az 32 karakterlik rastgele gizli değer
- `APP_URL`: canlı HTTPS adresi
- `BLOB_READ_WRITE_TOKEN`: yalnız Vercel için, **Private** Blob deposunun sunucu erişim anahtarı

Storefront sorgusu herkese açık yayınlanmış kataloğu okuduğu için Shopify yönetici istemci kimliği veya gizli anahtarı bu sürümde kullanılmaz.

Gizli değişkenler Netlify'ın güvenli ortam ayarlarına girilir ve sunucu işlevlerine açık olmalıdır; `netlify.toml` içine yazılmaz. Netlify'ın [çalışma zamanı değişkenleri belgesi](https://docs.netlify.com/build/functions/environment-variables/#netlify-read-only-variables) bu ayrımı açıklar.

## Vercel Private Blob kurulumu

1. Vercel projesinin **Storage** bölümünde bir Blob deposu oluşturun veya uygun mevcut depoyu bağlayın. Erişim türü mutlaka **Private** olmalıdır; public depo kullanmayın.
2. Depoyu projenin **Production** ortamına bağlayın. Sunucu ortam değişkenlerinde tam adıyla `BLOB_READ_WRITE_TOKEN` bulunmalıdır; farklı değişken adı/prefix kullanılırsa kod onu okuyamaz. Bu anahtarı Git'e, sohbete veya `NEXT_PUBLIC_` değişkenine koymayın.
3. Yönetici girişi için bağımsız, rastgele `SESSION_SECRET` ayarını tamamlayın. İsteniyorsa yönetici hesabının iki override değişkenini de birlikte tanımlayın.
4. Ortam değişkenlerinin uygulanması için yeniden deploy edin. Yönetimdeki depo durumunu kontrol edin; sonra gerçek bir fiyat/yayın değişikliğini yalnız sahibinin onayıyla doğrulayın.

[Private Blob kurulum belgesi](https://vercel.com/docs/vercel-blob/private-storage) ve [SDK tutarlı okuma/koşullu yazım belgesi](https://vercel.com/docs/vercel-blob/using-blob-sdk) uygulanan mekanizmayı açıklar. Uygulama kayıtları `catalog-settings/v1/prices.json` ve `catalog-settings/v1/visibility.json` yollarında tutulur. Bu belgeler istemciye veya herkese açık dosya URL'sine sunulmaz.

`configured` yalnız gerekli ayarın mevcut olduğunu belirtir; erişim anahtarının geçerli veya deponun yazılabilir olduğunu kanıtlamaz. Depo durumundaki `reachable` salt okuma kontrolüdür; yazma yetkisi ya da yeterli kota garantisi değildir. Bağlantı yoksa fiyat/yayın işlemleri 503 hatası verir; geçici sunucu diskine kaydedilmiş gibi gösterilmez. Bozuk mevcut belge üzerine yazılmaz.

Preview ve production aynı depo anahtarını kullanırsa aynı katalog ayarlarını paylaşır. Üretim verisini korumak için preview'a ayrı özel depo/anahtar bağlayın veya hiç anahtar vermeyin. Yerel önizleme için Vercel çalışma zamanı işaretlerini (`VERCEL`, `VERCEL_ENV`) kopyalamayın; yalnız Blob anahtarının yerelde bulunması yerel dosya davranışını değiştirmez.

Mevcut Netlify veya yerel fiyatlar ve seçimler otomatik taşınmaz ve bu kod tarafından silinmez. Yeni Vercel deposu boşsa fiyatlar boş, ürünler gizli başlar. Eski kayıtları taşımak ayrı ve açıkça onaylanmış bir veri aktarımıdır; sadece kodu deploy etmek yeterli değildir.

Depo kotası sınırsız değildir. Vercel'in [güncel kullanım ve fiyatlandırma belgesine](https://vercel.com/docs/vercel-blob/usage-and-pricing) göre Hobby dahilinde 1 GB depolama, aylık 10.000 basit ve 2.000 gelişmiş işlem bulunur; kota aşılırsa erişim durabilir. Planın ticari kullanım uygunluğu ayrıca değerlendirilmelidir. Bu proje kendiliğinden depo, ücretli plan veya ek abonelik açmaz. Toplu işlemlerde belge yazımları kısa aralıklarla sınırlandırılır; binlerce satırın uygulanması zaman alabilir.

## Kontroller

- `npm test`
- `npm run lint`
- `npm run build`

Yayından sonra katalog araması, mobil görünüm, sepete ekleme, WhatsApp metni, yönetici girişi ve özel fiyat kaydetme canlı ortamda yeniden kontrol edilmelidir.
