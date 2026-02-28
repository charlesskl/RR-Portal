"""
Authentication helpers for plugins.

Plugins verify JWT tokens issued by the core system.
They do NOT issue tokens themselves.
"""

import os
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware

_security = HTTPBearer()

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")


class TokenPayload(BaseModel):
    sub: str
    role: str = "user"
    department: str | None = None
    permissions: list[str] = []


def verify_token(token: str) -> TokenPayload:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return TokenPayload(**payload)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def get_current_user_from_token(
    credentials: HTTPAuthorizationCredentials = Depends(_security),
) -> TokenPayload:
    return verify_token(credentials.credentials)


def require_role(role: str):
    async def _check(user: TokenPayload = Depends(get_current_user_from_token)):
        if user.role != role and user.role != "admin":
            raise HTTPException(status_code=403, detail=f"Role '{role}' required")
        return user

    return _check


def require_plugin_permission(permission: str):
    async def _check(user: TokenPayload = Depends(get_current_user_from_token)):
        if user.role == "admin":
            return user
        if permission not in user.permissions:
            raise HTTPException(
                status_code=403,
                detail=f"Permission '{permission}' required",
            )
        return user

    return _check


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Optional middleware that injects user info into request.state.

    Unprotected paths (like /health) are skipped.
    """

    SKIP_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if any(path.endswith(p) for p in self.SKIP_PATHS):
            return await call_next(request)

        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            try:
                token = auth_header.split(" ", 1)[1]
                request.state.user = verify_token(token)
            except HTTPException:
                request.state.user = None
        else:
            request.state.user = None

        return await call_next(request)
