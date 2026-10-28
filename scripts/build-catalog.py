#!/usr/bin/env python3
"""Compila las fichas curadas y sus PDF sin alterar los documentos fuente."""
import hashlib
import json
import pathlib
import re
import subprocess
from collections import Counter
from hospital_reading import enhance_hospital_reading

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
ASSETS = ROOT / 'dist' / 'assets'

# These two administrative fields are emitted in logical cell order by Poppler's
# raw mode.  The layout extraction can place the vertically centred "Nombre"
# label in the middle of its value, so it cannot safely supply a stacked field.
# Keep the complete Código cell: oral-health fichas print two or four codes in
# one cell and share a single Nombre, rather than repeating that name per code.
CODE_VALUE = r'\d{2}-\d{2}-\d+(?:\.\d+)*'
METADATA_PATTERN = re.compile(
    r'^(?P<codeLabel>Código|Codigo)[ \t]*(?:\n[ \t]*)?'
    r'(?P<code>' + CODE_VALUE + r'(?:[ \t]+' + CODE_VALUE + r')*)[ \t]*\n'
    r'(?P<nameLabel>Nombre)[ \t]*(?P<name>[^\f]{1,2000}?)'
    r'(?=\nDefinición(?:[ \t]+conceptual|\n[ \t]*conceptual)?[ \t]*\n)',
    re.MULTILINE,
)
COMPLEMENTARY_METADATA_PATTERN = re.compile(
    r'^(?P<evaluationLabel>Indicador(?:es)?[ \t]*(?:\n[ \t]*)?de[ \t]*(?:\n[ \t]*)?Evaluaci[oó]n)'
    r'[ \t]*(?P<evaluationValue>[^\f]{1,6000}?)\n'
    r'(?P<complementaryLabel>Indicador(?:es)?[ \t]*(?:\n[ \t]*)?Complementario(?:s)?)'
    r'[ \t]*(?P<complementaryValue>[^\f]{1,3000}?)'
    r'(?=\nDefinición(?:[ \t]+conceptual|\n[ \t]*conceptual)?[ \t]*\n)',
    re.MULTILINE | re.IGNORECASE,
)


def compact(text):
    return re.sub(r'\s+', '', text)


def layout_without_field_labels(layout_text, labels):
    """Remove possible wrapped left-column labels for matching only.

    This temporary string is never displayed or saved as source text. The
    narrow left margin excludes the right-hand cell text in these fichas. Some
    narrow labels fill that column and leave only one separating space.
    """
    fragments = set()
    for label in labels:
        words = label.split()
        for start in range(len(words)):
            for end in range(start + 1, len(words) + 1):
                fragments.add(' '.join(words[start:end]))
    alternatives = '|'.join(
        re.escape(fragment).replace(r'\ ', r'[ \t]+')
        for fragment in sorted(fragments, key=len, reverse=True)
    )
    pattern = r'^[ \t]{0,12}(?:' + alternatives + r')(?=[ \t]|$)'
    return re.sub(pattern, '', layout_text, flags=re.MULTILINE)


def extract_full_metadata(raw_text, layout_text):
    """Return source-exact administrative cells only when extraction is safe.

    No clinical wording is generated or changed. The raw and layout readings
    must contain the same non-whitespace characters. Each complete name must
    also occur in layout order after removing a possible interposed Nombre
    label. Scans and ambiguous extractions retain their original Full text.
    """
    if not raw_text.strip() or Counter(compact(raw_text)) != Counter(compact(layout_text)):
        return []
    layout_names = re.sub(r'^[ \t]*Nombre(?=[ \t]{2,}|[ \t]*$)', '', layout_text, flags=re.MULTILINE)
    layout_compact = compact(layout_text)
    names_compact = compact(layout_names)
    result = []
    for match in METADATA_PATTERN.finditer(raw_text):
        code = ' '.join(match.group('code').split())
        name = ' '.join(match.group('name').split())
        if compact(code) not in layout_compact or compact(name) not in names_compact:
            continue
        result.append((match.start(), {
            'code': code,
            'name': name,
            'codeLabel': match.group('codeLabel'),
            'nameLabel': match.group('nameLabel'),
        }))
    for match in COMPLEMENTARY_METADATA_PATTERN.finditer(raw_text):
        fields = [
            {
                'label': ' '.join(match.group('evaluationLabel').split()),
                'value': ' '.join(match.group('evaluationValue').split()),
            },
            {
                'label': ' '.join(match.group('complementaryLabel').split()),
                'value': ' '.join(match.group('complementaryValue').split()),
            },
        ]
        if not all(field['value'] for field in fields):
            continue
        cells_compact = compact(layout_without_field_labels(layout_text, [field['label'] for field in fields]))
        if not all(compact(field['value']) in cells_compact for field in fields):
            continue
        result.append((match.start(), {'fields': fields}))
    return [entry for _, entry in sorted(result, key=lambda pair: pair[0])]


