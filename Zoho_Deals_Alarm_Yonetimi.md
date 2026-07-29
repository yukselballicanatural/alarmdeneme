# Zoho Deals Alarm Yönetimi ve Otomatik Kapanış Senaryoları

## Genel Yaklaşım

Agent Zoho üzerindeki ilgili alanları güncellediğinde alarm, takım liderinin manuel işlem yapmasını beklemeden otomatik olarak kapanmalıdır.

**Result Code** yalnızca manuel değerlendirme, takip veya istisna yönetimi gereken durumlarda kullanılmalıdır.

Sistemde üç temel aksiyon bulunmalıdır:

- **Otomatik Kapat:** Zoho güncellemesi alarm koşulunu ortadan kaldırdıysa sistem alarmı kapatır.
- **Takibe Al:** Mevcut alarm sonuçlandırılır, yeni takip tarihiyle yeni alarm oluşturulur.
- **Yeni Alarm Oluştur:** Deal yeni bir alarm koşuluna geçtiyse eski alarm kapanır ve uygun alarm tipi açılır.

---

## 1. Bugün Alarmı

### Zoho Güncellemesine Göre Otomatik İşlem

| Zoho’daki değişiklik | Sistem aksiyonu |
|---|---|
| `Arrival Date` ileri bir tarihe değiştirildi | Bugün Alarmı otomatik kapanır. Yeni tarihe göre Yaklaşan Alarm oluşturulur. |
| Deal Stage `Cancelled` yapıldı | Bugün Alarmı otomatik kapanır. İptal Alarmı oluşturulur. |
| Hasta geldiğini gösteren stage veya statü seçildi | Bugün Alarmı otomatik kapanır. |
| `Arrival Date` silindi | Bugün Alarmı otomatik kapanır. Eksik Tarih Alarmı oluşturulur. |
| Hiçbir ilgili alan güncellenmedi | Alarm açık kalır. Takım lideri Result Code seçerek kapatır veya takibe alır. |

### Manuel Result Code ve Aksiyonlar

| Result Code | Aksiyon |
|---|---|
| Hasta Geldi | Kapat |
| Geliş Teyit Edildi | Takibe Al |
| Tarih Değiştirildi | Zoho Güncellemesini Bekle |
| Hasta Gelmedi | Takibe Al |
| Ulaşılamadı | Takibe Al |
| İptal Edildi | İptal Alarmı Oluştur |

---

## 2. Yaklaşan Alarm

### Zoho Güncellemesine Göre Otomatik İşlem

| Zoho’daki değişiklik | Sistem aksiyonu |
|---|---|
| `Arrival Date` değiştirildi | Eski Yaklaşan Alarm otomatik kapanır. Yeni tarihe göre yeni alarm oluşturulur. |
| `Arrival Date` bugünün tarihine geldi | Yaklaşan Alarm otomatik kapanır. Bugün Alarmı oluşturulur. |
| Deal Stage `Cancelled` yapıldı | Yaklaşan Alarm otomatik kapanır. İptal Alarmı oluşturulur. |
| `Arrival Date` silindi | Yaklaşan Alarm otomatik kapanır. Eksik Tarih Alarmı oluşturulur. |
| Hasta geldi veya tamamlandı statüsüne geçti | Yaklaşan Alarm otomatik kapanır. |
| Sadece not eklendi, tarih değişmedi | Alarm otomatik kapanmaz. Takip devam eder. |

### Manuel Result Code ve Aksiyonlar

| Result Code | Aksiyon |
|---|---|
| Geliş Teyit Edildi | Takibe Al |
| Yeni Takip Tarihi Verildi | Takibe Al |
| Arrival Date Güncellendi | Zoho Güncellemesini Bekle |
| Ulaşılamadı | Takibe Al |
| İptal Talebi | Yönetici Kontrolü / Takibe Al |

---

## 3. Eksik Tarih Alarmı

### Zoho Güncellemesine Göre Otomatik İşlem

