from sqlalchemy import ForeignKeyConstraint, UniqueConstraint

from app.models import (
    Base,
    Category,
    Message,
    MessageTag,
    ScanJob,
    Tag,
    TelegramConnection,
    User,
    WebSession,
)


def test_model_tables_are_declared() -> None:
    assert set(Base.metadata.tables) == {
        "users",
        "web_sessions",
        "telegram_connections",
        "scan_jobs",
        "scan_stream_slots",
        "categories",
        "messages",
        "message_tags",
        "tags",
        "abuse_rate_limit_buckets",
    }


def test_message_table_columns_and_indexes_match_spec() -> None:
    message_table = Message.__table__
    index_names = {index.name for index in message_table.indexes}

    unique_columns = {
        tuple(column.name for column in constraint.columns)
        for constraint in message_table.constraints
        if isinstance(constraint, UniqueConstraint)
    }

    assert ("user_id", "telegram_user_id", "telegram_id") in unique_columns
    assert message_table.c.telegram_user_id.nullable is True
    assert message_table.c.connection_generation.nullable is True
    assert message_table.c.user_id.nullable is False
    assert message_table.c.date.nullable is False
    assert message_table.c.category_id.nullable is False
    assert message_table.c.raw_data.nullable is False
    assert "ix_messages_user_id_category_id_date" in index_names
    assert "ix_messages_user_id_date_id" in index_names


def test_relationships_and_association_keys_are_defined() -> None:
    association = MessageTag.__table__

    assert Message.category.property.mapper.class_ is Category
    assert Category.messages.property.mapper.class_ is Message
    assert Tag.messages.property.secondary is association
    assert Message.tags.property.secondary is association
    assert set(association.c.keys()) == {"user_id", "message_id", "tag_id"}
    assert set(column.name for column in association.primary_key.columns) == {
        "user_id",
        "message_id",
        "tag_id",
    }
    foreign_key_targets = {
        tuple(element.target_fullname for element in constraint.elements)
        for constraint in association.constraints
        if isinstance(constraint, ForeignKeyConstraint)
    }
    assert foreign_key_targets == {
        ("messages.user_id", "messages.id"),
        ("tags.user_id", "tags.id"),
    }


def test_user_owns_all_security_and_organizer_records() -> None:
    assert WebSession.user.property.mapper.class_ is User
    assert TelegramConnection.user.property.mapper.class_ is User
    assert ScanJob.user.property.mapper.class_ is User
    for model in (Category, Message, Tag):
        user_foreign_key = next(
            foreign_key
            for foreign_key in model.__table__.c.user_id.foreign_keys
            if foreign_key.target_fullname == "users.id"
        )
        assert user_foreign_key.target_fullname == "users.id"
        assert user_foreign_key.ondelete == "CASCADE"
