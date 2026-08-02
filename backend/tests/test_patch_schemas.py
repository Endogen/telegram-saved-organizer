from __future__ import annotations

from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from app.accounts.schemas import AccountUpdateRequest
from app.categories.schemas import CategoryUpdateRequest
from app.messages.schemas import MessageUpdateRequest
from app.tags.schemas import TagUpdateRequest


@pytest.mark.parametrize(
    ("schema", "payload"),
    [
        (AccountUpdateRequest, {"display_name": None}),
        (CategoryUpdateRequest, {"name": None}),
        (CategoryUpdateRequest, {"icon": None}),
        (CategoryUpdateRequest, {"color": None}),
        (CategoryUpdateRequest, {"position": None}),
        (TagUpdateRequest, {"name": None}),
        (MessageUpdateRequest, {"category_id": None}),
    ],
)
def test_patch_schemas_reject_null_for_non_nullable_fields(
    schema: type[BaseModel],
    payload: dict[str, Any],
) -> None:
    with pytest.raises(ValidationError):
        schema.model_validate(payload)


def test_patch_schemas_preserve_intentional_nullable_clears() -> None:
    tag_update = TagUpdateRequest.model_validate({"color": None})
    message_update = MessageUpdateRequest.model_validate({"content": None})

    assert tag_update.model_dump(exclude_unset=True) == {"color": None}
    assert message_update.model_dump(exclude_unset=True) == {"content": None}


def test_patch_schemas_still_allow_other_fields_to_be_omitted() -> None:
    category_update = CategoryUpdateRequest.model_validate({"name": "Renamed"})
    message_update = MessageUpdateRequest.model_validate({"category_id": 7})

    assert category_update.model_dump(exclude_unset=True) == {"name": "Renamed"}
    assert message_update.model_dump(exclude_unset=True) == {"category_id": 7}
