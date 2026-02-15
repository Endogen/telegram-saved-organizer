from app.models import Base, Category, Message, MessageTag, Tag


def test_model_tables_are_declared() -> None:
    assert set(Base.metadata.tables) == {"categories", "messages", "message_tags", "tags"}


def test_message_table_columns_and_indexes_match_spec() -> None:
    message_table = Message.__table__
    index_names = {index.name for index in message_table.indexes}

    assert message_table.c.telegram_id.unique is True
    assert message_table.c.date.nullable is False
    assert message_table.c.category_id.nullable is False
    assert message_table.c.raw_data.nullable is False
    assert "ix_messages_telegram_id" in index_names
    assert "ix_messages_category_id_date" in index_names


def test_relationships_and_association_keys_are_defined() -> None:
    association = MessageTag.__table__

    assert Message.category.property.mapper.class_ is Category
    assert Category.messages.property.mapper.class_ is Message
    assert Tag.messages.property.secondary is association
    assert Message.tags.property.secondary is association
    assert set(association.c.keys()) == {"message_id", "tag_id"}
