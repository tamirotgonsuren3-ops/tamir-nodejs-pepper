# Tamir (Node.js fullstack version)

This is a Node.js port of the tamir-go Wails application. Backend is Express + better-sqlite3; frontend is the original Svelte app adapted to call the backend over HTTP RPC.

## Setup

```bash
cd tamir-nodejs
npm run install:all
npm run build:frontend
npm start
```

Then open http://localhost:3000.

## Development

- Backend: `npm run dev:backend`
- Frontend: `npm run dev:frontend`

## Notes

- Binance integration uses the Binance REST API (set keys in the UI).
- Pepperstone uses the Python FIX scripts if available (set scripts dir in Settings).
- AI training requires Python 3 with scikit-learn, pandas, numpy installed.