# Read the ordinary ficha cells in PDF logical order. Keeping the two-column
# physical layout in a PRE makes its actual value sit outside a phone viewport.
# The source text and PDF remain untouched; every displayed source character is
# checked again after this grouping.
READING_FIELD_LABELS = [
    'Indicadores precursores',
    'Indicadores de Evaluación', 'Indicador de Evaluación',
    'Indicadores Complementarios', 'Indicador Complementario',
    'Variables involucradas en la medición',
    'Componente de la atención integral', 'Componente de la prestación',
    'Presentación de resultados', 'Definición conceptual',
    'Fuente de información', 'Comentarios generales', 'Nivel de atención',
    'Fórmula de cálculo', 'Desagregación', 'Periodicidad', 'Clasificación',
    'Línea base', 'Temática', 'Código', 'Codigo', 'Nombre', 'Meta',
]
READING_FIELD_PATTERN = re.compile(
    r'^(?P<label>' + '|'.join(
        r'[ \t]*(?:\n[ \t]*)?'.join(re.escape(word) for word in label.split())
        for label in sorted(READING_FIELD_LABELS, key=len, reverse=True)
    ) + r')(?=[ \t\n]|$)[ \t]*', re.MULTILINE,
)
READING_IDENTITY_LINE = re.compile(
    r'^(?:CAJA COSTARRICENSE DE SEGURO SOCIAL(?:[ \t]+2024[ \t]*-[ \t]*2028)?|'
    r'GERENCIA MÉDICA|DIRECCIÓN COMPRA DE SERVICIOS DE SALUD|'
    r'EVALUACIÓN DE LA PRESTACIÓN DE SERVICIOS DE SALUD|'
    r'FICHA TÉCNICA DEL INDICADOR(?: COMPLEMENTARIO)?|'
    r'2024[ \t]*-[ \t]*2028|Elemento[ \t]+Descripción)[ \t]*$'
)


def source_text_for_reading(block):
    if block['kind'] == 'field':
        return block['label'] + block['text']
    if block['kind'] == 'table':
        return block['sourceText']
    return block['text']


def ratio_formula(text):
    exposure = re.fullmatch(
        r'(?P<numerator>Total de infecciones asociadas a dispositivo[\s\S]+?)\s*'
        r'(?P<multiplier>[xX×][ \t]*1000\s+días de\s+exposición)\s*'
        r'(?P<denominator>Total de días de exposición a dispositivo[\s\S]+)', text,
    )
    if exposure:
        return {name: exposure[name].strip() for name in ('numerator', 'denominator', 'multiplier')}
    matches = list(re.finditer(r'[xX×][ \t]*100\b', text))
    if len(matches) != 1:
        return None
    match = matches[0]
    numerator = text[:match.start()].strip()
    denominator = text[match.end():].strip()
    if not numerator or not denominator:
        return None
    return {'numerator': numerator, 'denominator': denominator, 'multiplier': match.group()}


def table_block(caption, headers, rows, source_text):
    table = {'kind': 'table', 'caption': caption, 'headers': headers, 'rows': rows, 'sourceText': source_text}
    cells_text = caption + ''.join(headers) + ''.join(cell['text'] for row in rows for cell in row['cells'])
    if Counter(compact(cells_text)) != Counter(compact(source_text)):
        raise ValueError('La tabla de lectura no coincide con los caracteres de su fuente')
    return table


