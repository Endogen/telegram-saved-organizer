"""SQLAlchemy ORM models for application identity and tenant-owned data."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    MetaData,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def new_uuid() -> str:
    """Return a database-portable UUID string."""

    return str(uuid4())


model_metadata = MetaData(
    naming_convention={
        "ix": "ix_%(table_name)s_%(column_0_N_name)s",
        "uq": "uq_%(table_name)s_%(column_0_N_name)s",
        "ck": "ck_%(table_name)s_%(constraint_name)s",
        "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
        "pk": "pk_%(table_name)s",
    }
)


class Base(DeclarativeBase):
    """Base class for all ORM models."""

    metadata = model_metadata


class AbuseRateLimitBucket(Base):
    """One shared fixed-window counter with a non-identifying subject key."""

    __tablename__ = "abuse_rate_limit_buckets"
    __table_args__ = (
        CheckConstraint("hit_count >= 1", name="hit_count_positive"),
        Index("ix_abuse_rate_limit_buckets_expires_at", "expires_at"),
    )

    scope: Mapped[str] = mapped_column(String(48), primary_key=True)
    subject_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        primary_key=True,
    )
    hit_count: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )


class User(Base):
    """Application account which owns all organizer data."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("failed_login_attempts >= 0", name="failed_login_attempts_non_negative"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    normalized_email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    web_sessions: Mapped[list[WebSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    telegram_connection: Mapped[TelegramConnection | None] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True, uselist=False
    )
    scan_jobs: Mapped[list[ScanJob]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )


