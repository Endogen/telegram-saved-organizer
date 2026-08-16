from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import AsyncIterator

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.categories.service import CategoryNotFoundError, CategoryService
from app.database import _configure_sqlite_connection
from app.messages.service import MessageKind, MessageNotFoundError, MessageService
from app.models import Base, Category, Message, MessageTag, Tag, User
from app.tags.service import MessageNotFoundError as TagMessageNotFoundError
from app.tags.service import TagNotFoundError, TagService


@asynccontextmanager
async def isolated_session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    event.listen(engine.sync_engine, "connect", _configure_sqlite_connection)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as session:
            yield session
    finally:
        await engine.dispose()


def build_user(*, user_id: str, email: str) -> User:
    return User(
        id=user_id,
        email=email,
        normalized_email=email.casefold(),
        display_name=email.split("@", maxsplit=1)[0],
        password_hash="test-password-hash",
    )


def build_category(*, user_id: str, name: str = "Inbox", slug: str = "inbox") -> Category:
    return Category(
        user_id=user_id,
        name=name,
        normalized_name=name.casefold(),
        slug=slug,
        icon="archive",
        color="#64748B",
        position=1,
        is_default=False,
    )


def build_tag(*, user_id: str, name: str = "Important") -> Tag:
    return Tag(
        user_id=user_id,
        name=name,
        normalized_name=name.casefold(),
        color=None,
    )


def build_message(*, user_id: str, category_id: int, telegram_id: int = 1001) -> Message:
    return Message(
        user_id=user_id,
        telegram_id=telegram_id,
        content=f"message for {user_id}",
        date=datetime.now(tz=UTC),
        category_id=category_id,
        raw_data={},
    )


@pytest.mark.asyncio
async def test_duplicate_tenant_relative_values_are_allowed_and_services_are_isolated() -> None:
    async with isolated_session() as session:
        first_user = build_user(user_id="00000000-0000-0000-0000-000000000001", email="one@example.com")
        second_user = build_user(user_id="00000000-0000-0000-0000-000000000002", email="two@example.com")
        session.add_all([first_user, second_user])
        await session.flush()

        first_category = build_category(user_id=first_user.id)
        second_category = build_category(user_id=second_user.id)
        first_tag = build_tag(user_id=first_user.id)
        second_tag = build_tag(user_id=second_user.id)
        session.add_all([first_category, second_category, first_tag, second_tag])
        await session.flush()

        first_message = build_message(user_id=first_user.id, category_id=first_category.id)
        second_message = build_message(user_id=second_user.id, category_id=second_category.id)
        session.add_all([first_message, second_message])
        await session.flush()
        session.add_all([
            MessageTag(user_id=first_user.id, message_id=first_message.id, tag_id=first_tag.id),
            MessageTag(user_id=second_user.id, message_id=second_message.id, tag_id=second_tag.id),
        ])
        await session.commit()

        first_messages = MessageService(session=session, user_id=first_user.id)
        second_messages = MessageService(session=session, user_id=second_user.id)
        first_categories = CategoryService(session=session, user_id=first_user.id)
        first_tags = TagService(session=session, user_id=first_user.id)

        assert [item.id for item in (await first_messages.list_messages()).items] == [first_message.id]
        assert [item.id for item in (await second_messages.list_messages()).items] == [second_message.id]
        assert [item.category.id for item in await first_categories.list_categories()] == [first_category.id]
        assert [tag.id for tag in await first_tags.list_tags()] == [first_tag.id]

        with pytest.raises(MessageNotFoundError):
            await first_messages.get_message(message_id=second_message.id)
        with pytest.raises(CategoryNotFoundError):
            await first_categories.update_category(
                category_id=second_category.id,
                updates={"name": "Stolen"},
            )
        with pytest.raises(TagNotFoundError):
            await first_tags.delete_tag(tag_id=second_tag.id)
        with pytest.raises(TagNotFoundError):
            await first_tags.update_tag(tag_id=second_tag.id, updates={"name": "Stolen"})
        with pytest.raises(TagMessageNotFoundError):
            await first_tags.add_tags_to_message(
                message_id=second_message.id,
                tag_ids=[first_tag.id],
            )
        with pytest.raises(TagMessageNotFoundError):
            await first_tags.bulk_add_tags_to_messages(
                message_ids=[first_message.id, second_message.id],
                tag_ids=[first_tag.id],
            )
        with pytest.raises(TagNotFoundError):
            await first_tags.bulk_add_tags_to_messages(
                message_ids=[first_message.id],
                tag_ids=[first_tag.id, second_tag.id],
            )

        unchanged_links = list(
            await session.scalars(
                select(MessageTag).order_by(MessageTag.user_id, MessageTag.message_id)
            )
        )
        assert [
            (link.user_id, link.message_id, link.tag_id) for link in unchanged_links
        ] == [
            (first_user.id, first_message.id, first_tag.id),
            (second_user.id, second_message.id, second_tag.id),
        ]

        assert await first_messages.clear_all_messages() == 1
        remaining_message_ids = list(await session.scalars(select(Message.id)))
        remaining_links = list(await session.scalars(select(MessageTag)))
        assert remaining_message_ids == [second_message.id]
        assert [(link.user_id, link.message_id, link.tag_id) for link in remaining_links] == [
            (second_user.id, second_message.id, second_tag.id)
        ]