def find_reading_table(text):
    """The three true embedded tables, checked against physical source cells.

    Each source cell occurs once. A prenatal cell's start/span preserves the
    original merged-age-column relationship without repeating interventions.
    """
    prenatal = re.search(
        r'Intervenciones del paquete básico según rango de edad gestacional al\n'
        r'momento del corte para la evaluación\n[\s\S]+?Toma de PA en el quinto\ncontrol', text,
    )
    if prenatal:
        caption = 'Intervenciones del paquete básico según rango de edad gestacional al momento del corte para la evaluación'
        headers = ['1 a 19 semanas', '20 a 28 semanas', '29 a 32 semanas', '33 a 40 semanas', '41 semanas y más']
        interventions = [
            (0, 'Primer control en las primeras 11 semanas'),
            (0, 'Toma de presión arterial (PA) en el primer control'),
            (1, 'Detección de VDRL en las primeras 19 semanas'),
            (1, 'Detección de VIH en las primeras 19 semanas'),
            (2, 'Detección de DM pregestacional en las primeras 23 semanas'),
            (2, 'Detección de DM gestacional entre 24 y 28 semanas'),
            (2, 'Segundo control entre 12 y 20 semanas'),
            (2, 'Toma de PA en el segundo control'),
            (2, 'Tercer control entre 21 y 28 semanas'),
            (2, 'Toma de PA en tercer control'),
            (3, 'Cuarto control entre 29 y 32 semanas'),
            (3, 'Toma de PA en el cuarto control'),
            (4, 'Quinto control entre 33 y 40 semanas'),
            (4, 'Toma de PA en el quinto control'),
        ]
        rows = [{'cells': [{'text': value, 'colStart': start, 'colSpan': 5 - start}]} for start, value in interventions]
        return prenatal, table_block(caption, headers, rows, prenatal.group())
    lipids = re.search(
        r'Componentes del perfil lipídico Normal1\nRiesgo1\nAlto riesgo1\n'
        r'Colesterol total <170 170-199 ≥200\n'
        r'LDL-colesterol <110 110-129 ≥130\n'
        r'HDL-colesterol >45 40-45 <40\n'
        r'Triglicéridos menores de 10 años <75 75-99 ≥100\n'
        r'Triglicéridos edad de 10-19 años <90 90-129 ≥130', text,
    )
    if lipids:
        headers = ['Componentes del perfil lipídico', 'Normal1', 'Riesgo1', 'Alto riesgo1']
        values = [
            ['Colesterol total', '<170', '170-199', '≥200'],
            ['LDL-colesterol', '<110', '110-129', '≥130'],
            ['HDL-colesterol', '>45', '40-45', '<40'],
            ['Triglicéridos menores de 10 años', '<75', '75-99', '≥100'],
            ['Triglicéridos edad de 10-19 años', '<90', '90-129', '≥130'],
        ]
        rows = [{'cells': [{'text': value, 'colStart': col, 'colSpan': 1} for col, value in enumerate(row)]} for row in values]
        return lipids, table_block('', headers, rows, lipids.group())
    oral = re.search(r'Grupo de edad \(años\) Meta \(%\)\n0 a 9 80\n10 a 19 80\n20 a 64 75\n65 y más 73', text)
    if oral:
        values = [['0 a 9', '80'], ['10 a 19', '80'], ['20 a 64', '75'], ['65 y más', '73']]
        rows = [{'cells': [{'text': value, 'colStart': col, 'colSpan': 1} for col, value in enumerate(row)]} for row in values]
        return oral, table_block('', ['Grupo de edad (años)', 'Meta (%)'], rows, oral.group())
    return None


def split_reading_tables(blocks):
    result = []
    for block in blocks:
        match = find_reading_table(block.get('text', '')) if block['kind'] in ('field', 'prose') else None
        if not match:
            result.append(block)
            continue
        span, table = match
        before = block['text'][:span.start()].strip()
        after = block['text'][span.end():].strip()
        if before or block['kind'] == 'field':
            result.append({**block, 'text': before})
        result.append(table)
        if after:
            result.extend(split_reading_tables([{'kind': 'prose', 'text': after}]))
    return result


def reading_blocks_from_chunk(text):
    matches = []
    for candidate in READING_FIELD_PATTERN.finditer(text):
        label = ' '.join(candidate.group('label').split())
        if label == 'Meta':
            line_end = text.find('\n', candidate.end())
            line_end = len(text) if line_end < 0 else line_end
            rest = text[candidate.end():line_end].strip()
            previous = text[:candidate.start()].rstrip().split('\n')[-1].strip()
            # In the hospital proximity equations Meta occurs as numerator or
            # denominator. It is not the start of the ficha's target field.
            if rest.startswith('- Logro promedio') or previous in ('Meta - Logro promedio', 'Logro promedio-Meta'):
                continue
        if label == 'Clasificación':
            remainder = text[candidate.end():].lstrip()
            if remainder.startswith('CTAS'):
                continue
        matches.append(candidate)
    blocks = []
    first = matches[0].start() if matches else len(text)
    if text[:first].strip():
        blocks.append({'kind': 'prose', 'text': text[:first].strip()})
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        label = ' '.join(match.group('label').split())
        value = text[match.end():end].strip()
        block = {'kind': 'field', 'label': label, 'text': value}
        if compact(label).casefold() == compact('Fórmula de cálculo').casefold():
            formula = ratio_formula(value)
            if formula:
                if '\n* son los casos' in formula['denominator']:
                    denominator, note = formula['denominator'].split('\n* son los casos', 1)
                    formula['denominator'] = denominator
                    block['formulaNote'] = '* son los casos' + note
                block['formula'] = formula
        blocks.append(block)
    return blocks


