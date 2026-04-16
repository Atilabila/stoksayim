# Mobilde kamera için ngrok ile HTTPS

1. **ngrok kurulumu**  
   - https://ngrok.com/download adresinden indirin veya:  
     `winget install ngrok` (Windows) / `choco install ngrok`

2. **Hesap (ücretsiz)**  
   - https://dashboard.ngrok.com/signup ile kayıt olun, authtoken’ı alın.  
   - Terminalde: `ngrok config add-authtoken <token>`

3. **Uygulamayı çalıştırın**  
   - Bir terminalde: `npm run dev` (Vite http://localhost:5173)

4. **Tüneli açın**  
   - Başka bir terminalde: `npm run tunnel` veya `ngrok http 5173`

5. **Mobilde açın**  
   - ngrok’un yazdığı **https://xxxx.ngrok-free.app** (veya .io) adresini telefondan açın.  
   - Kamera izni verin; barkod tarama çalışır.

Not: ngrok ücretsiz planda her çalıştırmada yeni bir adres verir. Sabit adres için ücretli plan gerekir.