| Zoho’daki değişiklik | Sistem aksiyonu |
|---|---|
| `Arrival Date` dolduruldu | Eksik Tarih Alarmı otomatik kapanır. Tarihe göre Yaklaşan, Bugün veya Gecikmiş Alarm oluşturulur. |
| Deal Stage `Cancelled` yapıldı | Eksik Tarih Alarmı otomatik kapanır. İptal Alarmı oluşturulur. |
| Deal geçersiz veya mükerrer olarak kapatıldı | Eksik Tarih Alarmı otomatik kapanır. |
| Sadece takip notu eklendi | Alarm kapanmaz. Takım lideri takip tarihi belirler. |

### Manuel Result Code ve Aksiyonlar

| Result Code | Aksiyon |
|---|---|
| Arrival Date Eklendi | Otomatik Kapanışı Bekle |
| Karar Bekleniyor | Takibe Al |
| Seyahat Planı Bekleniyor | Takibe Al |
| Ulaşılamadı | Takibe Al |
| Deal Geçersiz | Kapat |

---

## 4. Gecikmiş Alarm

### Zoho Güncellemesine Göre Otomatik İşlem

| Zoho’daki değişiklik | Sistem aksiyonu |
|---|---|
| `Arrival Date` ileri bir tarihe güncellendi | Gecikmiş Alarm otomatik kapanır. Yeni Yaklaşan Alarm oluşturulur. |
| Hasta geldiğini gösteren stage veya statü seçildi | Gecikmiş Alarm otomatik kapanır. |
| Deal Stage `Cancelled` yapıldı | Gecikmiş Alarm otomatik kapanır. İptal Alarmı oluşturulur. |
| `Arrival Date` silindi | Gecikmiş Alarm otomatik kapanır. Eksik Tarih Alarmı oluşturulur. |
| Geçmiş tarih değişmeden kaldı | Alarm otomatik kapanmaz. Takım lideri işlem yapar. |

### Manuel Result Code ve Aksiyonlar

| Result Code | Aksiyon |
|---|---|
| Hasta Geldi | Kapat |
| Yeni Tarih Verildi | Zoho Güncellemesini Bekle |
| No Show | Takibe Al |
| Ulaşılamadı | Takibe Al |
| İptal Edildi | İptal Alarmı Oluştur |
| Tarih Hatalıydı | Zoho Güncellemesini Bekle |

---

## 5. Won Alarm

### Alarm Oluşma Şartı

```text
Deal Stage = Won
ve
Amount ≠ Paid Amount
```

### Zoho Güncellemesine Göre Otomatik İşlem

| Zoho’daki değişiklik | Sistem aksiyonu |
|---|---|
| `Paid Amount = Amount` oldu | Won Alarmı otomatik kapanır. |
| `Amount` doğru tutara güncellendi ve `Paid Amount` ile eşitlendi | Won Alarmı otomatik kapanır. |
| Deal Stage artık `Won` değil | Won Alarmı otomatik kapanır. |
| Paid Amount arttı fakat hâlâ Amount’tan düşük | Alarm kapanmaz. Kalan tutar güncellenir. |
| Paid Amount, Amount’tan yüksek oldu | Alarm kapanmaz. Finansal Veri Hatası olarak işaretlenir. |
| Sadece ödeme sözü veya not eklendi | Alarm otomatik kapanmaz. Takip tarihi gerekir. |

### Manuel Result Code ve Aksiyonlar

| Result Code | Aksiyon |
|---|---|
| Ödeme Tamamlandı | Otomatik Kapanışı Bekle |
| Kısmi Ödeme Alındı | Takibe Al |
| Ödeme Sözü Alındı | Takibe Al |
| İndirim/Tutar Güncellendi | Yeniden Kontrol Et |
| Finansa Aktarıldı | Takibe Al |
| Won Statüsü Hatalı | Zoho Stage Güncellemesini Bekle |

---

## 6. İptal Alarmı

### Zoho Güncellemesine Göre Otomatik İşlem