def apply_formula_exceptions(pages, item_id):
    for page in pages:
        for block in page['blocks']:
            if block['kind'] != 'field' or compact(block['label']).casefold() != compact('Fórmula de cálculo').casefold():
                continue
            text = block['text']
            if item_id == '13-01-1.0':
                match = re.fullmatch(r'(?P<n>Total de puntos obtenidos[\s\S]+?)(?P<d>Total de puntos del formulario[\s\S]+?)(?P<m>[xX×][ \t]*100)', text)
                if not match:
                    raise ValueError('Revisar fórmula de Bioética antes de compilar')
                block['formula'] = {'numerator': match['n'].strip(), 'denominator': match['d'].strip(), 'multiplier': match['m']}
            elif item_id == 'comp-01-paquete-por-grupo':
                pieces = re.split(r'(?=^Número de embarazadas)', text, flags=re.MULTILINE)
                pieces = [part.strip() for part in pieces if part.strip()]
                if len(pieces) != 10:
                    raise ValueError('Revisar las cinco fórmulas prenatales antes de compilar')
                formulas = [ratio_formula(pieces[index] + '\n' + pieces[index + 1]) for index in range(0, 10, 2)]
                if not all(formulas):
                    raise ValueError('Fórmulas prenatales incompletas')
                block['formulas'] = formulas
            elif item_id in ('comp-01-transito-muestras', 'comp-11-gasto-per-capita-complejidad'):
                marker = 'Número de muestras' if item_id == 'comp-01-transito-muestras' else 'Población en el Período'
                start = text.find(marker)
                if start < 1:
                    raise ValueError('Revisar fórmula sin multiplicador antes de compilar')
                block['formula'] = {'numerator': text[:start].strip(), 'denominator': text[start:].strip(), 'multiplier': ''}
            elif item_id == '11-01-2.0':
                match = re.fullmatch(
                    r'(?P<n1>Gasto en Sueldos para Cargos Fijos2\s+año)\s*'
                    r'(?P<d1>Consultas de los profesionales de salud año)\s*'
                    r'(?P<n2>Gasto en Sueldos para Cargos Fijos2\s+año anterior)\s*'
                    r'(?P<d2>Consultas de los profesionales de salud año anterior)', text,
                )
                if not match:
                    raise ValueError('Revisar razón de razones de eficiencia antes de compilar')
                block['formula'] = {
                    'numerator': {'numerator': match['n1'].strip(), 'denominator': match['d1'].strip(), 'multiplier': ''},
                    'denominator': {'numerator': match['n2'].strip(), 'denominator': match['d2'].strip(), 'multiplier': ''},
                    'multiplier': '',
                }
            elif item_id in ('comp-02-isbd', 'comp-02-irbd', 'comp-02-ipbd'):
                block['equation'] = True


def extract_full_reading_pages(raw_text, layout_text, item_id=''):
    safe_raw = bool(raw_text.strip()) and Counter(compact(raw_text)) == Counter(compact(layout_text))
    source = raw_text if safe_raw else layout_text
    if item_id == 'comp-11-horas-medicas-dm2-hta' and safe_raw:
        # The PDF stores this two-box addition drawing after the prose although
        # visually it follows the equal sign. Move its exact source characters
        # to that position, preserving the verified source reading relationship.
        diagram = ('Horas médicas\nrequeridas para atender\na la Población con DM2\n+\n'
                   'Horas médicas\nrequeridas para atender\na la Población con HT\nno diabética')
        if source.count(diagram) != 1 or source.count('Horas requeridas =') != 1:
            raise ValueError('Revisar diagrama de horas médicas antes de compilar')
        source = source.replace(diagram, '')
        source = source.replace('Horas requeridas =', 'Horas requeridas =\n' + diagram)
    pages = []
    for number, page in enumerate(source.split('\f'), start=1):
        blocks = []
        current = []
        current_identity = None
        for line in page.splitlines():
            identity = bool(READING_IDENTITY_LINE.fullmatch(line.strip()))
            if line.strip() and current_identity is not None and identity != current_identity:
                text = '\n'.join(current).strip()
                if text:
                    blocks.extend([{'kind': 'identity', 'text': text}] if current_identity else reading_blocks_from_chunk(text))
                current = []
            if line.strip():
                current_identity = identity
            current.append(line)
        text = '\n'.join(current).strip()
        if text:
            blocks.extend([{'kind': 'identity', 'text': text}] if current_identity else reading_blocks_from_chunk(text))
        if blocks:
            pages.append({'number': number, 'blocks': split_reading_tables(blocks)})
    pages = enhance_hospital_reading(pages, item_id)
    apply_formula_exceptions(pages, item_id)
    displayed = ''.join(source_text_for_reading(block) for page in pages for block in page['blocks'])
    if Counter(compact(displayed)) != Counter(compact(layout_text)):
        raise ValueError('La lectura completa no conserva los caracteres de la fuente')
    return pages


def build():
    # Keep the familiar build entry point routed to the hospital-only compiler.
    import importlib.util
    spec = importlib.util.spec_from_file_location('hospital_compiler', ROOT / 'scripts/build-hospital-catalog.py')
    compiler = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(compiler)
    compiler.main()


if __name__ == '__main__':
    build()
