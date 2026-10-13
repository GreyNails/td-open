from __future__ import annotations

import json
from pathlib import Path

MANIFEST = json.loads(Path(__file__).with_name('manifest.json').read_text(encoding='utf-8'))
ASSETS = MANIFEST['assets']
PROFILES = {profile['id']: profile for profile in MANIFEST['profiles']}
RUNTIME = MANIFEST['runtime']


def get_profile(profile_id: str) -> dict:
    if profile_id not in PROFILES:
        raise ValueError('未注册的本地模型：' + profile_id)
    return PROFILES[profile_id]


def profile_assets(profile_ids: list[str]) -> list[dict]:
    keys = dict.fromkeys(key for profile_id in profile_ids for key in get_profile(profile_id)['assets'])
    return [ASSETS[key] for key in keys]
