import httpx
from fastapi import HTTPException, status

from app.config.config import settings
from app.service.config.config_service import ConfigService
from app.log.logger import Logger

logger = Logger.setup_logger("scanner-integration")


class ScannerService:
    """客户端封装，用于调用 scanner 暴露的 Gemini Key 接口。"""

    def __init__(self, base_url: str, api_key: str, timeout: int = 15) -> None:
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = api_key or ""
        self.timeout = timeout

    def _auth_headers(self) -> dict[str, str]:
        if not self.api_key:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Scanner API Key 未配置")
        return {"Authorization": f"Bearer {self.api_key}"}

    def _build_client(self) -> httpx.AsyncClient:
        timeout = httpx.Timeout(self.timeout, read=self.timeout)
        return httpx.AsyncClient(timeout=timeout)

    async def fetch_key_assets(self, *, limit: int, key_type: str = "valid") -> dict:
        url = f"{self.base_url}/api/gemini/key-assets"
        params = {"type": key_type, "limit": limit}
        try:
            async with self._build_client() as client:
                response = await client.get(url, params=params, headers=self._auth_headers())
                response.raise_for_status()
                return response.json()
        except HTTPException:
            raise
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text or exc.response.reason_phrase
            logger.error(f"调用 scanner key-assets 失败: {detail}")
            raise HTTPException(status_code=exc.response.status_code, detail=detail)
        except httpx.RequestError as exc:
            logger.error(f"无法连接 scanner: {exc}")
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="无法连接 scanner API")

    async def trigger_reverify(self, *, count: int, statuses: list[str] | None = None) -> dict:
        url = f"{self.base_url}/api/gemini/reverify"
        payload: dict[str, object] = {"count": count}
        if statuses:
            payload["filter_by_status"] = ",".join(statuses)
        try:
            async with self._build_client() as client:
                response = await client.post(url, json=payload, headers=self._auth_headers())
                response.raise_for_status()
                return response.json()
        except HTTPException:
            raise
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text or exc.response.reason_phrase
            logger.error(f"调用 scanner reverify 失败: {detail}")
            raise HTTPException(status_code=exc.response.status_code, detail=detail)
        except httpx.RequestError as exc:
            logger.error(f"无法连接 scanner: {exc}")
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="无法连接 scanner API")

    async def delete_invalid(self, *, limit: int) -> dict:
        url = f"{self.base_url}/api/gemini/delete-invalid"
        payload = {"count": limit}
        try:
            async with self._build_client() as client:
                response = await client.post(url, json=payload, headers=self._auth_headers())
                response.raise_for_status()
                return response.json()
        except HTTPException:
            raise
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text or exc.response.reason_phrase
            logger.error(f"调用 scanner delete-invalid 失败: {detail}")
            raise HTTPException(status_code=exc.response.status_code, detail=detail)
        except httpx.RequestError as exc:
            logger.error(f"无法连接 scanner: {exc}")
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="无法连接 scanner API")

    async def ping(self) -> dict:
        """测试 scanner 健康，区分连通性与授权错误。"""
        result: dict[str, object] = {
            "connectivity": False,
            "auth": False,
            "message": None,
            "error_type": None,
        }

        try:
            async with self._build_client() as client:
                resp = await client.get(f"{self.base_url}/healthz", timeout=self.timeout)
                result["connectivity"] = resp.status_code == 200
        except Exception as exc:
            logger.error(f"scanner 健康检查失败: {exc}")
            result["message"] = "无法连接 scanner 服务"
            result["error_type"] = "connectivity"
            return result

        if not result["connectivity"]:
            result["message"] = "scanner 启动或响应异常"
            result["error_type"] = "connectivity"
            return result

        try:
            async with self._build_client() as client:
                resp = await client.get(
                    f"{self.base_url}/api/gemini/key-assets",
                    params={"type": "valid", "limit": 1},
                    headers=self._auth_headers(),
                )
                if resp.status_code in (401, 403):
                    result["message"] = "scanner API Key 无效"
                    result["error_type"] = "auth"
                    return result
                resp.raise_for_status()
                result["auth"] = True
                return result
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text or exc.response.reason_phrase
            logger.error(f"scanner 授权测试失败: {detail}")
            result["message"] = detail
            result["error_type"] = "scanner_error"
            return result
        except httpx.RequestError as exc:
            logger.error(f"scanner 授权请求失败: {exc}")
            result["message"] = "无法连接 scanner 服务"
            result["error_type"] = "connectivity"
            return result


async def apply_synced_keys(items: list[dict], key_type: str) -> dict:
    """将 scanner 返回的 key 集合写入本地配置。"""
    keys = [str(item.get("key", "")).strip() for item in items if item.get("key")]
    if not keys:
        logger.warning("同步结果为空，保留现有 API_KEYS/PAID_KEY")
        return {"synced": 0, "applied": False, "message": "no keys returned"}

    payload: dict[str, object] = {}
    if key_type == "paid":
        payload["PAID_KEY"] = keys[0]
    else:
        payload["API_KEYS"] = keys
        paid_candidate = next(
            (
                str(item.get("key")).strip()
                for item in items
                if str(item.get("recheck_status", "")).lower() == "billable" and item.get("key")
            ),
            None,
        )
        if paid_candidate:
            payload["PAID_KEY"] = paid_candidate

    if payload:
        await ConfigService.update_config(payload)
        logger.info(f"已应用 scanner 同步结果，更新字段 {', '.join(payload.keys())}")
        return {"synced": len(keys), "applied": True, "updated_fields": list(payload.keys())}
    return {"synced": len(keys), "applied": False, "message": "no payload generated"}


async def sync_keys_from_scanner(
    service: ScannerService,
    *,
    limit: int,
    key_type: str = "valid",
) -> dict:
    response = await service.fetch_key_assets(limit=limit, key_type=key_type)
    items = response.get("items") or []
    summary = await apply_synced_keys(items, key_type)
    summary.update({"total": response.get("total", len(items)), "type": key_type})
    return summary


def get_scanner_service() -> ScannerService:
    """按当前配置创建 ScannerService。"""
    return ScannerService(
        settings.SCANNER_API_BASE_URL,
        settings.SCANNER_API_KEY,
        timeout=settings.SCANNER_API_TIMEOUT,
    )
