

def get_api_key_from_state(state: dict, api_key_name: str) -> str:
    """Get an API key from the state object."""
    if not state:
        return None

    metadata = state.get("metadata", {})
    if metadata.get("request"):
        request = metadata["request"]
        if hasattr(request, 'api_keys') and request.api_keys:
            return request.api_keys.get(api_key_name)

    if metadata.get("api_keys"):
        return metadata["api_keys"].get(api_key_name)

    return None
