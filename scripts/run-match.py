"""
Standalone runner for the match-todays-listings job.
Run this directly to populate today_matched_listings without needing Vercel:

    .venv\Scripts\python.exe scripts/run-match.py

Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env in the project root.
"""
import os, sys

# Load .env
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(root, '.env')
if os.path.exists(env_path):
    for line in open(env_path):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

# Add api/ to path so we can import the handler module
sys.path.insert(0, os.path.join(root, 'api'))

# Simulate the Vercel POST by calling handle logic directly
import json, re, time, unicodedata, requests
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from bs4 import BeautifulSoup
from typing import Any, Dict, List, Optional, Tuple

# Re-use all the logic from the match-todays-listings module
import importlib.util
spec = importlib.util.spec_from_file_location(
    'match_listings',
    os.path.join(root, 'api', 'match-todays-listings.py'),
)
mod = importlib.util.load_from_spec = spec
match_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(match_mod)

SUPABASE_URL = match_mod.SUPABASE_URL
SUPABASE_KEY = match_mod.SUPABASE_KEY
IST          = match_mod.IST

if not SUPABASE_URL or not SUPABASE_KEY:
    print('ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')
    sys.exit(1)

print('=== Match-Todays-Listings Local Runner ===')
today_ist = datetime.now(IST).date().isoformat()
today     = match_mod._latest_cause_date(today_ist)

if not today:
    print('No cause list data found in the database.')
    sys.exit(0)

print(f'IST date : {today_ist}')
print(f'Using cause_date : {today}')

# Cause list
cause_list = match_mod._get_all('daily_cause_list', {
    'select': ('id,case_number,cnr_number,court_hall,item_number,'
               'judge_name,last_hearing_or_stage,petitioner,respondent'),
    'cause_date': f'eq.{today}',
    'order':      'court_hall.asc,item_number.asc',
})
print(f'Cause list rows : {len(cause_list)}')

# Cases
cases = match_mod._get_all('cases', {
    'select': 'id,organization_id,case_number,cnr_number',
    'active': 'eq.true',
})
print(f'Active cases     : {len(cases)}')

# Build maps
cl_by_cnr: Dict[str, Dict] = {}
cl_by_norm: Dict[str, Dict] = {}
for cl in cause_list:
    raw_cnr = (cl.get('cnr_number') or '').strip()
    if raw_cnr:
        cl_by_cnr[raw_cnr.lower()] = cl
    norm_cn = match_mod.normalize_case_number(cl.get('case_number') or '')
    if norm_cn:
        cl_by_norm[norm_cn] = cl

# Match
BASE_COLS = match_mod.BASE_COLS
base_matches: List[Dict] = []
seen: set = set()

for c in cases:
    matched_cl = None
    match_type = 'case_number'
    case_cnr = (c.get('cnr_number') or '').strip()

    if case_cnr and case_cnr.lower() in cl_by_cnr:
        matched_cl = cl_by_cnr[case_cnr.lower()]
        match_type = 'cnr'

    if not matched_cl:
        nk = match_mod.normalize_case_number(c.get('case_number') or '')
        if nk and nk in cl_by_norm:
            matched_cl = cl_by_norm[nk]

    if not matched_cl:
        continue

    pair = (c['id'], matched_cl['id'])
    if pair in seen:
        continue
    seen.add(pair)

    cl_norm = match_mod.normalize_case_number(matched_cl.get('case_number') or '')
    c_norm  = match_mod.normalize_case_number(c.get('case_number') or '')
    print(f'  MATCH ({match_type}): CL={matched_cl.get("case_number")!r}({cl_norm}) | CASE={c.get("case_number")!r}({c_norm})')

    item_raw = matched_cl.get('item_number')
    base_matches.append({
        'match_date':          today,
        'organization_id':     c.get('organization_id'),
        'case_id':             c['id'],
        'daily_cause_list_id': matched_cl['id'],
        'case_number':         matched_cl.get('case_number'),
        'cnr_number':          matched_cl.get('cnr_number') or (case_cnr or None),
        'court_hall':          matched_cl.get('court_hall'),
        'item_number':         str(item_raw).strip() if item_raw is not None else None,
        'judge_name':          matched_cl.get('judge_name'),
        'stage':               matched_cl.get('last_hearing_or_stage'),
        'petitioner':          matched_cl.get('petitioner'),
        'respondent':          matched_cl.get('respondent'),
        'match_type':          match_type,
        'match_status':        'matched',
        'notification_status': 'not_notified',
    })

print(f'\nMatched : {len(base_matches)} cases')

if not base_matches:
    print('Nothing to insert.')
    sys.exit(0)

# Delete existing + insert
hdrs = match_mod._sb_headers()
requests.delete(
    f'{SUPABASE_URL}/rest/v1/today_matched_listings',
    headers=hdrs, params={'match_date': f'eq.{today}'}, timeout=30,
)

r = requests.post(
    f'{SUPABASE_URL}/rest/v1/today_matched_listings',
    headers=hdrs, json=base_matches, timeout=30,
)
if r.ok:
    print(f'Inserted {len(base_matches)} rows into today_matched_listings.')
else:
    err = r.json() if 'json' in r.headers.get('content-type','') else r.text
    if isinstance(err, dict) and err.get('code') == '42703':
        print('Migration 004 not applied — inserting base columns only.')
        base_only = [{k: v for k, v in row.items() if k in BASE_COLS} for row in base_matches]
        r2 = requests.post(
            f'{SUPABASE_URL}/rest/v1/today_matched_listings',
            headers=hdrs, json=base_only, timeout=30,
        )
        if r2.ok:
            print(f'Inserted {len(base_only)} rows (base columns only).')
            print('NOTE: Run migration 004 in Supabase to enable eCourts enrichment.')
        else:
            print(f'Insert failed: {r2.status_code} {r2.text[:300]}')
    else:
        print(f'Insert failed: {r.status_code} {err}')
