from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.config.config import settings
from app.core.security import verify_auth_token
from app.log.logger import Logger
from app.scheduler.scheduled_tasks import reload_scanner_jobs
from app.service.config.config_service import ConfigService
from app.service.scanner.scanner_service import (
    ScannerService,
    get_scanner_service,
    sync_keys_from_scanner,
)

router = APIRouter(prefix="/api/scanner", tags=["scanner"])

logger = Logger.setup_logger("scanner-routes")


class ScannerConfigPayload(BaseModel):
    base_url: str = Field(..., description="scanner 基础 URL，包含协议")
    api_key: str = Field(..., description="scanner API 密钥")
    timeout: int = Field(default=15, ge=1, le=120, description="请求超时时间（秒）")
    default_limit: int = Field(default=50, ge=1, le=1000, description="UI 默认获取数量")


class ReverifyPayload(BaseModel):
    count: int = Field(default=50, ge=1, le=1000)
    statuses: Optional[List[str]] = Field(
        default=None,
        description="可选，按 recheck_status 过滤（例如：pending,rate_limited）",
    )


class ScannerSchedulePayload(BaseModel):
    sync_enabled: bool = False
    sync_time: str = Field(default="03:00", description="每日同步时间，格式 HH:MM")
    sync_limit: int = Field(default=100, ge=1, le=1000)
    sync_type: str = Field(default="valid", pattern="^(valid|paid)$")
    reverify_enabled: bool = False
    reverify_time: str = Field(default="02:30", description="每日复验时间，格式 HH:MM")
    reverify_count: int = Field(default=50, ge=1, le=1000)
    reverify_statuses: Optional[List[str]] = None
    delete_enabled: bool = False
    delete_time: str = Field(default="04:00", description="每日清理时间，格式 HH:MM")
    delete_limit: int = Field(default=50, ge=1, le=1000)

def _ensure_authenticated(request: Request) -> bool:
    auth_token = request.cookies.get("auth_token")
    if not auth_token or not verify_auth_token(auth_token):
        return False
    return True


@router.get("/config")
async def get_scanner_config(request: Request):
    if not _ensure_authenticated(request):
        logger.warning("Unauthorized access attempt to scanner config")
        return RedirectResponse(url="/", status_code=302)
    masked_key = (
        f"***{settings.SCANNER_API_KEY[-4:]}"
        if settings.SCANNER_API_KEY and len(settings.SCANNER_API_KEY) > 4
        else ""
    )
    return {
        "base_url": settings.SCANNER_API_BASE_URL,
        "api_key_masked": masked_key,
        "timeout": settings.SCANNER_API_TIMEOUT,
        "default_limit": settings.SCANNER_DEFAULT_LIMIT,
    }


@router.put("/config")
async def update_scanner_config(payload: ScannerConfigPayload, request: Request):
    if not _ensure_authenticated(request):
        logger.warning("Unauthorized attempt to update scanner config")
        return RedirectResponse(url="/", status_code=302)
    try:
        await ConfigService.update_config(
            {
                "SCANNER_API_BASE_URL": payload.base_url.rstrip("/"),
                "SCANNER_API_KEY": payload.api_key,
                "SCANNER_API_TIMEOUT": payload.timeout,
                "SCANNER_DEFAULT_LIMIT": payload.default_limit,
            }
        )
        return {"success": True}
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        logger.error(f"Failed to update scanner config: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="更新 scanner 配置失败",
        ) from exc


@router.get("/ping")
async def ping_scanner(request: Request, service: ScannerService = Depends(get_scanner_service)):
    if not _ensure_authenticated(request):
        logger.warning("Unauthorized attempt to ping scanner")
        return RedirectResponse(url="/", status_code=302)
    return await service.ping()


