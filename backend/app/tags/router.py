"""API routes for tag management."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts.dependencies import get_current_user
from app.database import get_session
from app.models import User
from app.tags.schemas import (
    MessageTagsResponse,
    MessageTagsUpdateRequest,
    TagCreateRequest,
    TagDeleteResponse,
    TagResponse,
)
from app.tags.service import (
    MessageNotFoundError,
    TagAssignmentNotFoundError,
    TagConflictError,
    TagNotFoundError,
    TagService,
)

router = APIRouter(tags=["tags"])


async def get_tag_service(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TagService:
    """Dependency provider for tag service."""

    return TagService(session=session, user_id=user.id)


@router.get("/tags", response_model=list[TagResponse])
async def list_tags(service: TagService = Depends(get_tag_service)) -> list[TagResponse]:
    tags = await service.list_tags()
    return [TagResponse.model_validate(tag) for tag in tags]


@router.post("/tags", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
async def create_tag(
    payload: TagCreateRequest,
    service: TagService = Depends(get_tag_service),
) -> TagResponse:
    try:
        tag = await service.create_tag(**payload.model_dump())
    except TagConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TagResponse.model_validate(tag)


@router.delete("/tags/{tag_id}", response_model=TagDeleteResponse)
async def delete_tag(
    tag_id: int,
    service: TagService = Depends(get_tag_service),
) -> TagDeleteResponse:
    try:
        await service.delete_tag(tag_id=tag_id)
    except TagNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TagDeleteResponse()


@router.post("/messages/{message_id}/tags", response_model=MessageTagsResponse)
async def add_tags_to_message(
    message_id: int,
    payload: MessageTagsUpdateRequest,
    service: TagService = Depends(get_tag_service),
) -> MessageTagsResponse:
    try:
        tags = await service.add_tags_to_message(message_id=message_id, tag_ids=payload.tag_ids)
    except MessageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except TagNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return MessageTagsResponse(message_id=message_id, tags=[TagResponse.model_validate(tag) for tag in tags])


@router.delete("/messages/{message_id}/tags/{tag_id}", response_model=MessageTagsResponse)
async def remove_tag_from_message(
    message_id: int,
    tag_id: int,
    service: TagService = Depends(get_tag_service),
) -> MessageTagsResponse:
    try:
        tags = await service.remove_tag_from_message(message_id=message_id, tag_id=tag_id)
    except MessageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except TagNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except TagAssignmentNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return MessageTagsResponse(message_id=message_id, tags=[TagResponse.model_validate(tag) for tag in tags])
