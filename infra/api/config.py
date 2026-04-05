"""Centralized configuration management using Pydantic Settings.

This module provides typed configuration for all application settings,
loaded from environment variables with sensible defaults.

Usage:
    from api.config import get_settings
    settings = get_settings()
    redis_host = settings.redis.host
"""

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class RedisSettings(BaseSettings):
    """Redis connection configuration."""

    model_config = SettingsConfigDict(env_prefix="REDIS_", extra="ignore")

    host: str = Field(default="redis", description="Redis host")
    port: int = Field(default=6379, description="Redis port")
    password: str = Field(default="", description="Redis password")
    max_connections: int = Field(default=200, description="Maximum pool connections")
    pool_timeout_sec: float = Field(default=5.0, description="Pool timeout in seconds")
    health_check_interval: int = Field(default=30, description="Health check interval in seconds")
    retry_on_timeout: bool = Field(default=True, description="Retry on timeout")
    socket_timeout: float = Field(default=5.0, description="Socket timeout in seconds")
    socket_connect_timeout: float = Field(
        default=5.0, description="Socket connect timeout in seconds"
    )
    # Connection lifecycle settings for leak prevention
    cleanup_interval_sec: int = Field(
        default=60, description="Interval for connection pool cleanup task"
    )
    pubsub_max_idle_sec: float = Field(
        default=300.0, description="Max idle time for pubsub before forced cleanup (5 min)"
    )
    pubsub_max_lifetime_sec: float = Field(
        default=3600.0, description="Max lifetime for pubsub connections (1 hour)"
    )
    pubsub_cleanup_timeout_sec: float = Field(
        default=5.0, description="Timeout for pubsub cleanup operations"
    )


class PostgresSettings(BaseSettings):
    """PostgreSQL connection configuration."""

    model_config = SettingsConfigDict(
        env_prefix="POSTGRES_",
        extra="ignore",
        populate_by_name=True,
    )

    host: str = Field(default="postgres", description="PostgreSQL host")
    port: int = Field(default=5432, description="PostgreSQL port")
    user: str = Field(default="devuser", description="PostgreSQL user")
    password: str = Field(default="", description="PostgreSQL password")
    database: str = Field(
        default="devdb",
        validation_alias="POSTGRES_DB",
        description="Database name",
    )
    pool_min_size: int = Field(default=2, description="Minimum pool size")
    pool_max_size: int = Field(default=10, description="Maximum pool size")
    pool_timeout: int = Field(default=30, description="Timeout for acquiring connections")
    pool_max_lifetime: int = Field(
        default=1800, description="Maximum connection lifetime in seconds"
    )
    pool_max_idle: int = Field(
        default=300, description="Maximum idle time before closing connection"
    )
    pool_reconnect_timeout: int = Field(default=300, description="Reconnection timeout in seconds")

    def get_dsn(self) -> str:
        """Generate PostgreSQL DSN connection string."""
        return (
            f"host={self.host} port={self.port} user={self.user} "
            f"password={self.password} dbname={self.database} sslmode=disable"
        )


class AgentSettings(BaseSettings):
    """AI agent configuration."""

    model_config = SettingsConfigDict(env_prefix="AGENT_", extra="ignore")

    count: int = Field(default=5, alias="agents", description="Number of agents")
    min_sleep_sec: int = Field(default=30, description="Minimum sleep between checks")
    max_sleep_sec: int = Field(default=120, description="Maximum sleep between checks")
    wake_probability: float = Field(
        default=0.2, alias="wake_prob", description="Probability of waking"
    )
    wake_cooldown_sec: int = Field(default=45, description="Cooldown after wake")
    debug: bool = Field(default=False, description="Enable agent debug mode")
    log_level: str = Field(default="INFO", description="Agent log level")

    @field_validator("debug", mode="before")
    @classmethod
    def parse_debug(cls, v):
        if isinstance(v, str):
            return v.lower() in ("1", "true", "yes")
        return bool(v)


class CorsSettings(BaseSettings):
    """CORS configuration."""

    model_config = SettingsConfigDict(extra="ignore", populate_by_name=True)

    origins_raw: str = Field(
        default="http://localhost:3000",
        validation_alias="CORS_ORIGINS",
    )
    origins_regex: str = Field(
        default="",
        validation_alias="CORS_ORIGINS_REGEX",
        description="Regex pattern for origins",
    )

    @property
    def origins(self) -> list[str]:
        """Parse comma-separated origins into list."""
        return [o.strip() for o in self.origins_raw.split(",") if o.strip()]

    @property
    def allow_credentials(self) -> bool:
        """Credentials not allowed with wildcard origins."""
        return self.origins != ["*"] and not self.origins_regex