@pytest.mark.asyncio
async def test_message_kind_filters_are_exclusive_and_category_independent() -> None:
    async with isolated_session() as session:
        user = build_user(
            user_id="00000000-0000-0000-0000-000000000001",
            email="filters@example.com",
        )
        session.add(user)
        await session.flush()
        category = build_category(user_id=user.id)
        session.add(category)
        await session.flush()

        shared = {
            "user_id": user.id,
            "date": datetime.now(tz=UTC),
            "category_id": category.id,
            "raw_data": {},
        }
        messages = {
            MessageKind.TEXT: Message(telegram_id=2001, content="A note", **shared),
            MessageKind.LINK: Message(
                telegram_id=2002,
                content="A useful link",
                url="https://example.com",
                **shared,
            ),
            MessageKind.IMAGE: Message(telegram_id=2003, media_type="photo", **shared),
            MessageKind.AUDIO: Message(
                telegram_id=2004,
                media_type="voice",
                mime_type="audio/ogg",
                **shared,
            ),
            MessageKind.VIDEO: Message(telegram_id=2005, media_type="video", **shared),
            MessageKind.DOCUMENT: Message(
                telegram_id=2006,
                media_type="document",
                mime_type="application/pdf",
                **shared,
            ),
            MessageKind.MIXED: Message(
                telegram_id=2007,
                content="Photo caption",
                media_type="photo",
                **shared,
            ),
            MessageKind.OTHER: Message(telegram_id=2008, media_type="sticker", **shared),
        }
        session.add_all(messages.values())
        await session.commit()

        service = MessageService(session=session, user_id=user.id)
        for message_kind, expected_message in messages.items():
            result = await service.list_messages(message_kind=message_kind)
            assert [item.id for item in result.items] == [expected_message.id]


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid_link", ["message_category", "message_tag"])
async def test_composite_foreign_keys_reject_cross_tenant_links(invalid_link: str) -> None:
    async with isolated_session() as session:
        first_user = build_user(user_id="00000000-0000-0000-0000-000000000001", email="one@example.com")
        second_user = build_user(user_id="00000000-0000-0000-0000-000000000002", email="two@example.com")
        session.add_all([first_user, second_user])
        await session.flush()

        first_category = build_category(user_id=first_user.id)
        second_category = build_category(user_id=second_user.id)
        second_tag = build_tag(user_id=second_user.id)
        session.add_all([first_category, second_category, second_tag])
        await session.flush()

        if invalid_link == "message_category":
            session.add(build_message(user_id=first_user.id, category_id=second_category.id))
        else:
            first_message = build_message(user_id=first_user.id, category_id=first_category.id)
            session.add(first_message)
            await session.flush()
            session.add(
                MessageTag(
                    user_id=first_user.id,
                    message_id=first_message.id,
                    tag_id=second_tag.id,
                )
            )

        with pytest.raises(IntegrityError):
            await session.commit()
