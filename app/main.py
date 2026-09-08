from __future__ import annotations

from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .extractor import ExtractionError, extract_video_urls, fetch_html


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="Video URL Extractor")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class ExtractRequest(BaseModel):
    url: str = Field(..., min_length=8, max_length=2048)


class ExtractResponse(BaseModel):
    page_url: str
    count: int
    results: list[dict[str, str]]


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/extract", response_model=ExtractResponse)
async def extract(request: ExtractRequest) -> ExtractResponse:
    try:
        html_text, final_url = await fetch_html(request.url)
        results = extract_video_urls(html_text, final_url)
    except ExtractionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"取得先ページがHTTP {exc.response.status_code} を返しました。",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="ページの取得に失敗しました。") from exc

    return ExtractResponse(page_url=final_url, count=len(results), results=results)
