#!/usr/bin/env node
'use strict';

// Full is a complete reading view: no source characters may disappear when
// fields, fractions, and source table cells are rearranged for small screens.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'dist/assets/catalogo.json'), 'utf8'));
const {renderFullDocument} = require(path.join(root, 'dist/full-reader.js'));

assert.equal(catalog.items.length, 48, 'Debe conservar las 48 fichas hospitalarias');
const rendered = catalog.items.map(item => {
  assert.ok(item.fullReadingPages?.length, `${item.id}: falta lectura adaptable`);
  assert.ok(item.fullReadingPages.every(page => Array.isArray(page.blocks)), `${item.id}: página incompleta`);
  const html = renderFullDocument(item.fullText, {pages:item.fullReadingPages, sourceFile:item.sourceFile});
  assert.doesNotMatch(html, /<pre\b|class="source-layout(?:\s|"|-)/, `${item.id}: conserva columnas de texto de ancho fijo`);
  return {id:item.id, html};
});

// The parser decodes HTML entities and ignores only presentation labels such
// as page numbers and repeated table-header context. Actual source text stays.
const parser = spawnSync('python3', ['-c', String.raw`
import json, sys
from html.parser import HTMLParser
class SourceText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.parts = []
    def handle_starttag(self, tag, attrs):
        excluded = any(value for _, value in self.stack) or any(key == 'data-reader-label' for key, _ in attrs)
        if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}:
            self.stack.append((tag, excluded))
    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1, -1, -1):
            if self.stack[i][0] == tag:
                self.stack = self.stack[:i]
                break
    def handle_data(self, text):
        if not any(value for _, value in self.stack):
            self.parts.append(text)
out = []
for record in json.load(sys.stdin):
    parser = SourceText()
    parser.feed(record['html'])
    out.append({'id':record['id'], 'text':''.join(parser.parts)})
json.dump(out, sys.stdout, ensure_ascii=False)
`], {input:JSON.stringify(rendered), encoding:'utf8', maxBuffer:16*1024*1024});
assert.equal(parser.status, 0, parser.stderr);
const visible = new Map(JSON.parse(parser.stdout).map(row => [row.id, row.text]));
const chars = value => {
  const count = new Map();
  for (const character of String(value).replace(/\s/g, '')) count.set(character, (count.get(character) || 0) + 1);
  return [...count].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
};
for (const item of catalog.items) {
  assert.deepEqual(chars(visible.get(item.id)), chars(item.fullText), `${item.id}: el texto visible perdió o añadió caracteres fuente`);
}

const blocksOf = id => catalog.items.find(item => item.id === id).fullReadingPages.flatMap(page => page.blocks);
const normalize = text => String(text).replace(/\s+/g, ' ').trim();
const formulaOf = id => blocksOf(id).find(block => /^Fórmula/.test(block.label || ''));
const bioethics = formulaOf('13-01-1.0').formula;
assert.equal(normalize(bioethics.numerator), 'Total de puntos obtenidos en el formulario de seguimiento de CBC');
assert.equal(normalize(bioethics.denominator), 'Total de puntos del formulario de seguimiento de CBC');
assert.match(bioethics.multiplier, /x\s*100/, 'Bioética: el multiplicador final de la fuente aplica a la fracción completa');
const cost = formulaOf('11-01-2.0').formula;
assert.equal(normalize(cost.numerator.numerator), 'Gasto en Sueldos para Cargos Fijos2 año');
assert.equal(normalize(cost.numerator.denominator), 'Consultas de los profesionales de salud año');
assert.equal(normalize(cost.denominator.numerator), 'Gasto en Sueldos para Cargos Fijos2 año anterior');
assert.equal(normalize(cost.denominator.denominator), 'Consultas de los profesionales de salud año anterior');
assert.equal(cost.multiplier, '', 'Eficiencia: la razón de razones no se multiplica por cien');

console.log('Lectura Full hospitalaria verificada: las 48 fichas conservan todos sus caracteres visibles; bioética y eficiencia mantienen sus fórmulas.');
