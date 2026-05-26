"""Helper functions for LLM"""

import json
from pydantic import BaseModel
from src.llm.models import get_model, get_model_info
from src.utils.progress import progress
from src.graph.state import AgentState


import os

def call_llm(
    prompt: any,
    pydantic_model: type[BaseModel],
    agent_name: str | None = None,
    state: AgentState | None = None,
    max_retries: int = 3,
    default_factory=None,
) -> BaseModel:
    """
    Makes an LLM call with retry logic, handling both JSON supported and non-JSON supported models.

    Args:
        prompt: The prompt to send to the LLM
        pydantic_model: The Pydantic model class to structure the output
        agent_name: Optional name of the agent for progress updates and model config extraction
        state: Optional state object to extract agent-specific model configuration
        max_retries: Maximum number of retries (default: 3)
        default_factory: Optional factory function to create default response on failure

    Returns:
        An instance of the specified Pydantic model
    """
    # Extract model configuration if state is provided and agent_name is available
    if state and agent_name:
        model_name, model_provider = get_agent_model_config(state, agent_name)
    else:
        # Use system defaults when no state or agent_name is provided
        model_name = "gpt-4.1"
        model_provider = "OPENAI"

    # Extract API keys from state if available
    api_keys = None
    if state:
        request = state.get("metadata", {}).get("request")
        if request and hasattr(request, 'api_keys'):
            api_keys = request.api_keys

    # Check if we have a valid API key for the selected provider
    has_valid_key = True
    provider_upper = model_provider.upper() if isinstance(model_provider, str) else ""
    
    if provider_upper == "OPENAI":
        key = (api_keys or {}).get("OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
        if not key or "your-openai" in key or "your-api" in key:
            has_valid_key = False
    elif provider_upper == "GOOGLE" or provider_upper == "GEMINI":
        key = (api_keys or {}).get("GOOGLE_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not key or "your-google" in key or "your-api" in key:
            has_valid_key = False
    elif provider_upper == "GROQ":
        key = (api_keys or {}).get("GROQ_API_KEY") or os.getenv("GROQ_API_KEY")
        if not key or "your-groq" in key or "your-api" in key:
            has_valid_key = False
    elif provider_upper == "ANTHROPIC":
        key = (api_keys or {}).get("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
        if not key or "your-anthropic" in key or "your-api" in key:
            has_valid_key = False
    elif provider_upper == "DEEPSEEK":
        key = (api_keys or {}).get("DEEPSEEK_API_KEY") or os.getenv("DEEPSEEK_API_KEY")
        if not key or "your-deepseek" in key or "your-api" in key:
            has_valid_key = False

    if not has_valid_key and provider_upper not in ["OLLAMA", "LMSTUDIO"]:
        if default_factory:
            return default_factory()
        return create_default_response(pydantic_model)

    model_info = get_model_info(model_name, model_provider)
    llm = get_model(model_name, model_provider, api_keys)

    # Determine if we should use structured JSON mode
    use_json_mode = True
    if model_provider in ["Gemini", "DeepSeek", "LMStudio"]:
        use_json_mode = False
    elif model_info and not model_info.has_json_mode():
        use_json_mode = False

    if use_json_mode:
        llm = llm.with_structured_output(
            pydantic_model,
            method="json_mode",
        )

    # Call the LLM with retries
    for attempt in range(max_retries):
        try:
            # Call the LLM
            result = llm.invoke(prompt)

            # For non-JSON support models, we need to extract and parse the JSON manually
            if not use_json_mode:
                parsed_result = extract_json_from_response(result.content)
                if not parsed_result:
                    try:
                        import json
                        parsed_result = json.loads(result.content.strip())
                    except Exception:
                        pass
                if parsed_result:
                    return pydantic_model(**parsed_result)
                else:
                    raise ValueError(f"Could not parse response content as JSON: {result.content}")
            else:
                return result

        except Exception as e:
            if agent_name:
                progress.update_status(agent_name, None, f"Error - retry {attempt + 1}/{max_retries}")

            if attempt == max_retries - 1:
                error_msg = f"Error in LLM call after {max_retries} attempts: {e}"
                print(error_msg)
                if agent_name:
                    progress.update_status(agent_name, None, f"Error: {e}")
                raise RuntimeError(error_msg) from e

    # This should never be reached due to the retry logic above
    return create_default_response(pydantic_model)


def create_default_response(model_class: type[BaseModel]) -> BaseModel:
    """Creates a safe default response based on the model's fields."""
    default_values = {}
    for field_name, field in model_class.model_fields.items():
        if field.annotation == str:
            default_values[field_name] = "Error in analysis, using default"
        elif field.annotation == float:
            default_values[field_name] = 0.0
        elif field.annotation == int:
            default_values[field_name] = 0
        elif hasattr(field.annotation, "__origin__") and field.annotation.__origin__ == dict:
            default_values[field_name] = {}
        else:
            # For other types (like Literal), try to use the first allowed value
            if hasattr(field.annotation, "__args__"):
                default_values[field_name] = field.annotation.__args__[0]
            else:
                default_values[field_name] = None

    return model_class(**default_values)


def extract_json_from_response(content: str) -> dict | None:
    """Extracts JSON from a response, handling markdown-wrapped and raw JSON formats."""
    try:
        # 1. Try markdown code block with ```json
        json_start = content.find("```json")
        if json_start != -1:
            json_text = content[json_start + 7:]  # Skip past ```json
            json_end = json_text.find("```")
            if json_end != -1:
                json_text = json_text[:json_end].strip()
                try:
                    return json.loads(json_text)
                except json.JSONDecodeError:
                    pass

        # 2. Try markdown code block without json specifier
        json_start = content.find("```")
        if json_start != -1:
            json_text = content[json_start + 3:]
            json_end = json_text.find("```")
            if json_end != -1:
                json_text = json_text[:json_end].strip()
                try:
                    return json.loads(json_text)
                except json.JSONDecodeError:
                    pass

        # 3. Try to parse the entire content as JSON
        try:
            return json.loads(content.strip())
        except json.JSONDecodeError:
            pass

        # 4. Find the first top-level JSON object by matching braces
        brace_start = content.find("{")
        if brace_start != -1:
            depth = 0
            for i, char in enumerate(content[brace_start:], brace_start):
                if char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(content[brace_start:i + 1])
                        except json.JSONDecodeError:
                            break

    except Exception as e:
        print(f"Error extracting JSON from response: {e}")
    return None


def get_agent_model_config(state, agent_name):
    """
    Get model configuration for a specific agent from the state.
    Falls back to global model configuration if agent-specific config is not available.
    Always returns valid model_name and model_provider values.
    """
    request = state.get("metadata", {}).get("request")
    
    if request and hasattr(request, 'get_agent_model_config'):
        # Get agent-specific model configuration
        model_name, model_provider = request.get_agent_model_config(agent_name)
        # Ensure we have valid values
        if model_name and model_provider:
            return model_name, model_provider.value if hasattr(model_provider, 'value') else str(model_provider)
    
    # Fall back to global configuration (system defaults)
    model_name = state.get("metadata", {}).get("model_name") or "gpt-4.1"
    model_provider = state.get("metadata", {}).get("model_provider") or "OPENAI"
    
    # Convert enum to string if necessary
    if hasattr(model_provider, 'value'):
        model_provider = model_provider.value
    
    return model_name, model_provider
