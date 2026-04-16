# Yeni Supabase projesi — tek seferde şema

Bu klasördeki `initial_schema.sql`, **boş** bir Postgres/Supabase veritabanında StokSayım tablolarını, RLS, tetikleyici ve yorumları oluşturur.

## Ne zaman kullanılır?

- Dashboard’da **SQL Editor** ile yeni projeye yapıştırıp çalıştırmak.
- Ya da Supabase CLI ile yeni bir repo açıp `supabase/migrations/` içinde **yalnızca bu içeriği** tek migration dosyası olarak kullanmak (migration geçmişi sıfırdan başlıyorsa).

## Bu repodaki mevcut migration zinciri

Bu Git deposunda tarihli dosyalar halinde migration’lar zaten vardır. **Mevcut veritabanını** güncellemek için `supabase/migrations/` altındaki sırayı kullanın; `baseline/initial_schema.sql` yalnızca **sıfırdan kurulum** içindir — ikisini aynı veritabanında çift çalıştırmayın.

## Şema değişince

Kök [schema.sql](../../schema.sql) ve bu dosyayı aynı tutun (veya tek kaynak olarak birini seçip diğerini güncelleyin).
