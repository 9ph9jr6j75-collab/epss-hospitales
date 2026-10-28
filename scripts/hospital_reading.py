"""Source-exact presentation of the hospital fichas' baseline tables.

Only recognised source headers and complete numeric rows are promoted to tables.
An unrecognised or incomplete row stays in ordinary Full text. Continuation
headers and merged row contexts are presentation labels, never replacement text.
"""
import re
from collections import Counter


def compact(value):
    return re.sub(r'\s+', '', value)


NUMBER = r'-?\d+(?:[,.]\d+)?%?'
CENTRE = r'(?:\d{4}|Especializado|Nacional|Periférico[ \n]+[123]|Regional|Total|AS TIPO 3)'
CTAS = r'(?:AZUL|ROJO|AMARILLO|VERDE|BLANCO|NO CLASIFICADO)'


def spaced(value):
    return r'\s+'.join(re.escape(word) for word in value.split())


def definition(name, headers, values, *, source_header=None, time=False, ctas=False, result=False, caption=''):
    return {
        'name': name, 'headers': headers, 'values': values,
        'header': re.compile(spaced(source_header or ' '.join(headers))),
        'time': time, 'ctas': ctas, 'result': result, 'caption': caption,
    }


TABLES = [
    definition('emergencias-proximidad', ['Tipo de centro', 'CTAS', 'Prox. promedio Espera CTAS', 'Prox promedio permanencia', 'Proximidad Ajustada'], 3, ctas=True),
    definition('emergencias-espera', ['Tipo de centro', 'AZUL', 'ROJO', 'AMARILLO', 'VERDE', 'BLANCO'], 5,
               source_header='Promedio espera Clasificación CTAS Tipo de centro AZUL ROJO AMARILLO VERDE BLANCO',
               caption='Promedio espera Clasificación CTAS', time=True),
    definition('emergencias-permanencia', ['Tipo de centro', 'AZUL', 'ROJO', 'AMARILLO', 'VERDE', 'BLANCO'], 5,
               source_header='Clasificación CTAS Tipo de centro AZUL ROJO AMARILLO VERDE BLANCO', caption='Clasificación CTAS', time=True),
    definition('consulta-proximidad', ['Tipo y centro', 'Proximidad IP', 'Proximidad A/C', 'Proximidad CHP', 'Proximidad Ajustada CE'], 4),
    definition('consulta-cupos', ['Tipo centro y UP', 'Cupos por hora programada'], 1),
    definition('consulta-productividad', ['Tipo de centro y UP', 'índice Productividad'], 1),
    definition('consulta-altas', ['Tipo de centro y UP', 'Razón Altas/ Citas Nuevas'], 1),
    definition('camas-proximidad', ['', 'Proximidad GC', 'Proximidad PO', 'Proximidad EP', 'Proximidad IS', 'Proximidad Ajustada'], 5),
    definition('camas-estancia', ['Tipo de centro', 'Estancia promedio'], 1),
    definition('camas-ocupacion', ['Tipo de centro', 'Porcentaje ocupación'], 1),
    definition('camas-giro', ['Tipo de centro', 'Giro Cama'], 1),
    definition('camas-sustitucion', ['Tipo de centro', 'Índice sustitución de paciente por cama'], 1),
    definition('ieac-proximidad', ['', 'Proximidad IEAC', 'Proximidad PO', 'Proximidad ajustada'], 3),
    definition('mortalidad-base', ['centro', 'Observaciones válidas', 'Muertes reales', 'Muertes esperadas (IMHAR)', 'Límite superior', 'Real/ Esperado', 'Límite inferior', 'Proximidad a IMHAR', 'Resultado'], 7, result=True),
]

FRACTIONS = [
    re.compile(r'^(?P<numerator>Meta - Logro promedio|Logro promedio-Meta)\n(?P<denominator>Meta)(?=\n|$)', re.MULTILINE),
    re.compile(r'^(?P<numerator>Proximidad del indicador 1 \+ Proximidad del indicador 2(?:\+ Proximidad indicador 3)?)\n(?P<denominator>[23])(?=\n|$)', re.MULTILINE),
]


def split_known_fractions(block):
    if block['kind'] not in ('field', 'prose'):
        return [block]
    text = block['text']
    found = [match for pattern in FRACTIONS if (match := pattern.search(text))]
    if not found:
        return [block]
    match = min(found, key=lambda value: value.start())
    result = []
    before = text[:match.start()].strip()
    if before or block['kind'] == 'field':
        result.append({**block, 'text': before})
    result.append({'kind': 'formula', 'text': match.group(), 'formula': {
        'numerator': match['numerator'], 'denominator': match['denominator'], 'multiplier': '',
    }})
    after = text[match.end():].strip()
    if after:
        result.extend(split_known_fractions({'kind': 'prose', 'text': after}))
    return result


