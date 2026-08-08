import datetime
import json
import math

from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field
from typing_extensions import Literal

from src.data.article_extraction import extract_article_text
from src.data.models import CompanyNews, MediaSentimentItem, YouTubeVideo
from src.data.youtube_client import get_financial_influencer_videos
from src.graph.state import AgentState, show_agent_reasoning
from src.tools.api import get_company_news
from src.utils.api_key import get_api_key_from_state
from src.utils.llm import call_llm
from src.utils.progress import progress


class MediaSentiment(BaseModel):
    """Represents stock-specific sentiment from a news article or video."""

    sentiment: Literal["positive", "negative", "neutral"]
    confidence: int = Field(description="Confidence 0-100")
    relevance_score: int = Field(description="How relevant this item is to the ticker, from 0-100")
    impact_horizon: Literal["short", "medium", "long"]
    key_claims: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)


def news_sentiment_agent(state: AgentState, agent_id: str = "news_sentiment_agent"):
    """
    Analyze source-aware media sentiment for tickers.

    The agent combines company news and optional YouTube videos from curated financial
    channels, classifies each item for stock-specific sentiment, and weights the
    aggregate by recency, confidence, relevance, and source credibility.
    """
    data = state.get("data", {})
    end_date = data.get("end_date")
    start_date = data.get("start_date")
    tickers = data.get("tickers")
    financial_api_key = get_api_key_from_state(state, "FINANCIAL_DATASETS_API_KEY")
    youtube_api_key = get_api_key_from_state(state, "YOUTUBE_API_KEY")
    sentiment_analysis = {}

    for ticker in tickers:
        progress.update_status(agent_id, ticker, "Fetching company news")
        company_news = get_company_news(
            ticker=ticker,
            start_date=start_date,
            end_date=end_date,
            limit=100,
            api_key=financial_api_key,
        ) or []

        progress.update_status(agent_id, ticker, "Fetching YouTube media")
        youtube_videos = get_financial_influencer_videos(
            ticker=ticker,
            start_date=start_date,
            end_date=end_date,
            limit=10,
            api_key=youtube_api_key,
        )

        media_items = _build_media_items(ticker, company_news, youtube_videos, end_date)
        classified_count = 0

        items_to_classify = _select_items_for_llm(media_items)
        if items_to_classify:
            progress.update_status(agent_id, ticker, f"Analyzing {len(items_to_classify)} media items")

        for idx, item in enumerate(items_to_classify):
            progress.update_status(agent_id, ticker, f"Analyzing media item {idx + 1} of {len(items_to_classify)}")
            response = call_llm(
                _build_sentiment_prompt(ticker, item),
                MediaSentiment,
                agent_name=agent_id,
                state=state,
                default_factory=_neutral_media_sentiment,
            )
            item.sentiment = response.sentiment.lower()
            item.confidence = _clamp_int(response.confidence)
            item.relevance_score = _clamp_int(response.relevance_score)
            item.impact_horizon = response.impact_horizon
            item.key_claims = response.key_claims[:3]
            item.risks = response.risks[:3]
            classified_count += 1

        progress.update_status(agent_id, ticker, "Aggregating weighted sentiment")
        aggregation = _aggregate_media_items(media_items, end_date)
        reasoning = _build_reasoning(aggregation, media_items, classified_count)

        sentiment_analysis[ticker] = {
            "signal": aggregation["signal"],
            "confidence": aggregation["confidence"],
            "reasoning": reasoning,
        }

        progress.update_status(agent_id, ticker, "Done", analysis=json.dumps(reasoning, indent=4))

    message = HumanMessage(
        content=json.dumps(sentiment_analysis),
        name=agent_id,
    )

    if state.get("metadata", {}).get("show_reasoning"):
        show_agent_reasoning(sentiment_analysis, "Media Sentiment Analysis Agent")

    if "analyst_signals" not in state["data"]:
        state["data"]["analyst_signals"] = {}
    state["data"]["analyst_signals"][agent_id] = sentiment_analysis

    progress.update_status(agent_id, None, "Done")

    return {
        "messages": [message],
        "data": state["data"],
    }


