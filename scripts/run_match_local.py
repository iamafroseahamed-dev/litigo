"""Run the match logic locally against the live Supabase DB."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'api'))

import importlib.util
spec = importlib.util.spec_from_file_location(
    'match', os.path.join(os.path.dirname(__file__), '..', 'api', 'match-todays-listings.py')
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

from datetime import datetime, timezone, timedelta
IST = timezone(timedelta(hours=5, minutes=30))
today_ist = datetime.now(IST).date().isoformat()
print(f'IST today:           {today_ist}')

today = mod._latest_cause_date(today_ist)
print(f'Resolved cause date: {today}')

if not today:
    print('ERROR: No cause date found even with 7-day lookahead')
    sys.exit(1)

cause_list = mod._get_all('daily_cause_list', {
    'select': 'id,case_number,cnr_number,court_hall,item_number,judge_name,last_hearing_or_stage,petitioner,respondent',
    'cause_date': f'eq.{today}',
    'order': 'court_hall.asc,item_number.asc',
})
print(f'Cause list rows:     {len(cause_list)}')

cases = mod._get_all('cases', {
    'select': 'id,organization_id,case_number,cnr_number',
    'active': 'eq.true',
})
print(f'Active cases:        {len(cases)}')

# --- Normalisation check for CONT P/2295/2024 ---
test_cn = 'CONT P/2295/2024'
print(f'\nnormalize({test_cn!r}) = {mod.normalize_case_number(test_cn)!r}')

# --- Show all CL entries containing 2295 ---
print('\nCause-list entries containing 2295:')
for cl in cause_list:
    cn = cl.get('case_number') or ''
    if '2295' in cn:
        norm = mod.normalize_case_number(cn)
        print(f'  CL: {cn!r}  =>  {norm!r}   cnr={cl.get("cnr_number")!r}')

# --- Show all case entries containing 2295 ---
print('\nCases table entries containing 2295:')
for c in cases:
    cn = c.get('case_number') or ''
    if '2295' in cn:
        norm = mod.normalize_case_number(cn)
        print(f'  CASE: {cn!r}  =>  {norm!r}   cnr={c.get("cnr_number")!r}')

# --- Build lookup maps and attempt match ---
print('\n--- Running match ---')
cl_by_cnr  = {}
cl_by_norm = {}
for cl in cause_list:
    raw_cnr = (cl.get('cnr_number') or '').strip()
    if raw_cnr:
        cl_by_cnr[raw_cnr.lower()] = cl
    norm_cn = mod.normalize_case_number(cl.get('case_number') or '')
    if norm_cn:
        cl_by_norm[norm_cn] = cl

matched = 0
for c in cases:
    case_cnr = (c.get('cnr_number') or '').strip()
    matched_cl = None

    if case_cnr and case_cnr.lower() in cl_by_cnr:
        matched_cl = cl_by_cnr[case_cnr.lower()]
        mtype = 'cnr'

    if not matched_cl:
        norm_c = mod.normalize_case_number(c.get('case_number') or '')
        if norm_c and norm_c in cl_by_norm:
            matched_cl = cl_by_norm[norm_c]
            mtype = 'case_number'

    if matched_cl:
        matched += 1
        cn = c.get('case_number', '')
        if '2295' in cn or '2295' in (matched_cl.get('case_number') or ''):
            print(f'  MATCH ({mtype}): CASE={cn!r}  CL={matched_cl.get("case_number")!r}')

print(f'\nTotal matches: {matched} / {len(cases)} cases')

# --- Full run if matches found ---
if matched > 0:
    print('\n--- Inserting matches into today_matched_listings ---')
    import json, time, re
    from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED

    base_matches = []
    seen = set()
    for c in cases:
        case_cnr = (c.get('cnr_number') or '').strip()
        matched_cl = None
        match_type = 'case_number'

        if case_cnr and case_cnr.lower() in cl_by_cnr:
            matched_cl = cl_by_cnr[case_cnr.lower()]
            match_type = 'cnr'

        if not matched_cl:
            norm_c = mod.normalize_case_number(c.get('case_number') or '')
            if norm_c and norm_c in cl_by_norm:
                matched_cl = cl_by_norm[norm_c]

        if not matched_cl:
            continue

        pair = (c['id'], matched_cl['id'])
        if pair in seen:
            continue
        seen.add(pair)

        item_raw = matched_cl.get('item_number')
        base_matches.append({
            'listed_date':         today,
            'match_date':          today,
            'case_id':             c['id'],
            'daily_cause_list_id': matched_cl['id'],
            'case_number':         matched_cl.get('case_number'),
            'cnr_number':          case_cnr or None,
            'court_hall':          matched_cl.get('court_hall'),
            'item_number':         str(item_raw).strip() if item_raw is not None else None,
            'judge_name':          matched_cl.get('judge_name'),
            'stage':               matched_cl.get('last_hearing_or_stage'),
            'petitioner':          matched_cl.get('petitioner'),
            'respondent':          matched_cl.get('respondent'),
            'match_type':          match_type,
            'match_status':        'matched',
            'notification_status': 'pending',
            'cnr_status':          'discovered' if case_cnr else 'not_discovered',
            'ecourts_sync_status': 'pending',
        })

    # Enrich with eCourts hearing history
    print(f'Enriching {len(base_matches)} records via eCourts...')
    enriched, enriched_count = mod._enrich_all(base_matches)
    print(f'eCourts enriched: {enriched_count}')
    for m in enriched:
        cn = m.get('case_number', '')
        if '2295' in cn or '2295' in (m.get('cnr_number') or ''):
            print(f'  ecourts_sync_status={m.get("ecourts_sync_status")!r}')
            print(f'  next_hearing_date={m.get("next_hearing_date")!r}')
            print(f'  latest_case_status={m.get("latest_case_status")!r}')
            print(f'  ecourts_error={m.get("ecourts_error")!r}')

    print(f'Upserting {len(enriched)} records...')
    n = mod._safe_upsert_batch(enriched)
    print(f'Upserted: {n}')

    # Sync cases table
    print('\n--- Syncing cases table ---')
    synced = mod._sync_cases_table(enriched)
    print(f'Cases synced: {synced}')

    # Show updated case record
    import requests as _req
    sb_url = os.environ['SUPABASE_URL']
    sb_key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    hdrs = {'apikey': sb_key, 'Authorization': f'Bearer {sb_key}'}
    import json as _json
    case_r = _req.get(
        f'{sb_url}/rest/v1/cases',
        headers=hdrs,
        params={
            'id': 'eq.5cfa56ad-14e6-4aad-981c-43533031a8a2',
            'select': 'case_number,case_status,last_hearing_date,last_hearing_update,next_hearing_date,follow_up_status,ecourts_last_synced_at',
        },
    )
    print('\nUpdated case record:')
    print(_json.dumps(case_r.json(), indent=2))