class WebSession(Base):
    """Revocable application session backed by an opaque token hash."""

    __tablename__ = "web_sessions"
    __table_args__ = (
        Index("ix_web_sessions_user_id_revoked_at", "user_id", "revoked_at"),
        Index("ix_web_sessions_expires_at", "expires_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    csrf_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    rotated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    idle_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="web_sessions")


class TelegramConnection(Base):
    """A user's encrypted Telegram authorization and challenge state."""

    __tablename__ = "telegram_connections"
    __table_args__ = (
        CheckConstraint(
            "state IN ('disconnected', 'pending', 'connected', 'error')",
            name="valid_state",
        ),
        CheckConstraint("generation >= 0", name="generation_non_negative"),
        UniqueConstraint("user_id", "id", name="uq_telegram_connections_user_id_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    telegram_user_id: Mapped[int | None] = mapped_column(BigInteger, unique=True, nullable=True)
    phone_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    state: Mapped[str] = mapped_column(String(24), nullable=False, default="disconnected")
    pending_phone_code_hash_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    pending_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    password_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    generation: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="telegram_connection")


class ScanJob(Base):
    """Durable per-user Telegram scan state."""

    __tablename__ = "scan_jobs"
    __table_args__ = (
        CheckConstraint(
            "state IN ('pending', 'running', 'stopping', 'completed', 'failed', 'cancelled')",
            name="valid_state",
        ),
        CheckConstraint("messages_scanned >= 0", name="messages_scanned_non_negative"),
        CheckConstraint("pages_scanned >= 0", name="pages_scanned_non_negative"),
        CheckConstraint("page_size > 0", name="page_size_positive"),
        CheckConstraint("max_messages > 0", name="max_messages_positive"),
        CheckConstraint(
            "max_runtime_seconds > 0",
            name="max_runtime_seconds_positive",
        ),
        CheckConstraint(
            "completion_reason IS NULL OR completion_reason IN "
            "('source_exhausted', 'message_limit_reached', "
            "'runtime_limit_reached', 'stopped_by_user')",
            name="completion_reason_valid",
        ),
        CheckConstraint(
            "(telegram_user_id IS NULL AND connection_generation IS NULL) OR "
            "(telegram_user_id IS NOT NULL AND connection_generation IS NOT NULL)",
            name="provenance_complete",
        ),
        CheckConstraint(
            "connection_generation IS NULL OR connection_generation >= 0",
            name="connection_generation_non_negative",
        ),
        Index("ix_scan_jobs_user_id_created_at", "user_id", "created_at"),
        Index("ix_scan_jobs_state_created_at", "state", "created_at"),
        Index(
            "ix_scan_jobs_state_lease_expires_created_at",
            "state",
            "lease_expires_at",
            "created_at",
        ),
        Index(
            "ix_scan_jobs_state_heartbeat_created_at",
            "state",
            "heartbeat_at",
            "created_at",
        ),
        Index(
            "uq_scan_jobs_user_id_active",
            "user_id",
            unique=True,
            postgresql_where=text("state IN ('pending', 'running', 'stopping')"),
            sqlite_where=text("state IN ('pending', 'running', 'stopping')"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    state: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    stop_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    replace_existing: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    messages_scanned: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pages_scanned: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    page_size: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    max_messages: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=10_000,
        server_default=text("10000"),
    )
    max_runtime_seconds: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=3_600,
        server_default=text("3600"),
    )
    completion_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    telegram_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    connection_generation: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    lease_owner: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="scan_jobs")


class ScanStreamSlot(Base):
    """Durable per-user concurrency slot for scan status streams."""

    __tablename__ = "scan_stream_slots"
    __table_args__ = (
        CheckConstraint("slot >= 0", name="slot_non_negative"),
        Index("ix_scan_stream_slots_lease_expires_at", "lease_expires_at"),
    )

    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    slot: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner: Mapped[str] = mapped_column(String(64), nullable=False)
    lease_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )


class Category(Base):
    """User-owned message category."""

    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint("user_id", "id", name="uq_categories_user_id_id"),
        UniqueConstraint("user_id", "slug", name="uq_categories_user_id_slug"),
        UniqueConstraint("user_id", "normalized_name", name="uq_categories_user_id_normalized_name"),
        UniqueConstraint("user_id", "system_key", name="uq_categories_user_id_system_key"),
        Index("ix_categories_user_id_position_id", "user_id", "position", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    system_key: Mapped[str | None] = mapped_column(String(50), nullable=True)
    icon: Mapped[str] = mapped_column(String(50), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    messages: Mapped[list[Message]] = relationship(back_populates="category")


class Message(Base):
    """User-owned cached Telegram Saved Message."""

    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint("user_id", "id", name="uq_messages_user_id_id"),
        UniqueConstraint(
            "user_id",
            "telegram_user_id",
            "telegram_id",
            name="uq_messages_user_id_telegram_user_id_telegram_id",
        ),
        CheckConstraint(
            "(telegram_user_id IS NULL AND connection_generation IS NULL) OR "
            "(telegram_user_id IS NOT NULL AND connection_generation IS NOT NULL)",
            name="provenance_complete",
        ),
        CheckConstraint(
            "connection_generation IS NULL OR connection_generation >= 0",
            name="connection_generation_non_negative",
        ),
        ForeignKeyConstraint(
            ("user_id", "category_id"),
            ("categories.user_id", "categories.id"),
            name="fk_messages_user_id_category_id_categories",
            ondelete="RESTRICT",
        ),
        Index("ix_messages_user_id_category_id_date", "user_id", "category_id", "date"),
        Index("ix_messages_user_id_date_id", "user_id", "date", "id"),
        Index(
            "ix_messages_user_id_last_seen_replacement_job_id",
            "user_id",
            "last_seen_replacement_job_id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    telegram_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    telegram_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    connection_generation: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_seen_replacement_job_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("scan_jobs.id", ondelete="SET NULL"),
        nullable=True,
    )
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    media_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    sender_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    category_id: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_data: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    category: Mapped[Category] = relationship(back_populates="messages")
    tags: Mapped[list[Tag]] = relationship(
        secondary="message_tags",
        primaryjoin="and_(Message.user_id == MessageTag.user_id, Message.id == MessageTag.message_id)",
        secondaryjoin="and_(Tag.user_id == MessageTag.user_id, Tag.id == MessageTag.tag_id)",
        back_populates="messages",
        viewonly=True,
    )


class Tag(Base):
    """User-owned custom label for messages."""

    __tablename__ = "tags"
    __table_args__ = (
        UniqueConstraint("user_id", "id", name="uq_tags_user_id_id"),
        UniqueConstraint("user_id", "normalized_name", name="uq_tags_user_id_normalized_name"),
        Index("ix_tags_user_id_normalized_name", "user_id", "normalized_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)

    messages: Mapped[list[Message]] = relationship(
        secondary="message_tags",
        primaryjoin="and_(Tag.user_id == MessageTag.user_id, Tag.id == MessageTag.tag_id)",
        secondaryjoin="and_(Message.user_id == MessageTag.user_id, Message.id == MessageTag.message_id)",
        back_populates="tags",
        viewonly=True,
    )


class MessageTag(Base):
    """Tenant-safe association between a message and tag."""

    __tablename__ = "message_tags"
    __table_args__ = (
        ForeignKeyConstraint(
            ("user_id", "message_id"),
            ("messages.user_id", "messages.id"),
            name="fk_message_tags_user_id_message_id_messages",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ("user_id", "tag_id"),
            ("tags.user_id", "tags.id"),
            name="fk_message_tags_user_id_tag_id_tags",
            ondelete="CASCADE",
        ),
    )

    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    message_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tag_id: Mapped[int] = mapped_column(Integer, primary_key=True)
