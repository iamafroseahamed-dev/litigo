from __future__ import annotations

import json
import os
import re
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Dict

import requests

SARVAM_API_URL = 'https://api.sarvam.ai/v1/chat/completions'
SARVAM_MODEL = os.environ.get('SARVAM_MODEL', 'sarvam-30b').strip() or 'sarvam-30b'


def _read_local_env_value(name: str) -> str:
    """Best-effort local fallback for Vercel/Python dev runs.

    Production should provide real environment variables. This fallback is only
    used when the variable is absent from os.environ, so local `.env` files work
    for serverless handlers during development.
    """
    root = Path(__file__).resolve().parents[2]
    for filename in ('.env.local', '.env'):
        env_path = root / filename
        try:
            if not env_path.exists():
                continue
            for raw_line in env_path.read_text(encoding='utf-8').splitlines():
                line = raw_line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, value = line.split('=', 1)
                if key.strip() != name:
                    continue
                value = value.strip().strip('"').strip("'")
                if value:
                    return value
        except Exception:
            continue
    return ''


def _env(name: str, default: str = '') -> str:
    value = os.environ.get(name, '').strip()
    if value:
        return value
    local_value = _read_local_env_value(name).strip()
    return local_value or default

_RESPONSE_SCHEMA: Dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'properties': {
        'executive_summary': {
            'type': 'object',
            'additionalProperties': False,
            'properties': {
                'case_about': {'type': 'string'},
                'key_dispute': {'type': 'string'},
            },
            'required': ['case_about', 'key_dispute'],
        },
        'parties': {
            'type': 'object',
            'additionalProperties': False,
            'properties': {
                'petitioners': {'type': 'array', 'items': {'type': 'string'}},
                'respondents': {'type': 'array', 'items': {'type': 'string'}},
                'advocates': {'type': 'array', 'items': {'type': 'string'}},
            },
            'required': ['petitioners', 'respondents', 'advocates'],
        },
        'case_status': {
            'type': 'object',
            'additionalProperties': False,
            'properties': {
                'status': {'type': 'string'},
                'current_stage': {'type': 'string'},
            },
            'required': ['status', 'current_stage'],
        },
        'hearing_analysis': {
            'type': 'object',
            'additionalProperties': False,
            'properties': {
                'total_hearings': {'type': 'integer'},
                'hearing_trend': {'type': 'string'},
                'delays': {'type': 'string'},
            },
            'required': ['total_hearings', 'hearing_trend', 'delays'],
        },
        'key_legal_observations': {
            'type': 'object',
            'additionalProperties': False,
            'properties': {
                'important_legal_issues': {'type': 'array', 'items': {'type': 'string'}},
                'risks': {'type': 'array', 'items': {'type': 'string'}},
                'potential_impact': {'type': 'array', 'items': {'type': 'string'}},
            },
            'required': ['important_legal_issues', 'risks', 'potential_impact'],
        },
        'timeline_summary': {
            'type': 'object',
            'additionalProperties': False,
            'properties': {
                'filing_date': {'type': 'string'},
                'first_hearing': {'type': 'string'},
                'last_hearing': {'type': 'string'},
                'next_hearing': {'type': 'string'},
            },
            'required': ['filing_date', 'first_hearing', 'last_hearing', 'next_hearing'],
        },
        'advocate_action_items': {
            'type': 'object',
            'additionalProperties': False,
            'properties': {
                'immediate_actions': {'type': 'array', 'items': {'type': 'string'}},
                'documents_required': {'type': 'array', 'items': {'type': 'string'}},
                'follow_up_recommendations': {'type': 'array', 'items': {'type': 'string'}},
            },
            'required': ['immediate_actions', 'documents_required', 'follow_up_recommendations'],
        },
        'risk_assessment': {
            'type': 'object',
            'additionalProperties': False,
            'properties': {
                'level': {'type': 'string', 'enum': ['Low', 'Medium', 'High']},
                'reason': {'type': 'string'},
            },
            'required': ['level', 'reason'],
        },
        'department_impact': {
            'type': 'object',
            'additionalProperties': False,
            'properties': {
                'organization_impact': {'type': 'string'},
                'department_impact': {'type': 'string'},
            },
            'required': ['organization_impact', 'department_impact'],
        },
        'recommended_next_steps': {'type': 'array', 'items': {'type': 'string'}},
        'attention_required': {'type': 'boolean'},
        'no_activity': {'type': 'boolean'},
        'long_pending': {'type': 'boolean'},
        'upcoming_hearing': {'type': 'boolean'},
    },
    'required': [
        'executive_summary', 'parties', 'case_status', 'hearing_analysis',
        'key_legal_observations', 'timeline_summary', 'advocate_action_items',
        'risk_assessment', 'department_impact', 'recommended_next_steps',
        'attention_required', 'no_activity', 'long_pending', 'upcoming_hearing',
    ],
}


