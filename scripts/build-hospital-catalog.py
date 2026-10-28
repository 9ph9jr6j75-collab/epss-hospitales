#!/usr/bin/env python3
"""Compile hospital fichas with source-exact, responsive full reading pages."""
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('source_reader', ROOT / 'scripts/build-catalog.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def main():
    data = json.loads((ROOT / 'data/curacion.json').read_text())
    result = []
    for record in data['items']:
        item = dict(record)
        doc = data['documents'][item['sourceId']]
        pdf = ROOT / 'dist' / doc['file']
        assert hashlib.sha256(pdf.read_bytes()).hexdigest() == doc['sha256']
        args = ['-f', str(item['sourcePage']), '-l', str(item['sourceEndPage'])] if item.get('sourcePage') else []
        layout = subprocess.check_output(['pdftotext', *args, '-layout', str(pdf), '-'], text=True).strip()
        raw = subprocess.check_output(['pdftotext', *args, '-raw', str(pdf), '-'], text=True).strip()
        if len(layout) < 150:
            # 11-02 is a scanned original with the previously visually reviewed transcription.
            assert item['id'] == '11-02-3.0' and len(item.get('fullText', '')) > 150
            layout = item['fullText']
            item['fullTextTranscription'] = True
        item['fullText'] = layout
        item['fullMetadata'] = reader.extract_full_metadata(raw, layout)
        item['fullReadingPages'] = reader.extract_full_reading_pages(raw, layout, item['id'])
        offset = item.get('sourcePage', 1) - 1
        for page in item['fullReadingPages']:
            page['number'] += offset
        item.update(sourceFile=doc['file'], sourceTitle=doc['title'], sourceOriginalName=doc['originalName'],
            sourceDriveUrl=doc.get('driveUrl', ''), sourcePages=item.get('sourceEndPage', doc['pages']) - offset,
            category=data['categories'][item['categoryId']], family=item.get('code', '')[:5])
        item['searchText'] = ' '.join(str(item.get(k, '')) for k in ('code', 'id', 'title', 'population', 'requiredActions', 'recording', 'cie10', 'fullText', 'hospitalApplicabilityText', 'serviceTags'))
        result.append(item)
    catalog = {'schemaVersion': 2, 'reviewedOn': '2026-10-28', 'title': 'Fichas técnicas EPSS 2024-2028 · Hospitales',
        'scope': 'Hospitales de segundo y tercer nivel',
        'scopeNote': 'Fichas recibidas en la recopilación del 27 de octubre de 2026. La aplicabilidad depende del servicio, población y criterios de cada ficha. La composición de una MR hospitalaria no está confirmada en las fuentes disponibles.',
        'categories': data['categories'], 'documents': list(data['documents'].values()), 'items': result, 'notes': data['notes'], 'references': data['references']}
    (ROOT / 'dist/assets/catalogo.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2))
    print(json.dumps({'items': len(result), 'pages': sum(len(i['fullReadingPages']) for i in result), 'documents': len(data['documents'])}))


if __name__ == '__main__':
    main()
