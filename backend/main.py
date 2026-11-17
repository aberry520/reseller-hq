"""Reseller HQ background remover — companion service for the Expo app.

Runs rembg (U2-Net) locally, composites the cut-out subject onto a pure
white background, and returns a JPEG. No per-image fee, no upload to a
third party — your photos stay on your own laptop.

Run:
    cd backend
    python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\\Scripts\\activate
    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000

First run downloads the rembg model (~170 MB, cached in ~/.u2net/) — after
that it works offline. Then in the Expo app, set Settings > Background
remover URL to http://<your-laptop-IP>:8000 (phone and laptop on same Wi-Fi).

Endpoints:
    GET  /health     -> {"status": "ok"}
    POST /remove-bg  -> multipart field `file`, returns image/jpeg (white bg)
"""

import io

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from PIL import Image
from rembg import remove

app = FastAPI(title="Reseller HQ background remover")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/remove-bg")
async def remove_bg(file: UploadFile = File(...)) -> StreamingResponse:
    try:
        raw = await file.read()
        src = Image.open(io.BytesIO(raw)).convert("RGBA")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read image: {exc}") from exc
    try:
        cut = remove(src)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Background removal failed: {exc}") from exc
    white = Image.new("RGBA", cut.size, (255, 255, 255, 255))
    out = Image.alpha_composite(white, cut).convert("RGB")
    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=92)
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/jpeg")
