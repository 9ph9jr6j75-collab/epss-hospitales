#!/usr/bin/env python3
"""Assemble the reviewed hospital records, retaining the received PDFs intact.

The three review files and the inventory are explicit inputs, so a rebuild does
not require access to the original first-level application checkout.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import unicodedata

ROOT = Path(__file__).resolve().parents[1]


def key(value):
    return unicodedata.normalize('NFC', value or '').casefold()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inventory', required=True)
    parser.add_argument('--summaries', required=True, nargs='+')
    args = parser.parse_args()
    inventory = json.loads(Path(args.inventory).read_text())
    reviews = [item for file in args.summaries for item in json.loads(Path(file).read_text())]
    sources = inventory['fichas'] + inventory['missingWithFallback']
    by_name = {key(s['originalName']): s for s in sources}
    by_code = {s['code']: s for s in sources if s.get('code')}
    by_existing = {s['existingItemId']: s for s in sources if s.get('existingItemId')}
    categories = {'03': 'Anemia y niñez', '09': 'Tamizaje de cáncer',
                  '10': 'Síndrome coronario agudo e IAM', '11': 'Eficiencia',
                  '12': 'Gestión hospitalaria', '13': 'Bioética', '15': 'IAAS'}
    documents, items = {}, []
    destination = ROOT / 'dist/assets/fichas'
    destination.mkdir(parents=True, exist_ok=True)

    def add_document(path, original_name, title=None, role='ficha', urls=None):
        path = Path(path)
        raw = path.read_bytes()
        assert raw.startswith(b'%PDF'), f'PDF inválido: {path}'
        digest = hashlib.sha256(raw).hexdigest()
        identity = 'doc-' + digest[:16]
        target = destination / (digest[:20] + '.pdf')
        if identity not in documents:
            shutil.copyfile(path, target)
            info = subprocess.check_output(['pdfinfo', str(path)], text=True)
            pages = int(next(line.split(':', 1)[1] for line in info.splitlines() if line.startswith('Pages:')))
            documents[identity] = {'id': identity, 'file': str(target.relative_to(ROOT / 'dist')),
                'title': title or original_name.replace('_', ' ').removesuffix('.pdf'),
                'originalName': original_name, 'driveUrl': (urls or [''])[0],
                'sha256': digest, 'pages': pages, 'role': role, 'downloadedOn': '2026-10-27'}
        return identity

    for record in reviews:
        item = dict(record)
        source = by_code.get(item.get('code')) or by_name.get(key(item.get('sourceMember'))) or by_existing.get(item.get('id'))
        assert source, f'No source for {item.get("id")}: {item.get("sourceMember")}'
        fallback = 'fallbackPdf' in source
        path = source.get('path') or source['fallbackPdf']
        item['sourceId'] = add_document(path, 'Diseño general EPSS 2024-2028.pdf' if fallback else source['originalName'],
            title='Fichas técnicas EPSS 2024-2028 · diseño general' if fallback else None,
            role='base' if fallback else 'ficha', urls=source.get('sourceUrls'))
        item['sourceMember'] = source['originalName']
        item['sourceStatus'] = 'general_design_fallback' if fallback else 'published_download'
        item['effectiveFrom'] = None
        item['hospitalScopes'] = item.get('hospitalScopes') or [v for v in source['declaredLevels'] if v in ('Segundo Nivel', 'Tercer Nivel')]
        assert item['hospitalScopes'], f'Missing hospital scopes: {item["id"]}'
        if fallback:
            item['sourcePage'] = source['fallbackPageStart']
            item['sourceEndPage'] = source['fallbackPageEnd']
            item['sourceLabel'] = f'Diseño general EPSS 2024-2028 · versión {item["code"].split("-")[-1]} · páginas {item["sourcePage"]} a {item["sourceEndPage"]}'
            item.setdefault('essentialNotes', []).append('La descarga individual recibida estaba vacía. Se conserva como respaldo la ficha y sus anexos del diseño general; falta cotejarla con una descarga individual posterior.')
        item.pop('areaApplicability', None)
        # Remove generated first-level reading fields before recompiling.
        for field in ('fullMetadata', 'fullReadingPages', 'searchText', 'sourceFile', 'sourceTitle', 'sourceOriginalName', 'sourceDriveUrl', 'sourcePages', 'family', 'category'):
            item.pop(field, None)
        items.append(item)

    for source in inventory['supportingDocuments']:
        add_document(source['path'], source['originalName'], role='referencia', urls=source.get('sourceUrls'))
    counts = {'evaluation': sum(x['kind'] == 'evaluation' for x in items),
              'complementary': sum(x['kind'] == 'complementary' for x in items)}
    assert counts == {'evaluation': 20, 'complementary': 28}, counts
    assert len({item['id'] for item in items}) == len(items) == 48
    payload = {'schemaVersion': 2, 'categories': categories,
        'items': sorted(items, key=lambda i: (i['categoryId'], i['kind'], i['id'])),
        'documents': documents, 'references': [],
        'notes': ['La pertenencia a la evaluación no implica pertenencia a una MR hospitalaria.',
            'El nivel declarado no sustituye los criterios de población, servicio y capacidad de cada ficha.',
            '12-01-1.0 y 12-04-1.0 se respaldan en el diseño general porque la descarga individual estaba vacía.'],
        'excludedAmbiguousSources': [{'name': source['originalName'], 'reason': 'La población y unidad de análisis son áreas de salud, aunque enumera los tres niveles.'} for source in inventory['pendingApplicability']]}
    (ROOT / 'data').mkdir(exist_ok=True)
    (ROOT / 'data/curacion.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    (ROOT / 'data/inventario-fuentes.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=2))
    print(json.dumps({'items': len(items), **counts, 'documents': len(documents)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
