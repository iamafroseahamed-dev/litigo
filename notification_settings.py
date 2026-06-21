from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import requests


PROVIDER_TYPE = 'messaging'
PROVIDER_NAME = 'msg91'


def _supabase_url() -> str:
    return (os.environ.get('SUPABASE_URL', '') or os.environ.get('VITE_SUPABASE_URL', '')).rstrip('/')


def _supabase_key() -> str:
    return (
        os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
        or os.environ.get('SUPABASE_ANON_KEY', '')
        or os.environ.get('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    )


def _headers(auth_token: str = '') -> Dict[str, str]:
    key = _supabase_key()
    return {
        'apikey': key,
        'Authorization': auth_token or f'Bearer {key}',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }


def _require_configured() -> None:
    if not _supabase_url() or not _supabase_key():
        raise RuntimeError('SUPABASE URL and Supabase key must be configured.')


def _normalize_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'auth_key':               (payload.get('auth_key')               or '').strip(),
        'sender_id':              (payload.get('sender_id')              or '').strip(),
        'sms_template_id':        (payload.get('sms_template_id')        or '').strip(),
        'whatsapp_sender_number': (payload.get('whatsapp_sender_number') or '').strip(),
        'whatsapp_template_id':   (payload.get('whatsapp_template_id')   or '').strip(),
        'whatsapp_flow_id':       (payload.get('whatsapp_flow_id')       or '').strip(),
    }


def _settings_response(row: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    config = (row or {}).get('config') or {}
    return {
        'id':                     (row or {}).get('id'),
        'organization_id':        (row or {}).get('organization_id'),
        'provider_type':          (row or {}).get('provider_type') or PROVIDER_TYPE,
        'provider_name':          (row or {}).get('provider_name') or PROVIDER_NAME,
        'active':                 bool((row or {}).get('active', True)),
        'auth_key_present':       bool(config.get('auth_key')),
        'sender_id':              config.get('sender_id') or '',
        'sms_template_id':        config.get('sms_template_id') or '',
        'whatsapp_sender_number': config.get('whatsapp_sender_number') or '',
        'whatsapp_template_id':   config.get('whatsapp_template_id') or '',
        'whatsapp_flow_id':       config.get('whatsapp_flow_id') or '',
        'created_at':             (row or {}).get('created_at'),
        'updated_at':             (row or {}).get('updated_at'),
    }


def get_msg91_settings(organization_id: str, auth_token: str = '') -> Dict[str, Any]:
    _require_configured()
    resp = requests.get(
        f'{_supabase_url()}/rest/v1/notification_providers',
        headers=_headers(auth_token),
        params={
            'select': 'id,organization_id,provider_type,provider_name,config,active,created_at,updated_at',
            'organization_id': f'eq.{organization_id}',
            'provider_type': f'eq.{PROVIDER_TYPE}',
            'provider_name': f'eq.{PROVIDER_NAME}',
            'order': 'created_at.desc',
            'limit': '1',
        },
        timeout=30,
    )
    resp.raise_for_status()
    rows = resp.json() or []
    return _settings_response(rows[0] if rows else None)


def save_msg91_settings(organization_id: str, payload: Dict[str, Any], auth_token: str = '') -> Dict[str, Any]:
    _require_configured()

    base_payload = _normalize_payload(payload)

    existing = get_msg91_settings(organization_id, auth_token)
    existing_row = None
    if existing.get('id'):
        existing_resp = requests.get(
            f'{_supabase_url()}/rest/v1/notification_providers',
            headers=_headers(auth_token),
            params={
                'select': 'id,config',
                'id': f'eq.{existing["id"]}',
                'limit': '1',
            },
            timeout=30,
        )
        existing_resp.raise_for_status()
        rows = existing_resp.json() or []
        existing_row = rows[0] if rows else None

    current_config = (existing_row or {}).get('config') or {}
    merged_config = dict(current_config)

    if base_payload['auth_key']:
        merged_config['auth_key'] = base_payload['auth_key']
    elif not merged_config.get('auth_key'):
        raise ValueError('MSG91 Auth Key is required the first time you save these settings.')

    merged_config['sender_id']              = base_payload['sender_id']
    merged_config['sms_template_id']        = base_payload['sms_template_id']
    merged_config['whatsapp_sender_number'] = base_payload['whatsapp_sender_number']
    merged_config['whatsapp_template_id']   = base_payload['whatsapp_template_id']
    merged_config['whatsapp_flow_id']       = base_payload['whatsapp_flow_id']

    now_iso = datetime.now(timezone.utc).isoformat()
    row_payload = {
        'organization_id': organization_id,
        'provider_type': PROVIDER_TYPE,
        'provider_name': PROVIDER_NAME,
        'config': merged_config,
        'active': True,
        'updated_at': now_iso,
    }

    if existing_row and existing_row.get('id'):
        resp = requests.patch(
            f'{_supabase_url()}/rest/v1/notification_providers',
            headers={**_headers(auth_token), 'Prefer': 'return=minimal'},
            params={'id': f'eq.{existing_row["id"]}'},
            json=row_payload,
            timeout=30,
        )
        resp.raise_for_status()
        row_payload['id'] = existing_row['id']
    else:
        row_payload['created_at'] = now_iso
        resp = requests.post(
            f'{_supabase_url()}/rest/v1/notification_providers',
            headers={**_headers(auth_token), 'Prefer': 'return=minimal'},
            json=row_payload,
            timeout=30,
        )
        resp.raise_for_status()

    return _settings_response(row_payload)