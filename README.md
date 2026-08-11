# nefusoft-api

API Express yang dapat dijalankan lokal maupun dideploy ke Vercel.

## Deploy ke Vercel

1. Import repository ini ke Vercel, atau jalankan `vercel` dari root proyek.
2. Tambahkan Environment Variable berikut di **Project Settings → Environment Variables**:

   ```text
   BASE_API=https://animeinweb.com/api/proxy/3/2
   ```

   Terapkan ke environment Production (dan Preview bila diperlukan).
3. Deploy.

`vercel.json` me-rewrite semua path ke `api/index.js`, yang menjalankan Express app dari `server.js`. Karena seluruh pemanggilan upstream di route tersebut menggunakan `proxyFetch` atau `proxyStream` dari `cf.js`, header dan konfigurasi request yang sudah ada di `cf.js` tetap digunakan pada Vercel.

## Lokal

```bash
npm install
npm start
```

Buat `.env` lokal dengan `BASE_API` bila nilainya berbeda. `PORT` bersifat opsional dan secara default menggunakan `3000`.

## Catatan

- Jangan menyimpan token atau secret deployment di `.env` yang dikomit. Konfigurasi environment production harus disimpan di dashboard Vercel.
- Endpoint `/v1/proxy` meneruskan stream respons upstream. Batas durasi function pada `vercel.json` adalah 60 detik; video atau download panjang dapat terhenti karena batas platform Vercel.
