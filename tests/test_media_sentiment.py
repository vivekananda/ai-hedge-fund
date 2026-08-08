from src.agents.news_sentiment import _aggregate_media_items, _recency_weight
from src.data.models import MediaSentimentItem


def test_aggregate_media_items_weights_news_and_youtube_sentiment():
    items = [
        MediaSentimentItem(
            ticker="AAPL",
            source_type="news",
            source="Example News",
            title="Apple raises guidance",
            url="https://example.com/news",
            published_at="2024-03-08",
            sentiment="positive",
            confidence=90,
            relevance_score=90,
            impact_horizon="short",
            source_weight=1.0,
        ),
        MediaSentimentItem(
            ticker="AAPL",
            source_type="youtube",
            source="Example Channel",
            title="Apple demand concerns",
            url="https://youtube.com/watch?v=abc",
            published_at="2024-03-08",
            sentiment="negative",
            confidence=50,
            relevance_score=50,
            impact_horizon="short",
            source_weight=0.4,
        ),
    ]

    result = _aggregate_media_items(items, "2024-03-08")

    assert result["signal"] == "bullish"
    assert result["sources"]["news"]["signal"] == "bullish"
    assert result["sources"]["youtube"]["signal"] == "bearish"
    assert result["confidence"] > 50


def test_aggregate_media_items_returns_neutral_without_media():
    result = _aggregate_media_items([], "2024-03-08")

    assert result["signal"] == "neutral"
    assert result["confidence"] == 0.0
    assert result["sources"]["news"]["metrics"]["total_items"] == 0


def test_recency_weight_decays_for_older_items():
    fresh = _recency_weight("2024-03-08", "2024-03-08")
    older = _recency_weight("2024-02-08", "2024-03-08")

    assert fresh == 1.0
    assert 0.2 <= older < fresh
