"""API routes for category management."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts.dependencies import get_current_user
from app.categories.schemas import (
    CategoryCreateRequest,
    CategoryDeleteResponse,
    CategoryResponse,
    CategoryUpdateRequest,
    CategoryWithCountResponse,
)
from app.categories.service import (
    CategoryConflictError,
    CategoryNotFoundError,
    CategoryProtectedError,
    CategoryService,
)
from app.database import get_session
from app.models import User

router = APIRouter(prefix="/categories", tags=["categories"])
MAX_DB_IDENTIFIER = 2**63 - 1
CategoryIdentifier = Annotated[int, Path(ge=1, le=MAX_DB_IDENTIFIER)]


async def get_category_service(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> CategoryService:
    """Dependency provider for category service."""

    return CategoryService(session=session, user_id=user.id)


@router.get("", response_model=list[CategoryWithCountResponse])
async def list_categories(
    service: CategoryService = Depends(get_category_service),
) -> list[CategoryWithCountResponse]:
    categories = await service.list_categories()
    return [CategoryWithCountResponse.from_result(category) for category in categories]


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(
    payload: CategoryCreateRequest,
    service: CategoryService = Depends(get_category_service),
) -> CategoryResponse:
    try:
        category = await service.create_category(**payload.model_dump())
    except CategoryConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return CategoryResponse.model_validate(category)


@router.patch("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: CategoryIdentifier,
    payload: CategoryUpdateRequest,
    service: CategoryService = Depends(get_category_service),
) -> CategoryResponse:
    try:
        category = await service.update_category(
            category_id=category_id,
            updates=payload.model_dump(exclude_unset=True),
        )
    except CategoryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except CategoryConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return CategoryResponse.model_validate(category)


@router.delete("/{category_id}", response_model=CategoryDeleteResponse)
async def delete_category(
    category_id: CategoryIdentifier,
    service: CategoryService = Depends(get_category_service),
) -> CategoryDeleteResponse:
    try:
        result = await service.delete_category(category_id=category_id)
    except CategoryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except CategoryProtectedError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return CategoryDeleteResponse.from_result(result)
