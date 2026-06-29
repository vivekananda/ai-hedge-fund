import json

from langchain_core.messages import HumanMessage

from src.graph.state import AgentState, show_agent_reasoning
from src.tools.api import get_intrinsic_value
from src.utils.api_key import get_api_key_from_state
from src.utils.progress import progress


def intrinsic_value_analyst_agent(state: AgentState, agent_id: str = "intrinsic_value_analyst_agent"):
    """Analyze each ticker against a reported or estimated intrinsic value."""
    data = state["data"]
    end_date = data["end_date"]
    tickers = data["tickers"]
    api_key = get_api_key_from_state(state, "FINANCIAL_DATASETS_API_KEY")
    intrinsic_value_analysis = {}

    for ticker in tickers:
        progress.update_status(agent_id, ticker, "Checking intrinsic value")

        estimate = get_intrinsic_value(
            ticker=ticker,
            end_date=end_date,
            api_key=api_key,
        )

        if not estimate or not estimate.intrinsic_value_per_share:
            progress.update_status(agent_id, ticker, "Failed: Intrinsic value unavailable")
            continue

        margin_of_safety = estimate.margin_of_safety
        if margin_of_safety is None:
            signal = "neutral"
            confidence = 50
        elif margin_of_safety >= 0.25:
            signal = "bullish"
            confidence = round(min(60 + (margin_of_safety - 0.25) * 100, 100))
        elif margin_of_safety <= -0.15:
            signal = "bearish"
            confidence = round(min(60 + abs(margin_of_safety + 0.15) * 100, 100))
        else:
            signal = "neutral"
            confidence = round(50 + min(abs(margin_of_safety) * 100, 25))

        currency = estimate.currency or ""
        value_label = f"{currency} {estimate.intrinsic_value_per_share:,.2f}".strip()
        price_label = f"{currency} {estimate.current_price:,.2f}".strip() if estimate.current_price else "N/A"
        margin_label = f"{margin_of_safety:.1%}" if margin_of_safety is not None else "N/A"

        reasoning = {
            "intrinsic_value_signal": {
                "signal": signal,
                "details": (
                    f"Intrinsic value/share: {value_label}, Current price: {price_label}, "
                    f"Margin of safety: {margin_label}, Method: {estimate.method}, Source: {estimate.source}"
                ),
            },
            "intrinsic_value": {
                "intrinsic_value_per_share": estimate.intrinsic_value_per_share,
                "current_price": estimate.current_price,
                "margin_of_safety": estimate.margin_of_safety,
                "method": estimate.method,
                "source": estimate.source,
                "currency": estimate.currency,
            },
            "assumptions": estimate.assumptions or {},
            "metrics": estimate.metrics or {},
        }

        intrinsic_value_analysis[ticker] = {
            "signal": signal,
            "confidence": confidence,
            "reasoning": reasoning,
        }

        progress.update_status(agent_id, ticker, "Done", analysis=json.dumps(reasoning, indent=4))

    message = HumanMessage(
        content=json.dumps(intrinsic_value_analysis),
        name=agent_id,
    )

    if state["metadata"].get("show_reasoning"):
        show_agent_reasoning(intrinsic_value_analysis, "Intrinsic Value Analysis Agent")

    state["data"]["analyst_signals"][agent_id] = intrinsic_value_analysis
    progress.update_status(agent_id, None, "Done")

    return {
        "messages": [message],
        "data": data,
    }