def _summary_text(analysis: Dict[str, Any]) -> str:
    if not isinstance(analysis, dict):
        return str(analysis or '').strip()
    risk = ((analysis.get('risk_assessment') or {}).get('level') or 'Unknown').strip()
    about = ((analysis.get('executive_summary') or {}).get('case_about') or '').strip()
    dispute = ((analysis.get('executive_summary') or {}).get('key_dispute') or '').strip()
    stage = ((analysis.get('case_status') or {}).get('current_stage') or '').strip()
    return ' '.join(x for x in [about, dispute and f'Key dispute: {dispute}.', stage and f'Current stage: {stage}.', f'Risk: {risk}.'] if x).strip()


def _as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _try_parse_json_text(text: str) -> Dict[str, Any] | None:
    text = (text or '').strip()
    if not text:
        return None

    candidates = [text]

    fenced = re.search(r'```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```', text, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        candidates.append(fenced.group(1).strip())

    first_brace = text.find('{')
    last_brace = text.rfind('}')
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        candidates.append(text[first_brace:last_brace + 1].strip())

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            continue
    return None


def _extract_analysis(result: Dict[str, Any]) -> Dict[str, Any]:
    if isinstance(result, str):
        parsed_direct = _try_parse_json_text(result)
        if parsed_direct is not None:
            return parsed_direct
        raise ValueError('Sarvam returned a string payload that is not parseable JSON')

    if not isinstance(result, dict):
        raise ValueError(f'Unexpected Sarvam payload type: {type(result).__name__}')

    # Some providers may return the analysis object directly rather than OpenAI-style choices.
    if 'choices' not in result:
        direct = _try_parse_json_text(json.dumps(result))
        if direct is not None:
            return direct

    choices = result.get('choices')
    if isinstance(choices, list) and choices:
        first_choice = choices[0]
        if isinstance(first_choice, str):
            parsed_choice = _try_parse_json_text(first_choice)
            if parsed_choice is not None:
                return parsed_choice
            raise ValueError('First choice is a string but not parseable JSON')
        message = _as_dict(_as_dict(first_choice).get('message'))
    else:
        message = {}

    content = message.get('content')
    if isinstance(content, dict):
        return content
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict):
                text_value = item.get('text') or item.get('content') or item.get('value')
                if isinstance(text_value, str):
                    parsed = _try_parse_json_text(text_value)
                    if parsed is not None:
                        return parsed
    if isinstance(content, str):
        parsed = _try_parse_json_text(content)
        if parsed is not None:
            return parsed

    tool_calls = message.get('tool_calls') or []
    if isinstance(tool_calls, list):
        for tool_call in tool_calls:
            fn = (tool_call or {}).get('function') or {}
            args = fn.get('arguments')
            if isinstance(args, str):
                parsed = _try_parse_json_text(args)
                if parsed is not None:
                    return parsed

    reasoning = message.get('reasoning_content')
    if isinstance(reasoning, str):
        parsed = _try_parse_json_text(reasoning)
        if parsed is not None:
            return parsed

    raise ValueError('No parseable JSON analysis payload found in Sarvam response')


def _truncate(value: Any, limit: int = 500) -> Any:
    if isinstance(value, str):
        value = value.strip()
        return value if len(value) <= limit else value[:limit] + '...'
    if isinstance(value, list):
        return [_truncate(v, limit) for v in value[:12]]
    if isinstance(value, dict):
        compact: Dict[str, Any] = {}
        for idx, (k, v) in enumerate(value.items()):
            if idx >= 20:
                break
            compact[str(k)] = _truncate(v, limit)
        return compact
    return value


