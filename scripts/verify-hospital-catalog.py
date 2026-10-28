#!/usr/bin/env python3
"""Check source integrity, hospital applicability, and complete reading content."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
catalog = json.loads((ROOT / 'dist/assets/catalogo.json').read_text())
curated = json.loads((ROOT / 'data/curacion.json').read_text())
documents = {d['id']: d for d in catalog['documents']}
items = {i['id']: i for i in catalog['items']}
assert len(items) == 48
assert Counter(i['kind'] for i in items.values()) == {'evaluation': 20, 'complementary': 28}
assert set(items) == {i['id'] for i in curated['items']}
assert set(i['categoryId'] for i in items.values()) == {'03', '09', '10', '11', '12', '13', '15'}
assert 'comp-11-gasto-per-capita-complejidad' not in items
for doc in documents.values():
    file = ROOT / 'dist' / doc['file']
    assert file.is_file() and file.read_bytes().startswith(b'%PDF'), file
    assert hashlib.sha256(file.read_bytes()).hexdigest() == doc['sha256'], file
for item in items.values():
    assert item['sourceId'] in documents
    assert item['hospitalScopes'] and set(item['hospitalScopes']) <= {'Segundo Nivel', 'Tercer Nivel'}
    assert item['hospitalApplicabilityText'] and item['serviceTags']
    for field in ('requiredActions', 'recording', 'calculation', 'sourceLabel', 'target'):
        assert item.get(field), (item['id'], field)
    assert isinstance(item.get('pitfalls'), list)
    assert item['fullReadingPages'], item['id']
    def compact(value):
        return re.sub(r'\s+', '', value)
    content = ''.join(block['label'] + block['text'] if block['kind'] == 'field' else block['sourceText'] if block['kind'] == 'table' else block['text'] for page in item['fullReadingPages'] for block in page['blocks'])
    assert Counter(compact(content)) == Counter(compact(item['fullText'])), item['id']
    assert all('code' in code and code.get('role') and code.get('criteria') for code in item.get('cie10', []))
assert items['10-02-1.0']['hospitalScopes'] == ['Tercer Nivel']
assert items['03-02-2.0']['hospitalScopes'] == ['Segundo Nivel']
assert items['03-03-3.0']['hospitalScopes'] == ['Segundo Nivel']
for identity, first, last in (('12-01-1.0', 166, 169), ('12-04-1.0', 200, 203)):
    item = items[identity]
    assert item['sourcePage'] == first and item['sourceEndPage'] == last
    assert item['sourceStatus'] == 'general_design_fallback'
    assert [p['number'] for p in item['fullReadingPages']] == list(range(first, last + 1))
    assert documents[item['sourceId']]['pages'] == 209
assert items['11-02-3.0']['fullTextTranscription'] is True
config = json.loads((ROOT / 'dist/assets/config.json').read_text())
assert config.get('analyticsMeasurementId') != 'G-ZF3D4DNPKB'
print('Catálogo hospitalario verificado: 48 fichas, 20 de evaluación, 28 complementarias; fuentes y lectura íntegra conservadas; ámbitos y respaldos identificados.')
