# Background remover — companion service

The Expo app does **not** run background removal on the phone. This small
Python service does it on your laptop, using the free open-source `rembg`
library (U²-Net model). Your photos never leave your own Wi-Fi.

## Run it

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

First run downloads the rembg model (~170 MB, cached in `~/.u2net/`). After
that it works offline.

Check it: open http://localhost:8000/health — you should see `{"status":"ok"}`.

## Connect the phone app

1. Find your laptop's local IP (same Wi-Fi as your iPhone), e.g. `192.168.1.50`.
2. In Reseller HQ: Settings → Background remover URL → `http://192.168.1.50:8000`
3. Take a photo on an item. The app POSTs it to `/remove-bg` and saves the
   white-background JPEG alongside the original.

If the URL is blank, or the laptop isn't reachable, the app keeps the
original photo and shows a note — it never blocks the photo flow.

## API

- `GET /health` → `{"status": "ok"}`
- `POST /remove-bg` — multipart form, field `file` (JPG/PNG). Returns
  `image/jpeg` on a white background.