@router.get("/schedule")
async def get_schedule_config(request: Request):
    if not _ensure_authenticated(request):
        logger.warning("Unauthorized access attempt to scanner schedule config")
        return RedirectResponse(url="/", status_code=302)
    return {
        "sync_enabled": settings.SCANNER_SYNC_ENABLED,
        "sync_time": settings.SCANNER_SYNC_DAILY_TIME,
        "sync_limit": settings.SCANNER_SYNC_LIMIT,
        "sync_type": settings.SCANNER_SYNC_TYPE,
        "reverify_enabled": settings.SCANNER_REVERIFY_ENABLED,
        "reverify_time": settings.SCANNER_REVERIFY_DAILY_TIME,
        "reverify_count": settings.SCANNER_REVERIFY_COUNT,
        "reverify_statuses": settings.SCANNER_REVERIFY_STATUSES,
        "delete_enabled": settings.SCANNER_DELETE_ENABLED,
        "delete_time": settings.SCANNER_DELETE_DAILY_TIME,
        "delete_limit": settings.SCANNER_DELETE_LIMIT,
    }


@router.put("/schedule")
async def update_schedule_config(payload: ScannerSchedulePayload, request: Request):
    if not _ensure_authenticated(request):
        logger.warning("Unauthorized attempt to update scanner schedule")
        return RedirectResponse(url="/", status_code=302)
    try:
        await ConfigService.update_config(
            {
                "SCANNER_SYNC_ENABLED": payload.sync_enabled,
                "SCANNER_SYNC_DAILY_TIME": payload.sync_time,
                "SCANNER_SYNC_LIMIT": payload.sync_limit,
                "SCANNER_SYNC_TYPE": payload.sync_type,
                "SCANNER_REVERIFY_ENABLED": payload.reverify_enabled,
                "SCANNER_REVERIFY_DAILY_TIME": payload.reverify_time,
                "SCANNER_REVERIFY_COUNT": payload.reverify_count,
                "SCANNER_REVERIFY_STATUSES": payload.reverify_statuses or [],
                "SCANNER_DELETE_ENABLED": payload.delete_enabled,
                "SCANNER_DELETE_DAILY_TIME": payload.delete_time,
                "SCANNER_DELETE_LIMIT": payload.delete_limit,
            }
        )
        reload_scanner_jobs()
        return {"success": True}
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        logger.error(f"Failed to update scanner schedule: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="更新定时任务配置失败",
        ) from exc


@router.get("/key-assets")
async def fetch_key_assets(
    request: Request,
    limit: int = Query(default=None, ge=1, le=1000),
    key_type: str = Query(default="valid", pattern="^(valid|paid)$"),
    service: ScannerService = Depends(get_scanner_service),
):
    if not _ensure_authenticated(request):
        logger.warning("Unauthorized attempt to fetch scanner keys")
        return RedirectResponse(url="/", status_code=302)

    effective_limit = limit or settings.SCANNER_DEFAULT_LIMIT
    return await service.fetch_key_assets(limit=effective_limit, key_type=key_type)


@router.post("/reverify")
async def trigger_reverify(
    payload: ReverifyPayload,
    request: Request,
    service: ScannerService = Depends(get_scanner_service),
):
    if not _ensure_authenticated(request):
        logger.warning("Unauthorized attempt to trigger reverify")
        return RedirectResponse(url="/", status_code=302)
    return await service.trigger_reverify(
        count=payload.count,
        statuses=payload.statuses,
    )


@router.post("/sync-now")
async def sync_now(
    request: Request,
    limit: int = Query(default=None, ge=1, le=1000),
    key_type: str = Query(default=None, pattern="^(valid|paid)$"),
    service: ScannerService = Depends(get_scanner_service),
):
    if not _ensure_authenticated(request):
        logger.warning("Unauthorized attempt to sync now")
        return RedirectResponse(url="/", status_code=302)
    effective_limit = limit or settings.SCANNER_SYNC_LIMIT
    effective_type = key_type or settings.SCANNER_SYNC_TYPE
    return await sync_keys_from_scanner(
        service, limit=effective_limit, key_type=effective_type
    )


@router.post("/delete-invalid")
async def delete_invalid(
    request: Request,
    limit: int = Query(default=None, ge=1, le=1000),
    service: ScannerService = Depends(get_scanner_service),
):
    if not _ensure_authenticated(request):
        logger.warning("Unauthorized attempt to delete invalid keys")
        return RedirectResponse(url="/", status_code=302)
    effective_limit = limit or settings.SCANNER_DELETE_LIMIT
    return await service.delete_invalid(limit=effective_limit)
