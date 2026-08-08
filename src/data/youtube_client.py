import datetime
import json
import logging
import os
from pathlib import Path
from typing import Any

import requests

from src.data.cache import get_cache
from src.data.models import YouTubeVideo

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "financial_influencers.json"
YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"


def load_financial_influencer_channels(config_path: str | Path | None = None) -> list[dict[str, Any]]:
    """Load curated YouTube channels used for financial sentiment."""
    path = Path(config_path) if config_path else DEFAULT_CONFIG_PATH
    if not path.exists():
        return []

    try:
        data = json.loads(path.read_text())
        channels = data.get("channels", [])
        return [channel for channel in channels if channel.get("youtube_channel_id")]
    except Exception as exc:
        logger.warning("Failed to load financial influencer config from %s: %s", path, exc)
        return []


def get_financial_influencer_videos(
    ticker: str,
    end_date: str,
    start_date: str | None = None,
    limit: int = 10,
    api_key: str | None = None,
    channels: list[dict[str, Any]] | None = None,
) -> list[YouTubeVideo]:
    """Fetch recent ticker-related YouTube videos from curated financial channels."""
    youtube_api_key = api_key or os.environ.get("YOUTUBE_API_KEY")
    if not youtube_api_key:
        return []

    channel_configs = channels if channels is not None else load_financial_influencer_channels()
    if not channel_configs:
        return []

    cache_key = f"{ticker}_{start_date or 'none'}_{end_date}_{limit}_{','.join(c['youtube_channel_id'] for c in channel_configs)}"
    cache = get_cache()
    if cached_data := cache.get_youtube_videos(cache_key):
        return [YouTubeVideo(**video) for video in cached_data]

    videos: list[YouTubeVideo] = []
    per_channel_limit = max(1, min(5, limit))

    for channel in channel_configs:
        if len(videos) >= limit:
            break

        channel_id = channel["youtube_channel_id"]
        source_weight = float(channel.get("credibility_weight", 0.6))
        try:
            search_response = requests.get(
                f"{YOUTUBE_API_BASE}/search",
                params={
                    "key": youtube_api_key,
                    "part": "snippet",
                    "channelId": channel_id,
                    "q": f"{ticker} stock",
                    "type": "video",
                    "order": "date",
                    "maxResults": per_channel_limit,
                    "publishedBefore": _to_rfc3339_end(end_date),
                    **({"publishedAfter": _to_rfc3339_start(start_date)} if start_date else {}),
                },
                timeout=10,
            )
            if search_response.status_code >= 400:
                logger.debug("YouTube search failed for %s: %s", channel_id, search_response.text[:200])
                continue

            search_items = search_response.json().get("items", [])
            video_ids = [item.get("id", {}).get("videoId") for item in search_items if item.get("id", {}).get("videoId")]
            stats_by_id = _fetch_video_stats(video_ids, youtube_api_key)

            for item in search_items:
                video_id = item.get("id", {}).get("videoId")
                snippet = item.get("snippet", {})
                if not video_id or not snippet:
                    continue

                published_at = snippet.get("publishedAt", "")
                published_date = published_at[:10]
                if start_date and published_date < start_date:
                    continue
                if published_date > end_date:
                    continue

                transcript = _fetch_transcript(video_id)
                stats = stats_by_id.get(video_id, {})
                videos.append(
                    YouTubeVideo(
                        ticker=ticker,
                        video_id=video_id,
                        title=snippet.get("title", ""),
                        channel_title=snippet.get("channelTitle") or channel.get("name", ""),
                        channel_id=channel_id,
                        published_at=published_at or published_date,
                        url=f"https://www.youtube.com/watch?v={video_id}",
                        description=snippet.get("description"),
                        transcript=transcript,
                        view_count=_safe_int(stats.get("viewCount")),
                        like_count=_safe_int(stats.get("likeCount")),
                        source_weight=source_weight,
                    )
                )
                if len(videos) >= limit:
                    break
        except Exception as exc:
            logger.debug("Failed to fetch YouTube videos for %s from %s: %s", ticker, channel_id, exc)

    if videos:
        cache.set_youtube_videos(cache_key, [video.model_dump() for video in videos])
    return videos


def _fetch_video_stats(video_ids: list[str], api_key: str) -> dict[str, dict[str, Any]]:
    if not video_ids:
        return {}

    response = requests.get(
        f"{YOUTUBE_API_BASE}/videos",
        params={"key": api_key, "part": "statistics", "id": ",".join(video_ids)},
        timeout=10,
    )
    if response.status_code >= 400:
        return {}

    return {item["id"]: item.get("statistics", {}) for item in response.json().get("items", []) if item.get("id")}


def _fetch_transcript(video_id: str) -> str | None:
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=["en"])
        text = " ".join(part.get("text", "") for part in transcript)
        return text[:8000] if text else None
    except Exception:
        return None


def _to_rfc3339_start(date_value: str) -> str:
    return f"{date_value}T00:00:00Z"


def _to_rfc3339_end(date_value: str) -> str:
    date_obj = datetime.datetime.strptime(date_value, "%Y-%m-%d") + datetime.timedelta(days=1)
    return date_obj.strftime("%Y-%m-%dT00:00:00Z")


def _safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
