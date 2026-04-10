from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("PLACEAGENT_MODEL", "gemini-2.5-flash")
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_service_role_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    supabase_profiles_table: str = os.getenv("SUPABASE_PROFILES_TABLE", "student_profiles")
    supabase_alerts_table: str = os.getenv("SUPABASE_ALERTS_TABLE", "alerts")
    supabase_chats_table: str = os.getenv("SUPABASE_CHATS_TABLE", "chat_messages")
    supabase_jd_table: str = os.getenv("SUPABASE_JOB_DESCRIPTIONS_TABLE", "job_descriptions")
    app_name: str = "PlaceAgent"

    @property
    def ai_enabled(self) -> bool:
        return bool(self.gemini_api_key.strip())

    @property
    def supabase_enabled(self) -> bool:
        return bool(self.supabase_url.strip() and self.supabase_service_role_key.strip())


settings = Settings()
