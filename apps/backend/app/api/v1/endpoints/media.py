from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse

from app.core.media import resolve_media_file, verify_media_signature

router = APIRouter(prefix="/media", tags=["media"])


@router.get("/{path:path}", summary="Signed media download (alert snapshots, clips)")
async def get_media(path: str, exp: int = Query(...), sig: str = Query(..., min_length=16, max_length=64)):
    if not verify_media_signature(path, exp, sig):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid or expired media link")
    file = resolve_media_file(path)
    if file is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")
    return FileResponse(file, headers={"Cache-Control": "private, max-age=3600"})
