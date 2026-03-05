// Run this ONCE after deploying to register your Telegram webhook
// Replace YOUR_BOT_TOKEN and YOUR_VERCEL_URL before running
//
// node register-webhook.js

const BOT_TOKEN  = '8636840001:AAESQVBGCXe41bHqxUS3vz4M6E0juawldP4';        // e.g. 7123456789:AAF...
const VERCEL_URL = 'https://apex-stocks.vercel.app/';        // e.g. apex-stocks.vercel.app

const url = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=https://${VERCEL_URL}/api/telegram-webhook`;

fetch(url)
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      console.log('✅ Webhook registered successfully!');
      console.log('Telegram will now forward messages to:', `https://${VERCEL_URL}/api/telegram-webhook`);
    } else {
      console.error('❌ Failed:', data.description);
    }
  })
  .catch(e => console.error('Error:', e.message));