def _build_media_items(
    ticker: str,
    company_news: list[CompanyNews],
    youtube_videos: list[YouTubeVideo],
    end_date: str,
    article_text_limit: int = 5,
) -> list[MediaSentimentItem]:
    media_items: list[MediaSentimentItem] = []

    for idx, news in enumerate(company_news[:25]):
        text = news.text
        if idx < article_text_limit and not text:
            text = extract_article_text(news.url)

        media_items.append(
            MediaSentimentItem(
                ticker=ticker,
                source_type="news",
                source=news.source,
                title=news.title,
                url=news.url,
                published_at=news.date,
                author=news.author,
                text=text,
                sentiment=_normalize_sentiment(news.sentiment),
                confidence=55 if news.sentiment else None,
                relevance_score=70 if news.sentiment else None,
                impact_horizon="short" if news.sentiment else None,
                source_weight=1.0,
            )
        )

    for video in youtube_videos[:10]:
        text_parts = [video.description or "", video.transcript or ""]
        media_items.append(
            MediaSentimentItem(
                ticker=ticker,
                source_type="youtube",
                source=video.channel_title,
                title=video.title,
                url=video.url,
                published_at=video.published_at,
                author=video.channel_title,
                text="\n".join(part for part in text_parts if part).strip() or None,
                source_weight=video.source_weight,
            )
        )

    return [item for item in media_items if _date_part(item.published_at) <= end_date]


def _select_items_for_llm(media_items: list[MediaSentimentItem]) -> list[MediaSentimentItem]:
    news_candidates = [
        item
        for item in media_items
        if item.source_type == "news" and (item.text or item.sentiment is None)
    ][:5]
    youtube_candidates = [item for item in media_items if item.source_type == "youtube"][:5]
    return news_candidates + youtube_candidates


def _build_sentiment_prompt(ticker: str, item: MediaSentimentItem) -> str:
    content = item.text or item.title
    return (
        "Analyze this media item for stock-specific investment sentiment.\n"
        f"Ticker: {ticker}\n"
        f"Source type: {item.source_type}\n"
        f"Source: {item.source}\n"
        f"Published at: {item.published_at}\n"
        f"Title: {item.title}\n\n"
        "Classify sentiment only for this ticker, not the overall market or sector unless that directly affects the ticker. "
        "Return positive, negative, or neutral; confidence 0-100; relevance_score 0-100; impact_horizon short, medium, or long; "
        "and concise key_claims and risks.\n\n"
        f"Content:\n{content[:8000]}"
    )


def _aggregate_media_items(media_items: list[MediaSentimentItem], end_date: str) -> dict:
    source_groups = {
        "news": _aggregate_source([item for item in media_items if item.source_type == "news"], end_date),
        "youtube": _aggregate_source([item for item in media_items if item.source_type == "youtube"], end_date),
    }

    weighted_score = sum(group["weighted_score"] for group in source_groups.values())
    total_weight = sum(group["total_weight"] for group in source_groups.values())
    normalized_score = weighted_score / total_weight if total_weight else 0.0

    signal = _score_to_signal(normalized_score)
    confidence = round(min(100, abs(normalized_score) * 100), 2) if total_weight else 0.0

    return {
        "signal": signal,
        "confidence": confidence,
        "weighted_score": round(weighted_score, 4),
        "total_weight": round(total_weight, 4),
        "normalized_score": round(normalized_score, 4),
        "sources": source_groups,
    }