def _compact_context(context: Dict[str, Any]) -> str:
    case_record = _as_dict(context.get('caseRecord'))
    case_details = _as_dict(context.get('caseDetailsJson'))

    compact = {
        'caseNumber': _truncate(context.get('caseNumber'), 120),
        'caseRecord': {
            'district': _truncate(case_record.get('district'), 120),
            'section': _truncate(case_record.get('section'), 120),
            'advocate_status': _truncate(case_record.get('advocate_status'), 120),
            'assigned_advocate_name': _truncate(case_record.get('assigned_advocate_name'), 120),
            'case_status': _truncate(case_record.get('case_status'), 120),
            'next_hearing_date': _truncate(case_record.get('next_hearing_date'), 120),
            'updated_at': _truncate(case_record.get('updated_at'), 120),
        },
        'caseDetails': {
            'registrationNumber': _truncate(case_details.get('registrationNumber'), 120),
            'filingDate': _truncate(case_details.get('filingDate'), 120),
            'registrationDate': _truncate(case_details.get('registrationDate'), 120),
            'cnr': _truncate(case_details.get('cnr'), 120),
            'caseStatus': _truncate(case_details.get('caseStatus'), 120),
            'natureOfDisposal': _truncate(case_details.get('natureOfDisposal'), 120),
            'courtName': _truncate(case_details.get('courtName'), 180),
            'judicialSection': _truncate(case_details.get('judicialSection'), 180),
            'firstHearingDate': _truncate(case_details.get('firstHearingDate'), 120),
            'lastHearingDate': _truncate(case_details.get('lastHearingDate'), 120),
            'nextHearingDate': _truncate(case_details.get('nextHearingDate'), 120),
            'hearingCount': case_details.get('hearingCount'),
            'orderCount': case_details.get('orderCount'),
            'interimOrderCount': case_details.get('interimOrderCount'),
            'judgmentCount': case_details.get('judgmentCount'),
            'petitioners': _truncate(case_details.get('petitioners'), 180),
            'respondents': _truncate(case_details.get('respondents'), 180),
            'petitionerAdvocates': _truncate(case_details.get('petitionerAdvocates'), 180),
            'respondentAdvocates': _truncate(case_details.get('respondentAdvocates'), 180),
            'judges': _truncate(case_details.get('judges'), 180),
        },
        'hearingHistory': _truncate(context.get('hearingHistory'), 250),
        'interimOrders': _truncate(context.get('interimOrders'), 250),
        'orders': _truncate(context.get('orders'), 250),
        'judgmentDetails': _truncate(context.get('judgmentDetails'), 250),
        'caseNotes': _truncate(context.get('caseNotes'), 250),
        'internalTasks': _truncate(context.get('internalTasks'), 250),
        'advocateStatusTimeline': _truncate(context.get('advocateStatusTimeline'), 250),
    }
    return json.dumps(compact, ensure_ascii=False)[:18000]


def _make_payload(case_number: str, prompt_context: str, structured: bool, reasoning_effort: Any = 'low') -> Dict[str, Any]:
    user_content = (
        'Analyse the following case and provide: executive summary, parties, case status, hearing analysis, legal observations, timeline summary, advocate action items, risk assessment, department impact, and recommended next steps. '
        'Also classify attention_required, no_activity, long_pending, and upcoming_hearing as booleans. '
        'Return valid JSON only, with no markdown fences and no explanatory text outside the JSON object.\n\n'
        f'Case Number: {case_number}\n\n'
        f'Context JSON:\n{prompt_context}'
    )

    base: Dict[str, Any] = {
        'model': SARVAM_MODEL,
        'temperature': 0.2,
        'max_tokens': 4000,
        'messages': [
            {
                'role': 'system',
                'content': (
                    'You are a senior Indian litigation analyst. Analyse the court case context provided and produce a concise, practical, legally-aware summary for an internal government litigation team. '
                    'Be factual, do not invent facts, and if data is missing state that clearly. Focus on actionable insights, risk, hearing progress, and department impact. '
                    'Always output a single JSON object and nothing else.'
                ),
            },
            {
                'role': 'user',
                'content': user_content,
            },
        ],
    }

    if reasoning_effort is not None:
        base['reasoning_effort'] = reasoning_effort

    if structured:
        base['response_format'] = {
            'type': 'json_schema',
            'json_schema': {
                'name': 'case_ai_analysis',
                'description': 'Structured legal case analysis for internal dashboard and case detail insights.',
                'schema': _RESPONSE_SCHEMA,
                'strict': True,
            },
        }
    else:
        base['response_format'] = {'type': 'json_object'}

    payload = base
    return payload


