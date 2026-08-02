"""API routes for tag management."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts.dependencies import get_current_user
from app.database import get_session
from app.identifiers import MAX_DATABASE_INTEGER
from app.models import User
from app.tags.schemas import (
    MessageBulkTagRequest,
    MessageBulkTagResponse,
    MessageTagsResponse,
    MessageTagsUpdateRequest,
    TagCreateRequest,
    TagDeleteResponse,
    TagResponse,
    TagUpdateRequest,
    TagWithCountResponse,
)
from app.tags.service import (
    MessageNotFoundError,
    TagAssignmentNotFoundError,
    TagConflictError,
    TagNotFoundError,
    TagService,
)

router = APIRouter(tags=["tags"])
DatabaseIdentifier = Annotated[int, Path(ge=1, le=MAX_DATABASE_INTEGER)]


async def get_tag_service(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TagService:
    """Dependency provider for tag service."""

    return TagService(session=session, user_id=user.id)


@router.get("/tags", response_model=list[TagWithCountResponse])
async def list_tags(
    service: TagService = Depends(get_tag_service),
) -> list[TagWithCountResponse]:
    tags = await service.list_tags_with_counts()
    return [TagWithCountResponse.from_result(tag) for tag in tags]


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


@router.patch("/tags/{tag_id}", response_model=TagResponse)
async def update_tag(
    tag_id: DatabaseIdentifier,
    payload: TagUpdateRequest,
    service: TagService = Depends(get_tag_service),
) -> TagResponse:
    try:
        tag = await service.update_tag(
            tag_id=tag_id,
            updates=payload.model_dump(exclude_unset=True),
        )
    except TagNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except TagConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TagResponse.model_validate(tag)


@router.delete("/tags/{tag_id}", response_model=TagDeleteResponse)
async def delete_tag(
    tag_id: DatabaseIdentifier,
    service: TagService = Depends(get_tag_service),
) -> TagDeleteResponse:
    try:
        await service.delete_tag(tag_id=tag_id)
    except TagNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except TagConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TagDeleteResponse()


@router.post("/messages/{message_id}/tags", response_model=MessageTagsResponse)
async def add_tags_to_message(
    message_id: DatabaseIdentifier,
    payload: MessageTagsUpdateRequest,
    service: TagService = Depends(get_tag_service),
) -> MessageTagsResponse:
    try:
        tags = await service.add_tags_to_message(message_id=message_id, tag_ids=payload.tag_ids)
    except MessageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except TagNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except TagConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return MessageTagsResponse(message_id=message_id, tags=[TagResponse.model_validate(tag) for tag in tags])


@router.post("/messages/bulk-tags", response_model=MessageBulkTagResponse)
async def bulk_add_tags_to_messages(
    payload: MessageBulkTagRequest,
    service: TagService = Depends(get_tag_service),
) -> MessageBulkTagResponse:
    try:
        result = await service.bulk_add_tags_to_messages(
            message_ids=payload.message_ids,
            tag_ids=payload.tag_ids,
        )
    except MessageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except TagNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except TagConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return MessageBulkTagResponse(
        updated_count=result.updated_count,
        assignment_count=result.assignment_count,
    )


@router.delete("/messages/{message_id}/tags/{tag_id}", response_model=MessageTagsResponse)
async def remove_tag_from_message(
    message_id: DatabaseIdentifier,
    tag_id: DatabaseIdentifier,
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