def _aggregate_source(items: list[MediaSentimentItem], end_date: str) -> dict:
    weighted_score = 0.0
    total_weight = 0.0
    sentiment_counts = {"bullish": 0, "bearish": 0, "neutral": 0}

    for item in items:
        sentiment_value = _sentiment_value(item.sentiment)
        signal = _score_to_signal(sentiment_value)
        sentiment_counts[signal] += 1

        confidence = (item.confidence if item.confidence is not None else 50) / 100
        relevance = (item.relevance_score if item.relevance_score is not None else 50) / 100
        recency = _recency_weight(item.published_at, end_date)
        source_weight = item.source_weight
        item_weight = confidence * relevance * recency * source_weight

        weighted_score += sentiment_value * item_weight
        total_weight += item_weight

    normalized_score = weighted_score / total_weight if total_weight else 0.0
    return {
        "signal": _score_to_signal(normalized_score),
        "confidence": round(min(100, abs(normalized_score) * 100), 2) if total_weight else 0.0,
        "weighted_score": round(weighted_score, 4),
        "total_weight": round(total_weight, 4),
        "normalized_score": round(normalized_score, 4),
        "metrics": {
            "total_items": len(items),
            "bullish_items": sentiment_counts["bullish"],
            "bearish_items": sentiment_counts["bearish"],
            "neutral_items": sentiment_counts["neutral"],
        },
    }


def _build_reasoning(aggregation: dict, media_items: list[MediaSentimentItem], classified_count: int) -> dict:
    return {
        "news_sentiment": aggregation["sources"]["news"],
        "youtube_sentiment": aggregation["sources"]["youtube"],
        "combined_media_sentiment": {
            "signal": aggregation["signal"],
            "confidence": aggregation["confidence"],
            "weighted_score": aggregation["weighted_score"],
            "total_weight": aggregation["total_weight"],
            "normalized_score": aggregation["normalized_score"],
            "metrics": {
                "total_items": len(media_items),
                "news_items": len([item for item in media_items if item.source_type == "news"]),
                "youtube_items": len([item for item in media_items if item.source_type == "youtube"]),
                "items_classified_by_llm": classified_count,
            },
            "top_sources": _top_sources(media_items),
        },
    }


def _top_sources(media_items: list[MediaSentimentItem], limit: int = 5) -> list[dict]:
    ranked = sorted(
        media_items,
        key=lambda item: ((item.confidence or 0) * (item.relevance_score or 0) * item.source_weight),
        reverse=True,
    )
    return [
        {
            "source_type": item.source_type,
            "source": item.source,
            "title": item.title,
            "url": item.url,
            "sentiment": item.sentiment,
            "confidence": item.confidence,
            "relevance_score": item.relevance_score,
            "impact_horizon": item.impact_horizon,
            "key_claims": item.key_claims or [],
            "risks": item.risks or [],
        }
        for item in ranked[:limit]
    ]


def _recency_weight(published_at: str, end_date: str, half_life_days: int = 14) -> float:
    try:
        item_date = datetime.datetime.strptime(_date_part(published_at), "%Y-%m-%d").date()
        end = datetime.datetime.strptime(end_date, "%Y-%m-%d").date()
        age_days = max(0, (end - item_date).days)
        return max(0.2, math.exp(-math.log(2) * age_days / half_life_days))
    except Exception:
        return 0.5


def _score_to_signal(score: float) -> Literal["bullish", "bearish", "neutral"]:
    if score > 0.15:
        return "bullish"
    if score < -0.15:
        return "bearish"
    return "neutral"


def _sentiment_value(sentiment: str | None) -> int:
    if sentiment == "positive":
        return 1
    if sentiment == "negative":
        return -1
    return 0


def _normalize_sentiment(sentiment: str | None) -> Literal["positive", "negative", "neutral"] | None:
    if not sentiment:
        return None
    sentiment = sentiment.lower()
    if sentiment in {"positive", "negative", "neutral"}:
        return sentiment
    return None


def _date_part(value: str) -> str:
    return value.split("T")[0] if value else "9999-12-31"


def _clamp_int(value: int | None, minimum: int = 0, maximum: int = 100) -> int:
    if value is None:
        return minimum
    return max(minimum, min(maximum, int(value)))


def _neutral_media_sentiment() -> MediaSentiment:
    return MediaSentiment(
        sentiment="neutral",
        confidence=0,
        relevance_score=0,
        impact_horizon="short",
        key_claims=[],
        risks=[],
    )