def _post_sarvam(headers: Dict[str, str], payload: Dict[str, Any]) -> requests.Response:
    return requests.post(SARVAM_API_URL, headers=headers, json=payload, timeout=(20, 90))


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        try:
            self._handle()
        except Exception as exc:
            self._json({'success': False, 'message': f'Unexpected error: {exc}'}, 500)

    def _handle(self) -> None:
        api_key = _env('SARVAM_API_KEY')
        if not api_key:
            self._json({'success': False, 'message': 'SARVAM_API_KEY is not configured on the server.'}, 500)
            return

        length = int(self.headers.get('Content-Length', 0))
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
        except Exception:
            self._json({'success': False, 'message': 'Invalid JSON body.'}, 400)
            return

        context = body.get('context')
        if not isinstance(context, dict):
            context = {}
        case_number = (
            str(body.get('caseNumber') or '')
            or str((context.get('caseNumber') or context.get('case_number') or ''))
        ).strip()
        if not case_number:
            case_number = 'UNKNOWN'

        prompt_context = _compact_context(context)
        payload = _make_payload(case_number, prompt_context, structured=False)

        headers = {
            'api-subscription-key': api_key,
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }

        try:
            resp = _post_sarvam(headers, payload)
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
            self._json({'success': False, 'message': 'Sarvam AI is currently unreachable. Please try again later.'}, 503)
            return
        except requests.RequestException:
            self._json({'success': False, 'message': 'Sarvam AI is currently unreachable. Please try again later.'}, 503)
            return

        if resp.status_code == 403:
            msg = 'Sarvam AI authentication failed. Check SARVAM_API_KEY.'
            try:
                err_payload = resp.json()
                err = _as_dict(err_payload).get('error', {})
                if isinstance(err, dict):
                    msg = str(err.get('message') or msg)
            except Exception:
                pass
            self._json({'success': False, 'message': msg}, 502)
            return
        if resp.status_code == 429:
            self._json({'success': False, 'message': 'Sarvam AI quota or rate limit reached. Please retry later.'}, 429)
            return

        if resp.status_code == 400 or resp.status_code == 422:
            sarvam_msg = f'Sarvam AI rejected the request (HTTP {resp.status_code}).'
            try:
                err_body = resp.json()
                err_detail = _as_dict(err_body).get('error') or err_body
                if isinstance(err_detail, dict):
                    sarvam_msg = str(err_detail.get('message') or sarvam_msg)
                elif isinstance(err_detail, str):
                    sarvam_msg = err_detail
                else:
                    sarvam_msg = f'{sarvam_msg} {json.dumps(err_body)[:300]}'
            except Exception:
                sarvam_msg = f'{sarvam_msg} {resp.text[:300]}'
            self._json({'success': False, 'message': sarvam_msg, 'detail': resp.text[:500]}, 502)
            return

        try:
            resp.raise_for_status()
            result = resp.json()
            analysis = _extract_analysis(result)
        except Exception as exc:
            fallback_preview = ''
            fallback_detail = str(exc)
            try:
                # Fallback: disable reasoning entirely so all tokens go to output
                fallback_resp = _post_sarvam(headers, _make_payload(case_number, prompt_context[:12000], structured=False, reasoning_effort=None))
                fallback_resp.raise_for_status()
                fallback_result = fallback_resp.json()
                analysis = _extract_analysis(fallback_result)
                result = fallback_result
            except Exception as fallback_exc:
                fallback_detail = f'{fallback_detail}; fallback={fallback_exc}'
                try:
                    fallback_preview = json.dumps(fallback_resp.json())[:400]
                except Exception:
                    try:
                        fallback_preview = fallback_resp.text[:400]
                    except Exception:
                        fallback_preview = ''
            snippet = ''
            try:
                snippet = json.dumps(resp.json())[:400]
            except Exception:
                snippet = resp.text[:400]
            if 'analysis' not in locals():
                self._json({
                    'success': False,
                    'message': 'Sarvam AI returned an unreadable response.',
                    'detail': fallback_detail,
                    'responsePreview': snippet,
                    'fallbackPreview': fallback_preview,
                }, 502)
                return

        self._json({
            'success': True,
            'summary': _summary_text(analysis),
            'analysis': analysis,
            'model': result.get('model'),
            'usage': result.get('usage'),
            'generatedAt': result.get('created'),
        })

    def _json(self, data: Any, status: int = 200) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt: str, *args: Any) -> None:
        pass
