"""API routes for message CRUD operations."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.messages.schemas import (
    MessageDeleteResponse,
    MessageListResponse,
    MessageResponse,
    MessageUpdateRequest,
)
from app.messages.service import (
    CategoryNotFoundError,
    MessageNotFoundError,
    MessageService,
    MessageSort,
)

router = APIRouter(prefix="/messages", tags=["messages"])


async def get_message_service(session: AsyncSession = Depends(get_session)) -> MessageService:
    """Dependency provider for message service."""

    return MessageService(session=session)


@router.get("", response_model=MessageListResponse)
async def list_messages(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    sort: MessageSort = Query(default=MessageSort.DATE_DESC),
    category: str | None = Query(default=None, min_length=1),
    tag: list[str] | None = Query(default=None),
    search: str | None = Query(default=None),
    service: MessageService = Depends(get_message_service),
) -> MessageListResponse:
    try:
        result = await service.list_messages(
            page=page,
            per_page=per_page,
            sort=sort,
            category_slug=category,
            tag_names=tag,
            search=search,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return MessageListResponse.from_result(result)


@router.get("/{message_id}", response_model=MessageResponse)
async def get_message(
    message_id: int,
    service: MessageService = Depends(get_message_service),
) -> MessageResponse:
    try:
        message = await service.get_message(message_id=message_id)
    except MessageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return MessageResponse.model_validate(message)


@router.patch("/{message_id}", response_model=MessageResponse)
async def update_message(
    message_id: int,
    payload: MessageUpdateRequest,
    service: MessageService = Depends(get_message_service),
) -> MessageResponse:
    try:
        message = await service.update_message(
            message_id=message_id,
            updates=payload.model_dump(exclude_unset=True),
        )
    except MessageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except CategoryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return MessageResponse.model_validate(message)


@router.delete("/{message_id}", response_model=MessageDeleteResponse)
async def delete_message(
    message_id: int,
    service: MessageService = Depends(get_message_service),
) -> MessageDeleteResponse:
    try:
        await service.delete_message(message_id=message_id)
    except MessageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return MessageDeleteResponse()
