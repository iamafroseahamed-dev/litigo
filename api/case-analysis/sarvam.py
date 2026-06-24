from __future__ import annotations

import json
import os
import re
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict

import requests

SARVAM_API_URL = 'https://api.sarvam.ai/v1/chat/completions'
SARVAM_MODEL = os.environ.get('SARVAM_MODEL', 'sarvam-30b').strip() or 'sarvam-30b'

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
    risk = ((analysis.get('risk_assessment') or {}).get('level') or 'Unknown').strip()
    about = ((analysis.get('executive_summary') or {}).get('case_about') or '').strip()
    dispute = ((analysis.get('executive_summary') or {}).get('key_dispute') or '').strip()
    stage = ((analysis.get('case_status') or {}).get('current_stage') or '').strip()
    return ' '.join(x for x in [about, dispute and f'Key dispute: {dispute}.', stage and f'Current stage: {stage}.', f'Risk: {risk}.'] if x).strip()


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
    message = ((result.get('choices') or [{}])[0].get('message') or {})

    content = message.get('content')
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


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        try:
            self._handle()
        except Exception as exc:
            self._json({'success': False, 'message': f'Unexpected error: {exc}'}, 500)

    def _handle(self) -> None:
        api_key = os.environ.get('SARVAM_API_KEY', '').strip()
        if not api_key:
            self._json({'success': False, 'message': 'SARVAM_API_KEY is not configured on the server.'}, 500)
            return

        length = int(self.headers.get('Content-Length', 0))
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
        except Exception:
            self._json({'success': False, 'message': 'Invalid JSON body.'}, 400)
            return

        case_number = str(body.get('caseNumber') or '').strip()
        context = body.get('context')
        if not case_number or not isinstance(context, dict):
            self._json({'success': False, 'message': 'caseNumber and context are required.'}, 400)
            return

        prompt_context = json.dumps(context, ensure_ascii=False)[:120000]
        payload = {
            'model': SARVAM_MODEL,
            'temperature': 0.2,
            'reasoning_effort': 'medium',
            'max_tokens': 1800,
            'messages': [
                {
                    'role': 'system',
                    'content': (
                        'You are a senior Indian litigation analyst. Analyse the court case context provided and produce a concise, practical, legally-aware summary for an internal government litigation team. '
                        'Be factual, do not invent facts, and if data is missing state that clearly. Focus on actionable insights, risk, hearing progress, and department impact.'
                    ),
                },
                {
                    'role': 'user',
                    'content': (
                        'Analyse the following case and provide: executive summary, parties, case status, hearing analysis, legal observations, timeline summary, advocate action items, risk assessment, department impact, and recommended next steps. '
                        'Also classify attention_required, no_activity, long_pending, and upcoming_hearing as booleans.\n\n'
                        f'Case Number: {case_number}\n\n'
                        f'Context JSON:\n{prompt_context}'
                    ),
                },
            ],
            'response_format': {
                'type': 'json_schema',
                'json_schema': {
                    'name': 'case_ai_analysis',
                    'description': 'Structured legal case analysis for internal dashboard and case detail insights.',
                    'schema': _RESPONSE_SCHEMA,
                    'strict': True,
                },
            },
        }

        headers = {
            'api-subscription-key': api_key,
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }

        try:
            resp = requests.post(SARVAM_API_URL, headers=headers, json=payload, timeout=(20, 90))
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
            self._json({'success': False, 'message': 'Sarvam AI is currently unreachable. Please try again later.'}, 503)
            return
        except requests.RequestException:
            self._json({'success': False, 'message': 'Sarvam AI is currently unreachable. Please try again later.'}, 503)
            return

        if resp.status_code == 403:
            msg = 'Sarvam AI authentication failed. Check SARVAM_API_KEY.'
            try:
                err = resp.json().get('error', {})
                if isinstance(err, dict):
                    msg = str(err.get('message') or msg)
            except Exception:
                pass
            self._json({'success': False, 'message': msg}, 502)
            return
        if resp.status_code == 429:
            self._json({'success': False, 'message': 'Sarvam AI quota or rate limit reached. Please retry later.'}, 429)
            return

        try:
            resp.raise_for_status()
            result = resp.json()
            analysis = _extract_analysis(result)
        except Exception as exc:
            snippet = ''
            try:
                snippet = json.dumps(resp.json())[:400]
            except Exception:
                snippet = resp.text[:400]
            self._json({
                'success': False,
                'message': 'Sarvam AI returned an unreadable response.',
                'detail': str(exc),
                'responsePreview': snippet,
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