| Zoho’daki değişiklik | Sistem aksiyonu |
|---|---|
| Deal Stage `Cancelled` ve Cancellation Code dolu | İptal Alarmı otomatik kapanır. |
| Deal Stage `Cancelled` fakat Cancellation Code boş | Alarm açık kalır. Takım lideri iptal nedenini seçer. |
| Deal tekrar aktif bir stage’e alındı | İptal Alarmı otomatik kapanır. Yeni stage’e göre alarm kontrolü yapılır. |
| Mükerrer veya hatalı kayıt olarak işaretlendi | İptal Alarmı otomatik kapanır. |
| Sadece açıklama veya not girildi | Alarm kapanmaz. Cancellation Code zorunlu kalır. |

### Manuel Result Code ve Aksiyonlar

| Result Code | Aksiyon |
|---|---|
| Fiyat/Bütçe | Kapat |
| Medikal Uygunsuzluk | Kapat |
| Rakip Klinik | Kapat |
| Vize/Seyahat Sorunu | Kapat |
| Hasta Vazgeçti | Kapat |
| Ulaşılamadı | Yönetici Onayıyla Kapat |
| Operasyonel Problem | Açıklama Zorunlu Kapat |
| Mükerrer/Hatalı Deal | Kapat |

---

## Otomatik Kapatma Öncelik Sırası

Sistem her Zoho senkronizasyonunda aşağıdaki sırayla kontrol yapmalıdır:

1. Deal hâlâ ilgili alarm koşulunu sağlıyor mu?
2. Alarm koşulu ortadan kalktıysa mevcut alarmı `Auto Closed` olarak kapat.
3. Otomatik kapanma nedenini kaydet.
4. Yeni duruma göre gerekiyorsa yeni alarm oluştur.
5. Aynı alarmın yeniden oluşmasını `dedup_key` ile engelle.
6. Yeni alarm oluşacaksa eski alarm ile bağlantısını kaydet.

---

## Otomatik Result Code Önerileri

| Otomatik Result Code | Kullanılacağı durum |
|---|---|
| `Arrival Date Updated` | Geliş tarihi değiştirildi. |
| `Arrival Date Added` | Eksik geliş tarihi tamamlandı. |
| `Arrival Date Removed` | Tarih silindi ve Eksik Tarih Alarmına geçildi. |
| `Patient Arrived` | Hasta geldi statüsüne geçti. |
| `Payment Completed` | Paid Amount ve Amount eşitlendi. |
| `Deal Stage Updated` | Alarmı oluşturan stage değiştirildi. |
| `Deal Cancelled` | Deal iptal edildi. |
| `Cancellation Reason Added` | İptal nedeni Zoho’ya girildi. |
| `Invalid or Duplicate Deal` | Deal mükerrer veya hatalı olarak kapatıldı. |
| `Auto Closed by Zoho Update` | Genel otomatik kapanış kodu. |

---

## Manuel Takip Gerektiren Durumlar

Aşağıdaki durumlarda alarm otomatik kapanmamalı, takım lideri tarafından takip edilmelidir:

- Ulaşılamadı
- Ödeme sözü alındı
- Karar bekleniyor
- Seyahat planı bekleniyor
- No Show
- Finansa aktarıldı
- İptal talebi henüz kesinleşmedi
- Operasyonel problem
- Paid Amount hâlâ Amount’tan düşük

Bu sonuçlarda yeni takip tarihi girilmeden işlem tamamlanmamalıdır.

---

## Alarm Kayıtlarında Tutulması Önerilen Alanlar

```text
Status: Open / Follow-up / Auto Closed / Manually Closed
Result Code
Closed By: System veya Kullanıcı
Closed Date
Zoho Updated Field
Old Value
New Value
Follow-up Date
Replacement Alarm ID
```

---

## Temel Kural

- Zoho’daki veri değişikliği alarm koşulunu ortadan kaldırıyorsa alarm otomatik kapanmalıdır.
- Manuel Result Code seçimi yalnızca takip veya değerlendirme gereken durumlarda kullanılmalıdır.
- `Takibe Al` seçilen hiçbir işlem, yeni takip tarihi girilmeden tamamlanmamalıdır.
- Bir alarm kapanırken başka bir alarm koşulu oluşuyorsa sistem uygun yeni alarmı otomatik açmalıdır.