def read_rows(text, start, spec, current_group=None):
    """Read whole rows only, preserving source spelling and merged group labels."""
    value = r'\d{1,2}:\d{2}:\d{2}' if spec['time'] else NUMBER
    numbers = rf'(?P<values>{value}(?:[ \t]+{value}){{{spec["values"] - 1}}})'
    if spec['ctas']:
        prefix = rf'(?:(?P<group>Nacionales|Regionales|Periféricos [13])[ \t]+)?(?P<label>{CTAS})'
    else:
        prefix = rf'(?P<label>{CENTRE})'
    suffix = r'[ \t]+(?P<result>Inferior a modelo|Excede modelo|Ajustado a modelo)' if spec['result'] else ''
    row_pattern = re.compile(rf'{prefix}[ \t]+{numbers}{suffix}(?=[ \t]*(?:\n|$))')
    pos, last_end, rows = start, start, []
    while True:
        whitespace = re.match(r'\s*', text[pos:])
        pos += whitespace.end()
        match = row_pattern.match(text, pos)
        if not match:
            break
        cells = []
        row = {'cells': cells}
        if spec['ctas']:
            group = match['group']
            if group:
                current_group = group
                cells.append({'text': group, 'colStart': 0})
            elif current_group:
                row['context'] = current_group
            cells.append({'text': match['label'], 'colStart': 1})
            number_start = 2
        else:
            cells.append({'text': match['label'], 'colStart': 0})
            number_start = 1
        cells.extend({'text': item, 'colStart': index + number_start}
                     for index, item in enumerate(match['values'].split()))
        if spec['result']:
            cells.append({'text': match['result'], 'colStart': spec['values'] + 1})
        rows.append(row)
        pos = last_end = match.end()
    return rows, last_end, current_group


def table_source(block):
    return block['sourceText'] if block['kind'] == 'table' else block.get('label', '') + block.get('text', '')


def split_table(block, continuation=None):
    if block['kind'] not in ('field', 'prose'):
        return [block], continuation
    text = block['text']
    candidates = [(match.start(), match.end(), spec, False)
                  for spec in TABLES if (match := spec['header'].search(text))]
    if continuation:
        # A source page number may precede a table continued from the prior page.
        prefix = re.match(r'\s*(?:\d{1,3}\s*\n)?', text)
        rows, end, group = read_rows(text, prefix.end(), continuation['spec'], continuation.get('group'))
        if rows:
            candidates.append((prefix.end(), prefix.end(), continuation['spec'], True))
    if not candidates:
        return [block], None
    begin, header_end, spec, continued = min(candidates, key=lambda candidate: candidate[0])
    rows, end, group = read_rows(text, header_end, spec, continuation.get('group') if continued else None)
    if not rows:
        return [block], None
    original = text[begin:end]
    table = {'kind': 'table', 'caption': '' if continued else spec['caption'],
             'headers': [] if continued else spec['headers'], 'rows': rows, 'sourceText': original,
             'tableId': spec['name']}
    if continued:
        table['contextHeaders'] = spec['headers']
    actual = table['caption'] + ''.join(table['headers']) + ''.join(cell['text'] for row in rows for cell in row['cells'])
    if Counter(compact(actual)) != Counter(compact(original)):
        # No partial or guessed conversion. Keep the unmodified source text.
        return [block], None
    result = []
    before = text[:begin].strip()
    if before or block['kind'] == 'field':
        result.append({**block, 'text': before})
    result.append(table)
    after = text[end:].strip()
    if after:
        rest, state = split_table({'kind': 'prose', 'text': after})
        result.extend(rest)
        return result, state
    return result, {'spec': spec, 'group': group}


def enhance_hospital_reading(pages, item_id):
    if not item_id.startswith(('12-', 'comp-12')):
        return pages
    before = Counter(compact(''.join(table_source(block) for page in pages for block in page['blocks'])))
    state = None
    for page in pages:
        output = []
        for block in page['blocks']:
            if block['kind'] == 'identity':
                output.append(block)
                continue
            blocks, state = split_table(block, state)
            output.extend(blocks)
        page['blocks'] = [part for block in output for part in split_known_fractions(block)]
    after = Counter(compact(''.join(table_source(block) for page in pages for block in page['blocks'])))
    if before != after:
        raise ValueError('Hospital Full tables changed source characters')
    return pages
