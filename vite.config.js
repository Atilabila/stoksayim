import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Mobilde self-signed HTTPS çoğu cihazda "empty response" veriyor; HTTP kullanıyoruz.
// Kamera için: ngrok veya gerçek HTTPS (https://ngrok.com vb.) kullanın.
// import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        port: 5173,
        // Mobil cihazdan aynı ağda erişim: http://<bilgisayar-ip>:5173
        strictPort: false,
    },
})
