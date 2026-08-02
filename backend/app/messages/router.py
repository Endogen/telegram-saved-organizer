"""API routes for message CRUD operations."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts.dependencies import get_current_user
from app.database import get_session
from app.models import User
from app.messages.schemas import (
    MessageBulkDeleteRequest,
    MessageBulkDeleteResponse,
    MessageBulkMoveRequest,
    MessageBulkMoveResponse,
    MessageClearResponse,
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
from app.telegram.client import (
    TelegramClientNotConnectedError,
    TelegramMessageDeleteError,
    TelegramMessageProvenanceError,
)

router = APIRouter(prefix="/messages", tags=["messages"])


async def get_message_service(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MessageService:
    """Dependency provider for message service."""

    return MessageService(session=session, user_id=user.id)


@router.get("", response_model=MessageListResponse)
async def list_messages(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    sort: MessageSort = Query(default=MessageSort.DATE_DESC),
    category: str | None = Query(default=None, min_length=1),
    tag: list[str] | None = Query(default=None, max_length=20),
    search: str | None = Query(default=None, max_length=500),
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


@router.post("/bulk-delete", response_model=MessageBulkDeleteResponse)
async def bulk_delete_messages(
    payload: MessageBulkDeleteRequest,
    local_only: bool = Query(default=False),
    service: MessageService = Depends(get_message_service),
) -> MessageBulkDeleteResponse:
    try:
        deleted_count = await service.bulk_delete_messages(
            message_ids=payload.message_ids, local_only=local_only,
        )
    except MessageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except TelegramClientNotConnectedError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="telegram_not_connected") from exc
    except TelegramMessageProvenanceError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="telegram_connection_changed",
        ) from exc
    except TelegramMessageDeleteError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return MessageBulkDeleteResponse(deleted_count=deleted_count)


@router.post("/bulk-move", response_model=MessageBulkMoveResponse)
async def bulk_move_messages(
    payload: MessageBulkMoveRequest,
    service: MessageService = Depends(get_message_service),
) -> MessageBulkMoveResponse:
    try:
        moved_count = await service.bulk_move_messages(
            message_ids=payload.message_ids,
            category_id=payload.category_id,
        )
    except MessageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except CategoryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return MessageBulkMoveResponse(moved_count=moved_count, category_id=payload.category_id)


@router.post("/clear", response_model=MessageClearResponse)
async def clear_all_messages(
    service: MessageService = Depends(get_message_service),
) -> MessageClearResponse:
    cleared_count = await service.clear_all_messages()
    return MessageClearResponse(cleared_count=cleared_count)


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
    local_only: bool = Query(default=False),
    service: MessageService = Depends(get_message_service),
) -> MessageDeleteResponse:
    try:
        await service.delete_message(message_id=message_id, local_only=local_only)
    except MessageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except TelegramClientNotConnectedError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="telegram_not_connected") from exc
    except TelegramMessageProvenanceError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="telegram_connection_changed",
        ) from exc
    except TelegramMessageDeleteError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return MessageDeleteResponse()
