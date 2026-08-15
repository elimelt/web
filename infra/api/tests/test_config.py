"""Tests for centralized configuration module (TDD - Issue #8)."""

import os
from unittest.mock import patch


class TestRedisSettings:
    """Test Redis configuration settings."""

    def test_redis_default_values(self):
        """Test Redis settings have sensible defaults."""
        from api.config import RedisSettings

        with patch.dict(os.environ, {}, clear=True):
            settings = RedisSettings()
            assert settings.host == "redis"
            assert settings.port == 6379
            assert settings.password == ""
            assert settings.max_connections == 200
            assert settings.pool_timeout_sec == 5.0

    def test_redis_from_environment(self):
        """Test Redis settings can be loaded from environment."""
        from api.config import RedisSettings

        env = {
            "REDIS_HOST": "custom-redis",
            "REDIS_PORT": "6380",
            "REDIS_PASSWORD": "secret123",
            "REDIS_MAX_CONNECTIONS": "100",
            "REDIS_POOL_TIMEOUT_SEC": "10",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = RedisSettings()
            assert settings.host == "custom-redis"
            assert settings.port == 6380
            assert settings.password == "secret123"
            assert settings.max_connections == 100
            assert settings.pool_timeout_sec == 10.0


class TestPostgresSettings:
    """Test PostgreSQL configuration settings."""

    def test_postgres_default_values(self):
        """Test PostgreSQL settings have sensible defaults."""
        from api.config import PostgresSettings

        with patch.dict(os.environ, {}, clear=True):
            settings = PostgresSettings()
            assert settings.host == "postgres"
            assert settings.port == 5432
            assert settings.user == "devuser"
            assert settings.password == ""
            assert settings.database == "devdb"
            assert settings.pool_min_size == 2
            assert settings.pool_max_size == 10

    def test_postgres_dsn_generation(self):
        """Test DSN string generation for database connection."""
        from api.config import PostgresSettings

        env = {
            "POSTGRES_HOST": "dbhost",
            "POSTGRES_PORT": "5433",
            "POSTGRES_USER": "myuser",
            "POSTGRES_PASSWORD": "mypass",
            "POSTGRES_DB": "mydb",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = PostgresSettings()
            dsn = settings.get_dsn()
            assert "host=dbhost" in dsn
            assert "port=5433" in dsn
            assert "user=myuser" in dsn
            assert "password=mypass" in dsn
            assert "dbname=mydb" in dsn


class TestCorsSettings:
    """Test CORS configuration settings."""

    def test_cors_default_values(self):
        """Test CORS settings match the historical read-site defaults."""
        from api.config import DEFAULT_CORS_ORIGINS_REGEX, CorsSettings

        with patch.dict(os.environ, {}, clear=True):
            settings = CorsSettings()
            assert settings.origins == ["http://localhost:3000"]
            assert settings.origins_regex == DEFAULT_CORS_ORIGINS_REGEX
            assert DEFAULT_CORS_ORIGINS_REGEX == r"https?://([a-zA-Z0-9-]+\.)?elimelt\.com"

    def test_cors_origins_split_strip_and_drop_empties(self):
        """Test comma-split parsing of CORS_ORIGINS."""
        from api.config import CorsSettings

        env = {"CORS_ORIGINS": "https://a.example, https://b.example ,,"}
        with patch.dict(os.environ, env, clear=True):
            settings = CorsSettings()
            assert settings.origins == ["https://a.example", "https://b.example"]

    def test_cors_wildcard_origin(self):
        """Test that a wildcard origin parses as-is."""
        from api.config import CorsSettings

        env = {"CORS_ORIGINS": "*"}
        with patch.dict(os.environ, env, clear=True):
            settings = CorsSettings()
            assert settings.origins == ["*"]

    def test_cors_regex_set_value_is_stripped(self):
        """Test that a set CORS_ORIGINS_REGEX is stripped."""
        from api.config import CorsSettings

        env = {"CORS_ORIGINS_REGEX": r"  https://x\.example  "}
        with patch.dict(os.environ, env, clear=True):
            settings = CorsSettings()
            assert settings.origins_regex == r"https://x\.example"

    def test_cors_regex_whitespace_only_falls_back_to_default(self):
        """Test that a whitespace-only CORS_ORIGINS_REGEX uses the default."""
        from api.config import DEFAULT_CORS_ORIGINS_REGEX, CorsSettings

        env = {"CORS_ORIGINS_REGEX": "   "}
        with patch.dict(os.environ, env, clear=True):
            settings = CorsSettings()
            assert settings.origins_regex == DEFAULT_CORS_ORIGINS_REGEX


class TestSettings:
    """Test main Settings class that combines all settings."""

    def test_settings_singleton_pattern(self):
        """Test that get_settings returns the same instance."""
        from api.config import get_settings

        s1 = get_settings()
        s2 = get_settings()
        assert s1 is s2

    def test_settings_has_all_subsections(self):
        """Test that Settings contains all configuration sections."""
        from api.config import Settings

        with patch.dict(os.environ, {}, clear=True):
            settings = Settings()
            assert hasattr(settings, "redis")
            assert hasattr(settings, "postgres")
            assert hasattr(settings, "cors")
            assert hasattr(settings, "debug")
            assert hasattr(settings, "features")
            assert hasattr(settings, "sandbox")
            assert hasattr(settings, "geoip")
            assert hasattr(settings, "notes_sync")

    def test_debug_settings(self):
        """Test debug flag configuration."""
        from api.config import Settings

        env = {
            "REQUEST_DEBUG": "1",
            "WS_DEBUG": "1",
            "REDIS_DEBUG": "1",
            "AGENT_DEBUG": "1",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = Settings()
            assert settings.debug.request is True
            assert settings.debug.websocket is True
            assert settings.debug.redis is True
            assert settings.debug.agent is True

    def test_feature_flag_defaults(self):
        """Test feature flag defaults match the historical read-site defaults."""
        from api.config import Settings

        with patch.dict(os.environ, {}, clear=True):
            settings = Settings()
            assert settings.features.chat_db == "0"
            assert settings.features.analytics_scheduler == "1"
            assert settings.features.augment_agent == "1"
            assert settings.features.gemini_agent == "0"
            assert settings.features.codex_agent == "0"

    def test_feature_flags(self):
        """Test feature flag configuration.

        Flags stay raw strings; read sites compare == "1" exactly.
        """
        from api.config import Settings

        env = {
            "ENABLE_CHAT_DB": "1",
            "ENABLE_ANALYTICS_SCHEDULER": "0",
            "ENABLE_AUGMENT_AGENT": "0",
            "ENABLE_GEMINI_AGENT": "1",
            "ENABLE_CODEX_AGENT": "1",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = Settings()
            assert settings.features.chat_db == "1"
            assert settings.features.analytics_scheduler == "0"
            assert settings.features.augment_agent == "0"
            assert settings.features.gemini_agent == "1"
            assert settings.features.codex_agent == "1"

    def test_feature_flags_non_1_truthy_strings_stay_raw(self):
        """Test that "true" stays "true" (read sites treat it as OFF)."""
        from api.config import Settings

        with patch.dict(os.environ, {"ENABLE_CHAT_DB": "true"}, clear=True):
            settings = Settings()
            assert settings.features.chat_db == "true"
            assert settings.features.chat_db != "1"
