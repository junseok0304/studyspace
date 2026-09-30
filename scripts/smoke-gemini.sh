#!/usr/bin/env bash
set -euo pipefail

# Loads local secrets without echoing them. Keep mock mode enabled by default
# everywhere else; this script is an explicit provider connectivity check.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${GEMINI_API_KEY:?GEMINI_API_KEY is required (set it in .env or the environment)}"
model="${STUDYSPACE_AI_MODEL:-gemini-3.6-flash}"
endpoint="https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/studyspace-gemini.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

status="$(curl -sS -o "$tmp_dir/response.json" -w '%{http_code}' \
  -X POST "$endpoint" \
  -H "x-goog-api-key: ${GEMINI_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"role":"user","parts":[{"text":"Reply with the single word OK."}]}],"generationConfig":{"maxOutputTokens":8,"temperature":0}}')"

if [[ "$status" != 2* ]]; then
  echo "Gemini smoke test failed: HTTP ${status}" >&2
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  finish_reason="$(jq -r '.candidates[0].finishReason // "UNKNOWN"' "$tmp_dir/response.json")"
  prompt_tokens="$(jq -r '.usageMetadata.promptTokenCount // 0' "$tmp_dir/response.json")"
  output_tokens="$(jq -r '.usageMetadata.candidatesTokenCount // 0' "$tmp_dir/response.json")"
  [[ "$finish_reason" != "UNKNOWN" ]]
  echo "Gemini smoke test passed: model=${model} finishReason=${finish_reason} promptTokens=${prompt_tokens} outputTokens=${output_tokens}"
else
  grep -q 'candidates' "$tmp_dir/response.json"
  echo "Gemini smoke test passed: model=${model} (install jq for usage metadata)"
fi
