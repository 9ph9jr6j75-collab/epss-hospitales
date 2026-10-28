#!/usr/bin/env python3
"""Check clinical column relationships in the hospital Full reader output."""
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
catalog = json.loads((ROOT / 'dist/assets/catalogo.json').read_text())
items = {item['id']: item for item in catalog['items']}


def compact(text):
    return re.sub(r'\s+', '', str(text))


def blocks(code):
    return [block for page in items[code]['fullReadingPages'] for block in page['blocks']]


def tables(code, table_id):
    return [block for block in blocks(code) if block['kind'] == 'table' and block.get('tableId') == table_id]


def values(row):
    return {cell['colStart']: re.sub(r'\s+', ' ', cell['text']).strip() for cell in row['cells']}


table_count = 0
for item in catalog['items']:
    full_blocks = [block for page in item['fullReadingPages'] for block in page['blocks']]
    source_text = ''.join(block['sourceText'] if block['kind'] == 'table' else
                          block.get('label', '') + block.get('text', '') for block in full_blocks)
    assert Counter(compact(source_text)) == Counter(compact(item['fullText'])), item['id'] + ': source characters changed'
    for block in full_blocks:
        if block['kind'] != 'table':
            continue
        table_count += 1
        cells = block.get('caption', '') + ''.join(block.get('headers', [])) + ''.join(cell['text'] for row in block['rows'] for cell in row['cells'])
        assert Counter(compact(cells)) == Counter(compact(block['sourceText'])), item['id'] + ': missing or duplicate table cell'
        headers = block.get('contextHeaders', block['headers'])
        assert all(0 <= cell['colStart'] < len(headers) for row in block['rows'] for cell in row['cells']), item['id']

# Source baseline clinical relationships: group/CTAS must survive merged cells
# and the page break (a flat sequence of numbers is insufficient).
emergency = tables('12-01-1.0', 'emergencias-proximidad')
assert [len(table['rows']) for table in emergency] == [10, 14]
assert emergency[1]['headers'] == []
assert emergency[1]['contextHeaders'][1] == 'CTAS'
first_continued = emergency[1]['rows'][0]
assert first_continued['context'] == 'Regionales'
assert values(first_continued) == {1: 'BLANCO', 2: '-0,256', 3: '1,372', 4: '0,686'}
waiting = tables('12-01-1.0', 'emergencias-espera')[0]
assert values(waiting['rows'][-1]) == {0: 'AS TIPO 3', 1: '0:05:44', 2: '0:09:11', 3: '0:16:02', 4: '0:35:21', 5: '0:55:09'}
permanence = tables('12-01-1.0', 'emergencias-permanencia')[0]
assert len(permanence['rows']) == 6
assert values(permanence['rows'][0])[1] == '1:17:23'

# The mortality table's expected deaths, observed deaths and confidence limits
# have distinct columns; check the source row instead of only counting cells.
mortality = tables('12-05-1.0', 'mortalidad-base')
assert [len(table['rows']) for table in mortality] == [12, 11]
assert mortality[0]['headers'][3] == 'Muertes esperadas (IMHAR)'
assert values(mortality[0]['rows'][0]) == {0: '2101', 1: '9547', 2: '929', 3: '1175,4', 4: '0,84', 5: '0,79', 6: '0,74', 7: '0,260', 8: 'Inferior a modelo'}
assert mortality[1]['contextHeaders'][5] == 'Real/ Esperado'
assert sum(len(table['rows']) for table in tables('12-04-1.0', 'ieac-proximidad')) == 15
assert sum(len(table['rows']) for table in tables('12-02-1.0', 'consulta-proximidad')) == 35

device_formula = next(block['formula'] for block in blocks('15-01-1.0') if block.get('formula'))
assert 'Total de infecciones asociadas a dispositivo' in device_formula['numerator']
assert 'Total de días de exposición a dispositivo' in device_formula['denominator']
assert compact(device_formula['multiplier']) == 'x1000díasdeexposición'
needle_formula = next(block for block in blocks('10-01-1.1') if block.get('formula'))
assert '* son los casos' in needle_formula['formulaNote']
assert '* son los casos' not in needle_formula['formula']['denominator']
assert table_count >= 19, 'Management baseline and annex tables are missing'
print(f'Hospital Full verified: {len(items)} source-exact fichas, {table_count} tables; CTAS groups, IMHAR columns and IAAS exposure denominator preserved.')
