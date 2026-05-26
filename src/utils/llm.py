"""Helper functions for LLM"""

import json
from typing import TypeVar, Type, Optional, Any
from pydantic import BaseModel
from src.llm.models import get_model, get_model_info
from src.utils.progress import progress

T = TypeVar("T", bound=BaseModel)


import os

def call_llm(
    prompt: Any,
    model_name: str,
    model_provider: str,
    pydantic_model: Type[T],
    agent_name: Optional[str] = None,
    max_retries: int = 3,
    default_factory=None,
) -> T:
    """
    Makes an LLM call with retry logic, handling both JSON supported and non-JSON supported models.

    Args:
        prompt: The prompt to send to the LLM
        model_name: Name of the model to use
        model_provider: Provider of the model
        pydantic_model: The Pydantic model class to structure the output
        agent_name: Optional name of the agent for progress updates
        max_retries: Maximum number of retries (default: 3)
        default_factory: Optional factory function to create default response on failure

    Returns:
        An instance of the specified Pydantic model
    """
    # Check if we have a valid API key for the selected provider
    has_valid_key = True
    if model_provider == "OpenAI":
        key = os.getenv("OPENAI_API_KEY")
        if not key or "your-openai" in key or "your-api" in key: has_valid_key = False
    elif model_provider == "Gemini":
        key = os.getenv("GOOGLE_API_KEY")
        if not key or "your-google" in key or "your-api" in key: has_valid_key = False
    elif model_provider == "Groq":
        key = os.getenv("GROQ_API_KEY")
        if not key or "your-groq" in key or "your-api" in key: has_valid_key = False
    elif model_provider == "Anthropic":
        key = os.getenv("ANTHROPIC_API_KEY")
        if not key or "your-anthropic" in key or "your-api" in key: has_valid_key = False
    elif model_provider == "DeepSeek":
        key = os.getenv("DEEPSEEK_API_KEY")
        if not key or "your-deepseek" in key or "your-api" in key: has_valid_key = False

    if not has_valid_key and model_provider not in ["Ollama", "LMStudio"]:
        if default_factory:
            return default_factory()
        return create_default_response(pydantic_model)

    model_info = get_model_info(model_name, model_provider)
    llm = get_model(model_name, model_provider)

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


def create_default_response(model_class: Type[T]) -> T:
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


def extract_json_from_response(content: str) -> Optional[dict]:
    """Extracts JSON from markdown-formatted response."""
    try:
        json_start = content.find("```json")
        if json_start != -1:
            json_text = content[json_start + 7 :]  # Skip past ```json
            json_end = json_text.find("```")
            if json_end != -1:
                json_text = json_text[:json_end].strip()
                return json.loads(json_text)
    except Exception as e:
        print(f"Error extracting JSON from response: {e}")
    return None
