from src.agents import intrinsic_value as intrinsic_agent
from src.data.models import IntrinsicValueEstimate
from src.tools.api import _calculate_dcf_per_share


def test_calculate_dcf_per_share_returns_positive_value():
    value = _calculate_dcf_per_share(
        base_cash_flow_per_share=10,
        growth_rate=0.05,
        discount_rate=0.12,
        terminal_growth_rate=0.03,
        years=10,
    )

    assert value is not None
    assert value > 100


def test_intrinsic_value_agent_emits_bullish_signal(monkeypatch):
    def fake_get_intrinsic_value(ticker, end_date, api_key=None):
        return IntrinsicValueEstimate(
            ticker=ticker,
            intrinsic_value_per_share=125,
            current_price=80,
            margin_of_safety=0.5625,
            currency="INR",
            source="estimated",
            method="discounted_cash_flow",
            assumptions={"growth_rate": 0.05},
            metrics={"free_cash_flow_per_share": 8},
        )

    monkeypatch.setattr(intrinsic_agent, "get_intrinsic_value", fake_get_intrinsic_value)

    state = {
        "messages": [],
        "data": {
            "tickers": ["TEST.NS"],
            "end_date": "2026-06-21",
            "analyst_signals": {},
        },
        "metadata": {
            "show_reasoning": False,
            "api_keys": {},
        },
    }

    result = intrinsic_agent.intrinsic_value_analyst_agent(state)
    signal = result["data"]["analyst_signals"]["intrinsic_value_analyst_agent"]["TEST.NS"]

    assert signal["signal"] == "bullish"
    assert signal["confidence"] > 60
    assert "intrinsic_value_signal" in signal["reasoning"]
