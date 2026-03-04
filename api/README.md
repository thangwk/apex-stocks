# APEX — Stock Intelligence Terminal

A real-time stock analysis app with candlestick charts, intrinsic value (DCF), technical indicators, and AI-powered trade analysis.

**Data:** Finnhub.io (real-time)  
**Hosting:** Vercel (free)  
**AI:** Claude Sonnet (via Anthropic API)

---

## Deploy to Vercel (free, ~5 minutes)

### 1. Push to GitHub
Create a new repo on GitHub and push this folder:
```bash
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/YOUR_USERNAME/apex-stocks.git
git push -u origin main
```

### 2. Import on Vercel
1. Go to [vercel.com](https://vercel.com) and sign up (free)
2. Click **"Add New Project"**
3. Import your GitHub repo
4. Click **Deploy** (no build settings needed — it's a static site + serverless functions)

### 3. Add your Finnhub API key
1. In your Vercel project, go to **Settings → Environment Variables**
2. Add:
   - **Name:** `FINNHUB_API_KEY`
   - **Value:** your key from [finnhub.io](https://finnhub.io)
3. Click **Save** and then **Redeploy**

That's it. Your app is live at `https://your-project.vercel.app`.

---

## Project Structure

```
apex-stocks/
├── index.html          # Full frontend app
├── vercel.json         # Vercel routing config
└── api/
    ├── quote.js        # Proxies Finnhub /quote
    ├── candles.js      # Proxies Finnhub /stock/candle
    ├── profile.js      # Proxies Finnhub /stock/profile2
    └── metrics.js      # Proxies Finnhub /stock/metric
```

## How the API key is protected

The browser **never** sees your Finnhub key. All requests go:

```
Browser → /api/quote?symbol=AAPL  (your Vercel function)
                    ↓
         Vercel injects FINNHUB_API_KEY from env
                    ↓
         finnhub.io/api/v1/quote?token=YOUR_KEY
```

Your key lives only in Vercel's encrypted environment variables.

---

## Running locally

```bash
npm i -g vercel
vercel dev
```

Then set your key in a `.env.local` file:
```
FINNHUB_API_KEY=your_key_here
```
