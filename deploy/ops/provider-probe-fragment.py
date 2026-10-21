"""Import only: caller must explicitly invoke provider_probe once; use python -B."""
def provider_probe():
    import json
    from dataclasses import replace
    from urllib import error, request
    from unittest.mock import patch
    from ai_service import AIConfig, AIService, AIConfigurationError, AIResponseError, AITransportError, _extract_structured_json

    class NoRedirect(request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    cfg = service = payload = response = decoded = raw = None
    result = {"httpSuccess": False, "ok": False}
    count, status = 0, None
    opener = request.build_opener(NoRedirect())

    def once(req, *, timeout):
        nonlocal count, status
        count += 1
        if count != 1 or timeout != 30:
            raise RuntimeError()
        stream = opener.open(req, timeout=30)
        status = stream.status
        result["httpSuccess"] = type(status) is int and 200 <= status < 300
        return stream

    try:
        cfg = AIConfig.from_env()
        cfg.validate()
        if cfg.mock_mode or cfg.max_output_tokens != 64000:
            raise AIConfigurationError()
        service = AIService(replace(cfg, timeout_seconds=30))
        payload = service._payload(system_prompt='Return exactly {"ok":true}.', user_content=[{"type": "input_text", "text": 'Return {"ok":true}.'}], schema_name="qc_limit_probe", schema={"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False}, prompt_version="probe.v1", schema_version="probe.v1")
        with patch("ai_service.request.urlopen", once):
            response, _ = service._post_responses(payload)
        decoded = _extract_structured_json(response, request_id="redacted")
        result.update(httpSuccess=type(status) is int and 200 <= status < 300, ok=set(decoded) == {"ok"} and decoded["ok"] is True)
        usage = response.get("usage")
        result["usage"] = {k: usage[k] for k in ("input_tokens", "output_tokens", "total_tokens") if isinstance(usage, dict) and type(usage.get(k)) is int and usage[k] >= 0}
        # This is the provider's echoed request cap, not its theoretical model limit.
        if type(response.get("max_output_tokens")) is int and response["max_output_tokens"] > 0:
            result["providerAcknowledgedMaxOutputTokens"] = response["max_output_tokens"]
    except Exception as exc:
        if type(status) is int and 100 <= status <= 599:
            result["httpStatus"] = status
        result["errorType"] = next((label for cls, label in ((AIConfigurationError, "configuration"), (AIResponseError, "response_validation"), (AITransportError, "transport")) if isinstance(exc, cls)), "unexpected")
        cause = exc.__cause__
        if isinstance(cause, error.HTTPError):
            if type(cause.code) is int and 300 <= cause.code <= 599:
                result["httpStatus"] = cause.code
            try:
                with cause:
                    raw = cause.read(32769)
                decoded = json.loads(raw) if len(raw) <= 32768 else {}
                detail = decoded.get("error") if isinstance(decoded, dict) else None
                if isinstance(detail, dict):
                    if detail.get("type") in ("invalid_request_error", "authentication_error", "permission_error", "rate_limit_error", "server_error", "insufficient_quota"):
                        result["providerErrorType"] = detail["type"]
                    if detail.get("param") in ("max_output_tokens", "model", "text.format", "text.format.schema", "input"):
                        result["providerErrorParam"] = detail["param"]
            except Exception:
                pass
    finally:
        cfg = service = payload = response = decoded = raw = None
    return result
