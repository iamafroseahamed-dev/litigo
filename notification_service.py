from __future__ import annotations

import os
from typing import Any, Dict, Optional

import requests


class NotificationService:
    def __init__(self, resend_api_key: Optional[str] = None, resend_from: Optional[str] = None) -> None:
        self.resend_api_key = resend_api_key or os.environ.get('RESEND_API_KEY', '')
        self.resend_from = resend_from or os.environ.get('RESEND_FROM', 'Litigo <notifications@litigo.in>')

    def send_email(self, to_email: str, subject: str, body: str) -> Dict[str, Any]:
        if not self.resend_api_key:
            return {'ok': False, 'provider': 'resend', 'error': 'RESEND_API_KEY not configured.'}
        try:
            resp = requests.post(
                'https://api.resend.com/emails',
                headers={
                    'Authorization': f'Bearer {self.resend_api_key}',
                    'Content-Type': 'application/json',
                },
                json={
                    'from': self.resend_from,
                    'to': [to_email],
                    'subject': subject,
                    'text': body,
                },
                timeout=20,
            )
            if resp.ok:
                try:
                    return {'ok': True, 'provider': 'resend', 'response': resp.json()}
                except Exception:
                    return {'ok': True, 'provider': 'resend', 'response': {'raw': resp.text[:200]}}
            return {'ok': False, 'provider': 'resend', 'error': resp.text}
        except Exception as exc:
            return {'ok': False, 'provider': 'resend', 'error': str(exc)}

    def send_sms(self, *args: Any, **kwargs: Any) -> Dict[str, Any]:
        return {
            'ok': False,
            'skipped': True,
            'provider': 'msg91',
            'error': 'SMS delivery is not enabled yet.',
        }

    def send_whatsapp(self, *args: Any, **kwargs: Any) -> Dict[str, Any]:
        return {
            'ok': False,
            'skipped': True,
            'provider': 'msg91',
            'error': 'WhatsApp delivery is not enabled yet.',
        }