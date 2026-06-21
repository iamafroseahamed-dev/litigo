from __future__ import annotations

import os
from typing import Any, Dict, Optional

import requests


class NotificationService:
    """
    Email    → MailerSend  (MAILERSEND_API_KEY)
    SMS      → MSG91       (MSG91_AUTH_KEY + MSG91_SENDER_ID)
    WhatsApp → MSG91       (MSG91_AUTH_KEY + MSG91_WHATSAPP_SENDER + MSG91_WHATSAPP_TEMPLATE_ID)
    """

    def __init__(
        self,
        # MailerSend — email
        mailersend_api_key: Optional[str] = None,
        mailersend_from_email: Optional[str] = None,
        mailersend_from_name: Optional[str] = None,
        # MSG91 — SMS + WhatsApp
        msg91_auth_key: Optional[str] = None,
        msg91_sender_id: Optional[str] = None,
        msg91_sms_template_id: Optional[str] = None,
        msg91_whatsapp_sender: Optional[str] = None,
        msg91_whatsapp_template_id: Optional[str] = None,
    ) -> None:
        self.mailersend_api_key         = (mailersend_api_key         or os.environ.get('MAILERSEND_API_KEY', '')).strip()
        self.mailersend_from_email      = (mailersend_from_email      or os.environ.get('MAILERSEND_FROM_EMAIL', 'notifications@litigo.in')).strip()
        self.mailersend_from_name       = (mailersend_from_name       or os.environ.get('MAILERSEND_FROM_NAME', 'Litigo')).strip()
        self.msg91_auth_key             = (msg91_auth_key             or os.environ.get('MSG91_AUTH_KEY', '')).strip()
        self.msg91_sender_id            = (msg91_sender_id            or os.environ.get('MSG91_SENDER_ID', '')).strip()
        self.msg91_sms_template_id      = (msg91_sms_template_id      or os.environ.get('MSG91_SMS_TEMPLATE_ID', '')).strip()
        self.msg91_whatsapp_sender      = (msg91_whatsapp_sender      or os.environ.get('MSG91_WHATSAPP_SENDER', '')).strip()
        self.msg91_whatsapp_template_id = (msg91_whatsapp_template_id or os.environ.get('MSG91_WHATSAPP_TEMPLATE_ID', '')).strip()

    def _msg91_headers(self) -> Dict[str, str]:
        return {'authkey': self.msg91_auth_key, 'Content-Type': 'application/json'}

    @staticmethod
    def _normalize_mobile(number: str) -> str:
        """Strip non-digits; prepend 91 for 10-digit Indian numbers."""
        digits = ''.join(filter(str.isdigit, number))
        return ('91' + digits) if len(digits) == 10 else digits

    # ── Email (MailerSend) ──────────────────────────────────────────────────────

    def send_email(self, to_email: str, subject: str, body: str, recipient_name: str = '') -> Dict[str, Any]:
        if not self.mailersend_api_key:
            return {'ok': False, 'provider': 'mailersend', 'error': 'MAILERSEND_API_KEY not configured.'}
        try:
            resp = requests.post(
                'https://api.mailersend.com/v1/email',
                headers={
                    'Authorization': f'Bearer {self.mailersend_api_key}',
                    'Content-Type': 'application/json',
                },
                json={
                    'from':    {'email': self.mailersend_from_email, 'name': self.mailersend_from_name},
                    'to':      [{'email': to_email, 'name': recipient_name or to_email}],
                    'subject': subject,
                    'text':    body,
                },
                timeout=20,
            )
            if resp.ok:
                try:
                    return {'ok': True, 'provider': 'mailersend', 'response': resp.json()}
                except Exception:
                    return {'ok': True, 'provider': 'mailersend', 'response': {'raw': resp.text[:200]}}
            return {'ok': False, 'provider': 'mailersend', 'error': resp.text}
        except Exception as exc:
            return {'ok': False, 'provider': 'mailersend', 'error': str(exc)}

    # ── SMS (MSG91) ────────────────────────────────────────────────────────────

    def send_sms(self, mobile_number: str, body: str) -> Dict[str, Any]:
        if not self.msg91_auth_key:
            return {'ok': False, 'provider': 'msg91', 'error': 'MSG91_AUTH_KEY not configured.'}
        if not self.msg91_sender_id:
            return {'ok': False, 'provider': 'msg91', 'error': 'MSG91_SENDER_ID not configured.'}
        mobile = self._normalize_mobile(mobile_number)
        try:
            if self.msg91_sms_template_id:
                resp = requests.post(
                    'https://api.msg91.com/api/v5/flow/',
                    headers=self._msg91_headers(),
                    json={
                        'template_id': self.msg91_sms_template_id,
                        'short_url':   '0',
                        'recipients':  [{'mobiles': mobile, 'var1': body[:160]}],
                    },
                    timeout=20,
                )
            else:
                resp = requests.get(
                    'https://control.msg91.com/api/v5/sms',
                    params={
                        'authkey': self.msg91_auth_key,
                        'mobiles': mobile,
                        'message': body,
                        'sender':  self.msg91_sender_id,
                        'route':   '4',
                        'country': '91',
                    },
                    timeout=20,
                )
            if resp.ok:
                try:
                    return {'ok': True, 'provider': 'msg91', 'response': resp.json()}
                except Exception:
                    return {'ok': True, 'provider': 'msg91', 'response': {'raw': resp.text[:200]}}
            return {'ok': False, 'provider': 'msg91', 'error': resp.text}
        except Exception as exc:
            return {'ok': False, 'provider': 'msg91', 'error': str(exc)}

    # ── WhatsApp (MSG91) ───────────────────────────────────────────────────────

    def send_whatsapp(self, whatsapp_number: str, body: str) -> Dict[str, Any]:
        if not self.msg91_auth_key:
            return {'ok': False, 'provider': 'msg91', 'error': 'MSG91_AUTH_KEY not configured.'}
        if not self.msg91_whatsapp_sender:
            return {'ok': False, 'provider': 'msg91', 'error': 'MSG91_WHATSAPP_SENDER not configured.'}
        if not self.msg91_whatsapp_template_id:
            return {'ok': False, 'provider': 'msg91', 'error': 'MSG91_WHATSAPP_TEMPLATE_ID not configured.'}
        number = self._normalize_mobile(whatsapp_number)
        try:
            resp = requests.post(
                'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/',
                headers=self._msg91_headers(),
                json={
                    'integrated_number': self.msg91_whatsapp_sender,
                    'content_type':      'template',
                    'payload': {
                        'messaging_product': 'whatsapp',
                        'type':              'template',
                        'template': {
                            'name':     self.msg91_whatsapp_template_id,
                            'language': {'code': 'en'},
                            'to_and_components': [{
                                'to': [number],
                                'components': [{
                                    'type':       'body',
                                    'parameters': [{'type': 'text', 'text': body[:1000]}],
                                }],
                            }],
                        },
                    },
                },
                timeout=20,
            )
            if resp.ok:
                try:
                    return {'ok': True, 'provider': 'msg91', 'response': resp.json()}
                except Exception:
                    return {'ok': True, 'provider': 'msg91', 'response': {'raw': resp.text[:200]}}
            return {'ok': False, 'provider': 'msg91', 'error': resp.text}
        except Exception as exc:
            return {'ok': False, 'provider': 'msg91', 'error': str(exc)}
