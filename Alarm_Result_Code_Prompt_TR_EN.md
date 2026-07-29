# Alarm Result Code Yapısı / Alarm Result Code Structure

## Türkçe Prompt

Aşağıdaki alarm türleri için takım liderinin agent’a göndereceği bildirimlerde kullanılacak **Result Code** seçeneklerini oluştur.

Kurallar:

- Result Code, alarmın kapanma sebebini değil, agent’a hangi aksiyonun iletildiğini göstermelidir.
- Her alarm türünde en fazla 5 Result Code bulunmalıdır.
- Takım lideri bildirim göndermeden önce Result Code seçmeli ve açıklama/not alanını zorunlu doldurmalıdır.
- Bildirim gönderildiğinde alarm kapanmamalı, `Zoho Güncellemesi Bekleniyor` durumuna geçmelidir.
- Agent Zoho’daki gerekli alanı güncellediğinde sistem alarmı otomatik kapatmalı ve ayrı bir `System Closure Reason` yazmalıdır.
- Result Code seçenekleri kısa, net ve operasyonel olmalıdır.
- Arayüz dili Türkçe veya İngilizce seçimine göre karşılığı gösterilmelidir.

### Alarm Türleri ve Result Code’lar

#### Bugün Alarmı
1. Hasta Geliş Durumu Kontrolü İletildi
2. Arrival Date Güncelleme Talebi İletildi
3. Hasta Statüsü Güncelleme Talebi İletildi
4. No Show Kontrolü İletildi
5. İptal Durumu Kontrolü İletildi

#### Yaklaşan Alarm
1. Hasta Geliş Teyidi Talebi İletildi
2. Arrival Date Kontrolü İletildi
3. Seyahat Planı Kontrolü İletildi
4. Uçuş Bilgisi Güncelleme Talebi İletildi
5. Hasta ile İletişim Talebi İletildi

#### Eksik Tarih Alarmı
1. Arrival Date Ekleme Talebi İletildi
2. Hastadan Tarih Bilgisi Alınması İletildi
3. Seyahat Planı Takibi İletildi
4. Deal Geçerlilik Kontrolü İletildi
5. İptal Bilgisi Güncelleme Talebi İletildi

#### Gecikmiş Alarm
1. Gecikmiş Arrival Date Kontrolü İletildi
2. Yeni Arrival Date Girilmesi İletildi
3. Hasta Geliş Durumu Kontrolü İletildi
4. No Show Güncelleme Talebi İletildi
5. İptal Statüsü Güncelleme Talebi İletildi

#### Won Alarmı
1. Eksik Ödeme Kontrolü İletildi
2. Paid Amount Güncelleme Talebi İletildi
3. Deal Amount Kontrolü İletildi
4. Ödeme Kaydı Kontrolü İletildi
5. Won Stage Kontrolü İletildi

#### İptal Alarmı
1. Cancellation Code Ekleme Talebi İletildi
2. İptal Nedeni Kontrolü İletildi
3. Deal Stage Güncelleme Talebi İletildi
4. Mükerrer Deal Kontrolü İletildi
5. Aktif Süreç Kontrolü İletildi

### Sistem Davranışı

1. Takım lideri alarmı açar.
2. Alarm durumunu seçer.
3. Result Code seçer.
4. Not alanını zorunlu olarak doldurur.
5. WhatsApp bildirimi agent’a gönderilir.
6. Alarm durumu `Zoho Güncellemesi Bekleniyor` olur.
7. Agent ilgili Zoho alanını günceller.
8. Sistem alarmı otomatik kapatır.
9. Sistem kapanma sebebini ayrı alana yazar.

Örnek:

- Result Code: `Arrival Date Ekleme Talebi İletildi`
- Takım Lideri Notu: `Hastanın geliş tarihi bulunmamaktadır. Hasta ile görüşerek Arrival Date alanını güncelleyiniz.`
- System Closure Reason: `Arrival Date Eklendi`

---

## English Prompt

Create the **Result Code** options below for team leader notifications sent to agents for each alarm type.

Rules:

- The Result Code must show which action was communicated to the agent, not why the alarm was closed.
- Each alarm type must contain no more than 5 Result Codes.
- Before sending a notification, the team leader must select a Result Code and complete the note/description field.
- Sending a notification must not close the alarm. Its status must change to `Waiting for Zoho Update`.
- When the agent updates the required Zoho field, the system must automatically close the alarm and write a separate `System Closure Reason`.
- Result Code options must be short, clear, and operational.
- The interface must show the corresponding Turkish or English value according to the selected language.

### Alarm Types and Result Codes

#### Today Alarm
1. Patient Arrival Status Check Sent
2. Arrival Date Update Request Sent
3. Patient Status Update Request Sent
4. No-Show Check Sent
5. Cancellation Status Check Sent

#### Upcoming Alarm
1. Patient Arrival Confirmation Request Sent
2. Arrival Date Check Sent
3. Travel Plan Check Sent
4. Flight Information Update Request Sent
5. Patient Contact Request Sent

#### Missing Date Alarm
1. Arrival Date Entry Request Sent
2. Patient Date Information Request Sent
3. Travel Plan Follow-up Sent
4. Deal Validity Check Sent
5. Cancellation Information Update Request Sent

#### Overdue Alarm
1. Overdue Arrival Date Check Sent
2. New Arrival Date Entry Request Sent
3. Patient Arrival Status Check Sent
4. No-Show Update Request Sent
5. Cancellation Stage Update Request Sent

#### Won Alarm
1. Missing Payment Check Sent
2. Paid Amount Update Request Sent
3. Deal Amount Check Sent
4. Payment Record Check Sent
5. Won Stage Check Sent

#### Cancellation Alarm
1. Cancellation Code Entry Request Sent
2. Cancellation Reason Check Sent
3. Deal Stage Update Request Sent
4. Duplicate Deal Check Sent
5. Active Process Check Sent

### System Behaviour

1. The team leader opens the alarm.
2. The alarm status is selected.
3. A Result Code is selected.
4. The note field is completed as mandatory.
5. The WhatsApp notification is sent to the agent.
6. The alarm status changes to `Waiting for Zoho Update`.
7. The agent updates the relevant Zoho field.
8. The system automatically closes the alarm.
9. The system writes the closure reason in a separate field.

Example:

- Result Code: `Arrival Date Entry Request Sent`
- Team Leader Note: `The patient’s arrival date is missing. Contact the patient and update the Arrival Date field in Zoho.`
- System Closure Reason: `Arrival Date Added`
