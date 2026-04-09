from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("PLACEAGENT_MODEL", "gemini-2.5-flash")
    app_name: str = "PlaceAgent"

    @property
    def ai_enabled(self) -> bool:
        return bool(self.gemini_api_key.strip())


settings = Settings()
