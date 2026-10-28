/* Full reader: presentation only. Source wording is retained; source metadata is grouped for reading. */
(function (root) {
  'use strict';
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const fieldLabel = /^(?:Código|Nombre|Definición(?: conceptual)?|conceptual|Variables(?: involucradas(?: en la)?)?|involucradas(?: en la)?|en la medición|medición|Fórmula(?: de cálculo)?|cálculo|Desagregación|Línea base|Meta|Periodicidad|Fuente(?: de información)?|información|Clasificación|Presentación(?: de resultados)?|de resultados|Comentarios(?: generales)?|generales|Nivel de atención|Componente de la prestación|Componente de la atención(?: integral)?|integral|Temática|Indicador de Evaluación|Indicador Complementario|Elemento|Descripción)$/i;
  const bulletLine = /^(?:[•●▪◦]|[-–]|\d+[.)])\s+/;
  const headingLine = /^(?:Incluye|Excluye|Definiciones|Observaciones|Comentarios|Fuente de información)\s*:$/i;

  function isDocumentIdentity(text) {
    const lines = text.split('\n').map(line => line.trim().replace(/[ \t]+/g, ' ')).filter(Boolean);
    return lines.length > 0 && lines.every(line => /^(?:CAJA COSTARRICENSE DE SEGURO SOCIAL(?: 2024 ?- ?2028)?|GERENCIA MÉDICA|DIRECCIÓN COMPRA DE SERVICIOS DE SALUD|EVALUACIÓN DE LA PRESTACIÓN DE SERVICIOS DE SALUD|FICHA TÉCNICA DEL INDICADOR(?: COMPLEMENTARIO)?|2024 ?- ?2028|[0-9]+)$/.test(line));
  }

  function isLayoutBlock(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const rows = lines.map(line => line.split(/[ \t]{3,}/));
    // Preserve the stepped layout used by the prenatal intervention table.
    const indents = text.split('\n').filter(line => line.trim() && !fieldLabel.test(line.trim())).map(line => (line.match(/^[ \t]*/) || [''])[0].length);
    if (indents.length >= 6 && new Set(indents).size >= 4 && Math.max(...indents) - Math.min(...indents) >= 24 && lines.filter(line => bulletLine.test(line)).length < 2) return true;
    // Three or more columns are kept as laid out, including prenatal tables.
    if (rows.some(cells => cells.length >= 3)) return true;
    // Retain two-column data tables; common ficha field/value labels can reflow.
    const dataRows = rows.filter(cells => cells.length === 2 && !fieldLabel.test(cells[0]) && !bulletLine.test(cells[0]));
    if (dataRows.length >= 2) return true;
    // Fraction placement and a multiplier convey meaning, so preserve geometry.
    if (lines.some(line => /\S[ \t]{3,}[×x]\s*100\b/.test(line))) return true;
    return false;
  }

  function removeCommonIndent(text) {
    const lines = text.split('\n');
    const indents = lines.filter(line => line.trim()).map(line => (line.match(/^[ \t]*/) || [''])[0].length);
    const indent = indents.length ? Math.min(...indents) : 0;
    return lines.map(line => line.slice(Math.min(indent, (line.match(/^[ \t]*/) || [''])[0].length)).replace(/[ \t]+$/g, '')).join('\n');
  }

  function splitAdministrativeRows(text) {
    const groups = [];
    let current = [];
    const rowStart = /^(?:Nivel de atención|Desagregación|Línea base|Meta(?=\s|$)|Periodicidad|Fuente de(?:\s|$)|Clasificación|Presentación(?:\s|$)|Comentarios(?:\s|$))/i;
    for (const line of text.split('\n')) {
      if (current.length && rowStart.test(line.trim())) {
        groups.push(current.join('\n'));
        current = [];
      }
      current.push(line);
    }
    if (current.length) groups.push(current.join('\n'));
    return groups;
  }

  function segmentFullDocument(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\f').map((page, index) => ({
      number: index + 1,
      sourceText: page,
      blocks: page.split(/\n[ \t]*\n+/).filter(block => block.trim()).flatMap(splitAdministrativeRows).map(block => ({
        text: block,
        layout: isLayoutBlock(block)
      }))
    }));
  }

  function renderParagraph(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    return lines.map((line, index) => {
      const previous = lines[index - 1];
      const newLine = index > 0 && (bulletLine.test(line) || fieldLabel.test(line) || headingLine.test(line) || fieldLabel.test(previous) || headingLine.test(previous));
      const cells = line.split(/[ \t]{3,}/);
      const labeled = cells.length === 2 && fieldLabel.test(cells[0]);
      const value = labeled
        ? '<strong class="source-field-label">' + escapeHtml(cells[0]) + '</strong>' + escapeHtml(cells[1].replace(/[ \t]+/g, ' '))
        : fieldLabel.test(line) || headingLine.test(line)
          ? '<strong class="source-field-label">' + escapeHtml(line) + '</strong>'
          : escapeHtml(line.replace(/[ \t]+/g, ' '));
      return (index ? (newLine ? '<br>' : ' ') : '') + value;
    }).join('');
  }

  function takeCompactValue(text, value) {
    const positions = [];
    let compact = '';
    for (let index = 0; index < text.length; index++) {
      if (!/\s/.test(text[index])) { compact += text[index]; positions.push(index); }
    }
    const expected = String(value).replace(/\s/g, '');
    const found = expected ? compact.indexOf(expected) : -1;
    if (found < 0) return null;
    return text.slice(0, positions[found]) + '\n' + text.slice(positions[found + expected.length - 1] + 1);
  }

  function takeSourceLabel(text, label) {
    const words = String(label || '').split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    const complete = new RegExp('^([ \\t]*)' + words.join('[ \\t]+') + '(?=[ \\t]|$)', 'm');
    if (complete.test(text)) return text.replace(complete, '$1');
    const lines = text.split('\n');
    let nextWord = 0;
    let left = null;
    for (let index = 0; index < lines.length && nextWord < words.length; index++) {
      const indent = (lines[index].match(/^[ \t]*/) || [''])[0].length;
      if (indent > 16) continue;
      for (let count = words.length - nextWord; count > 0; count--) {
        const fragment = words.slice(nextWord, nextWord + count).join('[ \\t]+');
        const pattern = new RegExp('^([ \\t]*)' + fragment + '(?=[ \\t]|$)');
        if (!pattern.test(lines[index])) continue;
        lines[index] = lines[index].replace(pattern, '$1');
        if (left === null) left = indent;
        nextWord += count;
        break;
      }
    }
    return nextWord === words.length ? lines.join('\n') : null;
  }

  function renderMetadataValue(value) {
    const text = String(value);
    if (!/[•●▪◦]/.test(text)) return escapeHtml(text);
    return text.split(/(?=[•●▪◦])/).filter(part => part.trim()).map(part => {
      const trimmed = part.trim();
      if (/^[•●▪◦]/.test(trimmed)) return '<div class="source-metadata-bullet"><span aria-hidden="true">' + escapeHtml(trimmed[0]) + '</span><span>' + escapeHtml(trimmed.slice(1).trim()) + '</span></div>';
      return '<p class="source-metadata-intro">' + escapeHtml(trimmed) + '</p>';
    }).join('');
  }

  function extractPageMetadata(text, metadata) {
    for (const entry of metadata || []) {
      let rest = text;
      const fields = [];
      const candidates = entry.fields || [{label:entry.codeLabel, value:entry.code}, {label:entry.nameLabel, value:entry.name}];
      for (const field of candidates) {
        const withoutLabel = takeSourceLabel(rest, field.label);
        if (withoutLabel === null) continue;
        rest = withoutLabel;
        fields.push(field);
      }
      if (!fields.length) continue;
      let valid = true;
      for (const field of fields) {
        const remainder = takeCompactValue(rest, field.value);
        if (remainder === null) { valid = false; break; }
        rest = remainder;
      }
      if (!valid) continue;
      let columnHeadings = '';
      rest = rest.replace(/^[ \t]*Elemento[ \t]+Descripción[ \t]*(?:\n|$)/m, header => { columnHeadings = '<span class="source-column-headings sr-only">' + escapeHtml(header.trim().replace(/[ \t]+/g, ' ')) + '</span>'; return ''; });
      return {remaining:rest, html:columnHeadings + '<dl class="source-metadata">' + fields.map(field => '<div class="source-metadata-field"><dt>' + escapeHtml(field.label) + '</dt><dd>' + renderMetadataValue(field.value) + '</dd></div>').join('') + '</dl>'};
    }
    return null;
  }

  function renderSourceBlock(block, metadata, pageNumber, sourceFile) {
    if (/^[ \t]*Elemento[ \t]+Descripción[ \t]*$/.test(block.text.trim())) return '<span class="source-column-headings sr-only">' + escapeHtml(block.text.trim().replace(/[ \t]+/g, ' ')) + '</span>';
    if (isDocumentIdentity(block.text)) return '<p class="source-document-identity">' + renderParagraph(block.text) + '</p>';
    const isMetadata = /^\s*Código\b/m.test(block.text) && /^\s*Nombre\b/m.test(block.text);
    if (!block.layout || isMetadata) return '<p class="source-paragraph">' + renderParagraph(block.text) + '</p>';
    const original = sourceFile ? '<a class="source-link source-layout-pdf" href="' + escapeHtml(String(sourceFile).split('#')[0]) + '#page=' + pageNumber + '" target="_blank" rel="noopener">Ver esta página en el PDF original</a>' : '';
    return '<div class="source-aligned-block"><p class="source-layout-hint" data-reader-label>Tabla o fórmula del documento. Deslice hacia los lados para verla completa.</p><div class="source-layout-wrap" tabindex="0" role="region" aria-label="Tabla o fórmula con desplazamiento horizontal"><pre class="source-layout">' + escapeHtml(removeCommonIndent(block.text)) + '</pre></div>' + original + '</div>';
  }

  function renderFullDocument(text, options) {
    if (options && options.pages && options.pages.length) return renderReadingPages(options.pages, options);
    const pages = segmentFullDocument(text);
    const html = pages.map(page => {
      const prepared = extractPageMetadata(page.sourceText, options && options.metadata);
      const blocks = prepared ? segmentFullDocument(prepared.remaining)[0].blocks : page.blocks;
      let inserted = !prepared;
      let content = '';
      for (const block of blocks) {
        const identity = isDocumentIdentity(block.text);
        if (!inserted && !identity) { content += prepared.html; inserted = true; }
        content += renderSourceBlock(block, null, page.number, options && options.sourceFile);
      }
      if (!inserted) content += prepared.html;
      return '<section class="source-page"><h4 class="source-page-heading">Página ' + page.number + ' del documento</h4><div class="source-page-content">' + content + '</div></section>';
    }).join('');
    const original = options && options.includeOriginal ? '<details class="full-source-original"><summary>Consultar disposición original del texto extraído</summary><pre class="full-original-text">' + escapeHtml(text == null ? '' : text) + '</pre></details>' : '';
    return '<div class="full-document">' + html + '</div>' + original;
  }

  function renderReadingText(text) {
    const lines = String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
    const groups = [];
    let current = [];
    for (const line of lines) {
      const starts = /^(?:[•●▪◦]|[-–]\s|\d+[.)]\s)/.test(line);
      const heading = /^(?:Incluye|Excluye|Definiciones|Observaciones|Comentarios|Fuente de información)\s*:$/i.test(line);
      if ((starts || heading) && current.length) { groups.push(current.join(' ')); current = []; }
      current.push(line);
      if (heading) { groups.push(current.join(' ')); current = []; }
    }
    if (current.length) groups.push(current.join(' '));
    return groups.map(group => /^.+:$/.test(group) && group.length < 80
      ? '<p class="reading-subheading">' + escapeHtml(group) + '</p>'
      : '<p class="source-paragraph">' + escapeHtml(group) + '</p>').join('');
  }

  function renderReadingFormula(formula) {
    const value = part => part && typeof part === 'object' ? fraction(part) : escapeHtml(part || '');
    const fraction = ratio => '<div class="reading-fraction"><div class="reading-numerator">' + value(ratio.numerator) + '</div><div class="reading-denominator">' + value(ratio.denominator) + '</div></div>' + (ratio.multiplier ? '<span class="reading-multiplier">' + escapeHtml(ratio.multiplier) + '</span>' : '');
    return '<div class="reading-formula">' + fraction(formula) + '</div>';
  }

  function renderReadingTable(block) {
    const headers = block.headers || [];
    const contextHeaders = block.contextHeaders || headers;
    const rows = (block.rows || []).map(row => {
      const cells = Array.isArray(row) ? row : row.cells || [];
      return '<div class="reading-table-row">' + (row.context ? '<p class="reading-table-context" data-reader-label>' + escapeHtml(row.context) + '</p>' : '') + cells.filter(cell => cell && (typeof cell === 'string' || cell.text)).map((cell, index) => {
        const value = typeof cell === 'string' ? cell : cell.text;
        const start = typeof cell === 'string' ? index : cell.colStart == null ? index : cell.colStart;
        const span = typeof cell === 'string' ? 1 : cell.colSpan || 1;
        const context = contextHeaders.slice(start, start + span).join(' · ');
        return '<div class="reading-table-cell">' + (context ? '<p class="reading-table-context" data-reader-label>' + escapeHtml(context) + '</p>' : '') + renderReadingText(value) + '</div>';
      }).join('') + '</div>';
    }).join('');
    return '<section class="reading-table">' + (block.caption ? '<h5 class="reading-table-caption">' + escapeHtml(block.caption) + '</h5>' : '') + '<div class="reading-table-headers">' + headers.map(header => '<span>' + escapeHtml(header) + '</span>').join('') + '</div>' + rows + '</section>';
  }

  function renderReadingPages(pages, options) {
    return '<div class="full-document full-reading">' + pages.map(page => '<section class="source-page"><h4 class="source-page-heading" data-reader-label>Página ' + page.number + ' del documento</h4><div class="source-page-content">' + page.blocks.map(block => {
      if (block.kind === 'table') return renderReadingTable(block);
      if (block.kind === 'formula') return renderReadingFormula(block.formula);
      if (block.kind === 'field') return '<section class="reading-field"><h5 class="reading-field-heading">' + escapeHtml(block.label) + '</h5>' + (block.formulas ? block.formulas.map(renderReadingFormula).join('') : block.formula ? renderReadingFormula(block.formula) : block.equation ? '<p class="reading-equation">' + escapeHtml(block.text) + '</p>' : renderReadingText(block.text)) + (block.formulaNote ? renderReadingText(block.formulaNote) : '') + '</section>';
      if (block.kind === 'identity' || isDocumentIdentity(block.text)) return '<p class="source-document-identity">' + escapeHtml(block.text).replace(/\n/g, '<br>') + '</p>';
      return renderReadingText(block.text);
    }).join('') + '</div></section>').join('') + '</div>';
  }

  root.renderFullDocument = renderFullDocument;
  root.FullDocumentReader = {renderFullDocument, segmentFullDocument};
  if (typeof module !== 'undefined' && module.exports) module.exports = {renderFullDocument, segmentFullDocument};
})(typeof window !== 'undefined' ? window : globalThis);