class DebugSettings(BaseSettings):
    """Debug flags configuration."""

    model_config = SettingsConfigDict(extra="ignore")

    request: bool = Field(default=False, alias="request_debug")
    websocket: bool = Field(default=False, alias="ws_debug")
    redis: bool = Field(default=False, alias="redis_debug")
    agent: bool = Field(default=False, alias="agent_debug")

    @field_validator("*", mode="before")
    @classmethod
    def parse_bool(cls, v):
        if isinstance(v, str):
            return v.lower() in ("1", "true", "yes")
        return bool(v)


class FeatureSettings(BaseSettings):
    """Feature flags configuration."""

    model_config = SettingsConfigDict(extra="ignore")

    chat_db: bool = Field(default=False, alias="enable_chat_db")
    agent: bool = Field(default=False, alias="enable_agent")
    analytics_scheduler: bool = Field(default=True, alias="enable_analytics_scheduler")
    augment_agent: bool = Field(default=True, alias="enable_augment_agent")
    notes_sync: bool = Field(default=True, alias="notes_sync_enabled")

    @field_validator("*", mode="before")
    @classmethod
    def parse_bool(cls, v):
        if isinstance(v, str):
            return v.lower() in ("1", "true", "yes")
        return bool(v)


class SandboxSettings(BaseSettings):
    """Python sandbox configuration."""

    model_config = SettingsConfigDict(env_prefix="SANDBOX_", extra="ignore")

    enabled: bool = Field(default=True, description="Enable sandbox")
    image: str = Field(default="devstack-python-sandbox:latest")
    timeout_sec: int = Field(default=30, description="Execution timeout")
    memory_limit: str = Field(default="128m", description="Memory limit")
    cpu_limit: float = Field(default=0.5, description="CPU limit")

    @field_validator("enabled", mode="before")
    @classmethod
    def parse_enabled(cls, v):
        if isinstance(v, str):
            return v.lower() in ("1", "true", "yes")
        return bool(v)


class GeoIPSettings(BaseSettings):
    """GeoIP configuration."""

    model_config = SettingsConfigDict(extra="ignore")

    db_path: str = Field(default="/app/GeoLite2-City.mmdb", alias="geoip_db_path")


class AugmentAgentSettings(BaseSettings):
    """Augment AI agent configuration."""

    model_config = SettingsConfigDict(env_prefix="AUGMENT_AGENT_", extra="ignore")

    sender: str = Field(default="agent:augment", description="Agent sender name")
    channels: str = Field(default="general", description="Comma-separated channels")
    min_sleep_sec: int = Field(default=10800, description="Minimum sleep")
    max_sleep_sec: int = Field(default=10800, description="Maximum sleep")
    history_token_limit: int = Field(default=10000, description="History token limit")
    model: str = Field(default="sonnet4.5", description="Model name")
    global_cooldown_sec: float = Field(default=120, description="Global cooldown")

    @property
    def channel_list(self) -> list[str]:
        """Parse comma-separated channels into list."""
        return [c.strip() for c in self.channels.split(",") if c.strip()]


class NotesSyncSettings(BaseSettings):
    """Notes sync configuration."""

    model_config = SettingsConfigDict(extra="ignore")

    secret: str = Field(default="", alias="notes_sync_secret")
    github_token: str = Field(default="", alias="github_token")


class Settings:
    """Main application settings combining all configuration sections.

    This is not a BaseSettings subclass to avoid env var conflicts.
    Each subsetting is loaded independently with its own prefix.

    Usage:
        settings = Settings()
        # or use cached singleton:
        settings = get_settings()
    """

    def __init__(self) -> None:
        self.redis = RedisSettings()
        self.postgres = PostgresSettings()
        self.agent = AgentSettings()
        self.cors = CorsSettings()
        self.debug = DebugSettings()
        self.features = FeatureSettings()
        self.sandbox = SandboxSettings()
        self.geoip = GeoIPSettings()
        self.augment_agent = AugmentAgentSettings()
        self.notes_sync = NotesSyncSettings()


@lru_cache
def get_settings() -> Settings:
    """Get cached Settings instance (singleton pattern)."""
    return Settings()


def clear_settings_cache() -> None:
    """Clear cached settings (useful for testing)."""
    get_settings.cache_clear()
