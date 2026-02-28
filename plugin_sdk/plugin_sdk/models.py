"""
Standard response models that all plugins should use for consistency.
"""

from pydantic import BaseModel
from typing import Generic, TypeVar

T = TypeVar("T")


class StandardResponse(BaseModel, Generic[T]):
    success: bool = True
    data: T | None = None
    message: str | None = None


class PaginatedResponse(BaseModel, Generic[T]):
    success: bool = True
    data: list[T] = []
    total: int = 0
    page: int = 1
    page_size: int = 20
    total_pages: int = 0


class ErrorResponse(BaseModel):
    success: bool = False
    detail: str
    error_code: str | None = None
