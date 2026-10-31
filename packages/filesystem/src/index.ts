import { readFile, readdir, stat, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { join, relative, resolve, extname, dirname, basename, isAbsolute } from 'node:path';
import { parseAllDocuments, parseDocument } from 'yaml';
import { parse } from 'csv-parse/sync';
import { Lexer, type Token } from 'marked';
import ignore from 'ignore';
import type { CompiledSchema } from '@khaale/lore-schema';
import { extractSource, SourceExtractionError } from './source-extraction.js';
import {
  type Candidate,
  type MarkdownSection,
  type SourceSpan,
  type SurfaceLink,
  type ManifestBinding,
  type SourceDescriptor,
  type TableDeclaration,
  type MarkdownTable,
  type MarkdownTableCell,
  type MarkdownTableRow,
} from '@khaale/lore-core';
export type { Candidate, MarkdownSection, SourceSpan, SurfaceLink } from '@khaale/lore-core';
export const MODEL_FILENAMES = ['.lore.yaml', 'model.yaml'] as const;

export async function resolveSchemaPath(root: string, schemaPath?: string): Promise<string> {
  if (schemaPath !== undefined) return resolve(schemaPath);
  const candidates: string[] = [];
  for (const name of MODEL_FILENAMES) {
    const path = resolve(root, name);
    try {
      if ((await stat(path)).isFile()) candidates.push(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length > 1)
    throw new Error(
      `multiple Lore models found in ${resolve(root)}; specify the schema path explicitly`,
    );
  throw new Error(
    `no Lore model found in ${resolve(root)}; expected ${MODEL_FILENAMES.join(' or ')}`,
  );
}

export const supported = (path: string) =>
  ['.md', '.markdown', '.yaml', '.yml', '.json', '.jsonl', '.csv'].includes(
    extname(path).toLowerCase(),
  );

const scalar = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?(?:\d+\.\d*|\d*\.\d+)$/.test(s)) return Number(s);
  return v;
};
const lineSpan = (line: number, column = 1): SourceSpan => ({ line, column });
const tableNamePattern = /^[A-Za-z][A-Za-z0-9_-]*$/;

function sourceLocator(text: string, lineOffset = 0): (offset: number) => SourceSpan {
  const starts = [0];
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1))
    starts.push(index + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle]! <= offset) low = middle;
      else high = middle;
    }
    return lineSpan(low + 1 + lineOffset, offset - starts[low]! + 1);
  };
}

function decodeTableCell(value: string): string {
  let decoded = '';
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    const next = value[index + 1];
    if (character === '\\' && (next === '|' || next === '\\')) {
      decoded += next;
      index++;
    } else decoded += character;
  }
  return decoded.trim();
}

function tableCells(line: string, lineNumber: number): MarkdownTableCell[] | undefined {
  const leading = line.search(/\S/);
  const text = leading < 0 ? '' : line.slice(leading);
  if (!text.startsWith('|') || !text.endsWith('|')) return undefined;
  const cells: MarkdownTableCell[] = [];
  let segmentStart = leading + 1;
  let escaped = false;
  for (let index = leading + 1; index < line.length; index++) {
    const character = line[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character !== '|') continue;
    const raw = line.slice(segmentStart, index);
    const trimmed = raw.trim();
    const trimOffset = raw.indexOf(trimmed);
    const start = trimmed ? segmentStart + trimOffset + 1 : Math.max(segmentStart + 1, index);
    const end = trimmed ? start + trimmed.length - 1 : start;
    cells.push({
      value: decodeTableCell(raw),
      span: { line: lineNumber, column: start, end_line: lineNumber, end_column: end },
    });
    segmentStart = index + 1;
  }
  return cells;
}

function scanMarkdownTables(body: string, bodyStartLine: number): MarkdownTable[] {
  const lines = body.split(/\r?\n/);
  const tables: MarkdownTable[] = [];
  let fence: { marker: '`' | '~'; length: number } | undefined;
  const unescapedPipe = (line: string): boolean => {
    let escaped = false;
    for (const character of line) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '|') return true;
    }
    return false;
  };
  const pipeLike = (line: string): boolean => unescapedPipe(line);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const openingFence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (!fence && openingFence) {
      fence = { marker: openingFence[1]![0] as '`' | '~', length: openingFence[1]!.length };
      continue;
    }
    if (fence) {
      const closingFence = new RegExp(`^\\s*${fence.marker}{${fence.length},}\\s*$`).test(line);
      if (closingFence) fence = undefined;
      continue;
    }
    if (tableCells(line, bodyStartLine + index) === undefined) continue;
    const start = index;
    const run: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index]!;
      // Once a header and delimiter have started a candidate table, keep
      // contiguous pipe-like lines in the same block even when one is
      // malformed. Otherwise a missing trailing pipe would split the input
      // into two apparent tables and report TABLE_AMBIGUOUS instead of
      // rejecting the selected table as one unit.
      if (
        tableCells(candidate, bodyStartLine + index) === undefined &&
        (!candidate.trim() || !pipeLike(candidate))
      )
        break;
      run.push(candidate);
      index++;
    }
    const afterRunIndex = index;
    index--;
    if (run.length < 2) continue;
    const headerCells = tableCells(run[0]!, bodyStartLine + start)!;
    const delimiterCells = tableCells(run[1]!, bodyStartLine + start + 1)!;
    const delimiterValid = delimiterCells.every((cell) => /^:?-{3,}:?$/.test(cell.value));
    const rows: MarkdownTableRow[] = [];
    let valid = delimiterValid && headerCells.length === delimiterCells.length;
    const followingLine = lines[afterRunIndex];
    if (valid && followingLine !== undefined && followingLine.trim() && pipeLike(followingLine)) {
      valid = false;
    }
    for (let rowIndex = 2; rowIndex < run.length; rowIndex++) {
      const parsedRowCells = tableCells(run[rowIndex]!, bodyStartLine + start + rowIndex);
      if (!parsedRowCells || parsedRowCells.length !== headerCells.length) valid = false;
      const rowCells = parsedRowCells ?? [];
      const first = rowCells[0]?.span;
      const last = rowCells[rowCells.length - 1]?.span;
      rows.push({
        cells: rowCells,
        span: {
          line: first?.line ?? bodyStartLine + start + rowIndex,
          column: 1,
          end_line: last?.end_line ?? bodyStartLine + start + rowIndex,
          end_column: last?.end_column ?? run[rowIndex]!.length,
        },
      });
    }
    const firstCell = headerCells[0]?.span;
    const headerLastCell = headerCells.at(-1)?.span;
    const lastCell = rows.at(-1)?.cells.at(-1)?.span ?? headerLastCell;
    tables.push({
      headers: headerCells,
      rows,
      headerSpan: {
        line: firstCell?.line ?? bodyStartLine + start,
        column: 1,
        end_line: firstCell?.line ?? bodyStartLine + start,
        ...(headerLastCell?.end_column === undefined
          ? {}
          : { end_column: headerLastCell.end_column }),
      },
      span: {
        line: bodyStartLine + start,
        column: 1,
        end_line: bodyStartLine + start + run.length - 1,
        ...(lastCell?.end_column === undefined ? {} : { end_column: lastCell.end_column }),
      },
      valid,
      ...(valid
        ? {}
        : {
            diagnostic: delimiterValid
              ? followingLine !== undefined && followingLine.trim() && pipeLike(followingLine)
                ? 'selected table contains a malformed pipe-like row'
                : 'table rows must contain the same number of cells as the header'
              : 'table delimiter must contain one :?-{3,}:? marker per column',
          }),
    });
  }
  return tables;
}
function sourceSpans(text: string, keys: readonly string[]): Record<string, SourceSpan> {
  const lines = text.split(/\r?\n/);
  const spans: Record<string, SourceSpan> = {};
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?:^\\s*|[,{]\\s*)["']?${escaped}["']?\\s*:`);
    const line = lines.findIndex((value) => pattern.test(value));
    if (line >= 0) {
      // Point diagnostics at the asserted value, rather than the mapping key.
      const column = Math.max(1, lines[line]!.indexOf(key) + key.length + 3);
      spans[key] = lineSpan(line + 1, column);
    }
  }
  return spans;
}
function nodeSpans(document: unknown, text: string, lineOffset = 0): Record<string, SourceSpan> {
  const spans: Record<string, SourceSpan> = {};
  const lineAt = sourceLocator(text, lineOffset);
  const visit = (node: unknown, prefix = ''): void => {
    if (!node || typeof node !== 'object') return;
    const value = node as {
      items?: unknown[];
      key?: { value?: unknown; range?: number[] };
      value?: unknown;
      range?: number[];
    };
    if (prefix && value.range?.[0] !== undefined && spans[prefix] === undefined)
      spans[prefix] = lineAt(value.range[0]);
    if (!Array.isArray(value.items)) return;
    const mapping = value.items.some(
      (item) => item !== null && typeof item === 'object' && 'key' in item,
    );
    if (mapping)
      for (const item of value.items) {
        const pair = item as { key?: { value?: unknown }; value?: unknown };
        const name = pair.key?.value;
        if (typeof name !== 'string') continue;
        const path = prefix ? `${prefix}.${name}` : name;
        visit(pair.value, path);
      }
    else
      value.items.forEach((item, index) => {
        const path = prefix ? `${prefix}[${index}]` : `[${index}]`;
        visit(item, path);
      });
  };
  visit((document as { contents?: unknown }).contents);
  return spans;
}
function parseCsv(text: string, path: string): Candidate[] {
  const parsed: unknown = parse(text, { relax_quotes: false, skip_empty_lines: true });
  const rows = parsed as string[][];
  const headers = (rows.shift() ?? []).map((x) => String(x).trim());
  const headerSpans = Object.fromEntries(
    headers.map((h) => [h, lineSpan(1, Math.max(1, text.indexOf(h) + 1))]),
  );
  return rows.map((r, i) => ({
    source: `${path}#row=${i + 2}`,
    physicalPath: path,
    data: Object.fromEntries(
      headers.map((h, j) => [h, scalar(r[j] ?? '')]).filter(([, v]) => v !== ''),
    ),
    spans: headerSpans,
    links: [],
    sections: [],
  }));
}
function markdown(path: string, text: string): Candidate {
  const lines = text.split(/\r?\n/);
  let start = 0;
  let front: Record<string, unknown> = {};
  let frontSpans: Record<string, SourceSpan> = {};
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex(
      (line, index) => index > 0 && (line.trim() === '---' || line.trim() === '...'),
    );
    if (end < 0) throw new Error(`${path}: unterminated frontmatter`);
    const frontText = lines.slice(1, end).join('\n');
    const d = parseDocument(frontText);
    if (d.errors.length) throw new Error(String(d.errors[0]));
    const value = d.toJS();
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`${path}: frontmatter must be a mapping`);
    front = value as Record<string, unknown>;
    frontSpans = nodeSpans(d, frontText, 1);
    start = end + 1;
  }
  const body = lines.slice(start).join('\n');
  const links: SurfaceLink[] = [];
  const sections: MarkdownSection[] = [];
  let section: MarkdownSection | undefined;
  const lineAt = sourceLocator(body, start);
  const addWikiLinks = (value: string, offset: number, targetSection?: MarkdownSection): void => {
    for (const match of value.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g)) {
      const link: SurfaceLink = {
        syntax: 'wiki',
        target: match[1]!.trim(),
        ...(match[2] === undefined ? {} : { label: match[2].trim() }),
        span: lineAt(offset + match.index),
      };
      links.push(link);
      targetSection?.links.push(link);
    }
  };
  const normalizedText = (value: string): string => value.replace(/\s+/g, ' ').trim();
  const addInlineLinks = (
    tokens: Token[] | undefined,
    base: number,
    owner?: MarkdownSection,
  ): void => {
    if (!tokens) return;
    let cursor = base;
    for (const token of tokens) {
      const raw = token.raw ?? '';
      const found = body.indexOf(raw, cursor);
      const at = found < 0 ? cursor : found;
      cursor = at + raw.length;
      if (token.type === 'codespan' || token.type === 'code') continue;
      if (token.type === 'link') {
        const linkToken = token as Token & { href: string; text: string };
        if (!/^(?:https?:|mailto:|#)/i.test(linkToken.href)) {
          const link: SurfaceLink = {
            syntax: 'markdown',
            target: linkToken.href,
            label: normalizedText(linkToken.text),
            span: lineAt(at),
          };
          links.push(link);
          owner?.links.push(link);
        }
      }
      const textValue = (token as Token & { text?: string }).text;
      if (typeof textValue === 'string') addWikiLinks(textValue, at, owner);
      addInlineLinks((token as Token & { tokens?: Token[] }).tokens, at, owner);
    }
  };
  let cursor = 0;
  let bodyTitle: string | undefined;
  let bodyDescription: string | undefined;
  let descriptionSpan: SourceSpan | undefined;
  const lexer = new Lexer({ gfm: false });
  const inlineTokens = lexer.inlineTokens.bind(lexer);
  // Lore consumes inline tokens only for links. HTML still needs tokenization
  // because its open/close tags affect Marked's link state across fragments.
  lexer.inlineTokens = (text, tokens = []) =>
    text.includes('[') || text.includes('<') ? inlineTokens(text, tokens) : tokens;
  for (const token of lexer.lex(body)) {
    const raw = token.raw ?? '';
    const found = body.indexOf(raw, cursor);
    const at = found < 0 ? cursor : found;
    cursor = at + raw.length;
    if (token.type === 'heading') {
      const heading = token as Token & { depth: number; text: string; tokens?: Token[] };
      const headingText = normalizedText(heading.text);
      const anchorMatch = /\s+\{#([A-Za-z][A-Za-z0-9_-]*)\}$/.exec(headingText);
      section = {
        heading: (anchorMatch ? headingText.slice(0, anchorMatch.index) : headingText).trim(),
        level: heading.depth,
        ...(anchorMatch ? { anchor: anchorMatch[1] } : {}),
        blocks: [],
        lists: [],
        links: [],
        span: lineAt(at),
      };
      sections.push(section);
      if (bodyTitle === undefined && heading.depth === 1) bodyTitle = section.heading;
      addInlineLinks(heading.tokens, at, section);
      continue;
    }
    if (token.type === 'code') continue;
    if (token.type === 'paragraph') {
      const paragraph = token as Token & { text: string; tokens?: Token[] };
      const value = normalizedText(paragraph.text);
      if (bodyDescription === undefined && value) {
        bodyDescription = value;
        descriptionSpan = lineAt(at);
      }
      if (section && value) section.blocks.push(value);
      addInlineLinks(paragraph.tokens, at, section);
      continue;
    }
    if (token.type === 'list') {
      const list = token as Token & {
        items: Array<{ text: string; raw?: string; tokens?: Token[] }>;
      };
      if (section)
        section.lists.push(list.items.map((item) => normalizedText(item.text)).filter(Boolean));
      let itemCursor = at;
      for (const item of list.items) {
        const itemAt = body.indexOf(item.raw ?? item.text, itemCursor);
        addInlineLinks(item.tokens, itemAt < 0 ? itemCursor : itemAt, section);
        itemCursor = (itemAt < 0 ? itemCursor : itemAt) + (item.raw ?? item.text).length;
      }
    }
  }
  const title = bodyTitle;
  const description = bodyDescription;
  const headingTitle = sections.find((s) => s.level === 1)?.heading;
  const spans = { ...frontSpans };
  const titleSection = sections.find((s) => s.level === 1);
  if (titleSection?.span && spans.title === undefined) spans.title = titleSection.span;
  if (descriptionSpan && spans.description === undefined) spans.description = descriptionSpan;
  const uniqueLinks = links.filter(
    (link, index) =>
      links.findIndex(
        (candidate) =>
          candidate.syntax === link.syntax &&
          candidate.target === link.target &&
          candidate.label === link.label &&
          candidate.span?.line === link.span?.line &&
          candidate.span?.column === link.span?.column,
      ) === index,
  );
  for (const markdownSection of sections)
    markdownSection.links = markdownSection.links.filter(
      (link, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.syntax === link.syntax &&
            candidate.target === link.target &&
            candidate.label === link.label &&
            candidate.span?.line === link.span?.line &&
            candidate.span?.column === link.span?.column,
        ) === index,
    );
  const sectionDeclarations: Record<string, unknown> = {};
  const tableDeclarations: TableDeclaration[] = [];
  const lore = front.lore;
  const declarations =
    lore && typeof lore === 'object' && !Array.isArray(lore)
      ? (lore as Record<string, unknown>).sections
      : undefined;
  const rawTables =
    lore && typeof lore === 'object' && !Array.isArray(lore)
      ? (lore as Record<string, unknown>).tables
      : undefined;
  const declarationDiagnostics: import('@khaale/lore-core').Diagnostic[] = [];
  if (declarations !== undefined) {
    if (!declarations || typeof declarations !== 'object' || Array.isArray(declarations))
      declarationDiagnostics.push({
        severity: 'error',
        code: 'BINDING_SHAPE',
        message: 'lore.sections must be a mapping of anchors to metadata',
        source: path,
      });
    else {
      for (const [anchor, declaration] of Object.entries(declarations)) {
        // Keys are resolved against either an explicit anchor or an enabled
        // heading convention by the core. Do not reject punctuation-bearing
        // logical IDs at this schema-agnostic parsing boundary.
        sectionDeclarations[anchor] = declaration;
      }
    }
  }
  if (rawTables !== undefined) {
    if (!rawTables || typeof rawTables !== 'object' || Array.isArray(rawTables)) {
      declarationDiagnostics.push({
        severity: 'error',
        code: 'TABLE_DECLARATION_SHAPE',
        message: 'lore.tables must be a mapping of table declarations',
        source: path,
        ...(frontSpans['lore'] ? { span: frontSpans['lore'] } : {}),
      });
    } else {
      for (const [name, raw] of Object.entries(rawTables as Record<string, unknown>)) {
        const declarationPath = `lore.tables.${name}`;
        const source = `${path}#frontmatter=${declarationPath}`;
        const declarationSpan = frontSpans[declarationPath] ?? frontSpans['lore'];
        let valid = tableNamePattern.test(name);
        if (!valid)
          declarationDiagnostics.push({
            severity: 'error',
            code: 'TABLE_NAME',
            message: `table declaration name ${JSON.stringify(name)} must match [A-Za-z][A-Za-z0-9_-]*`,
            source,
            ...(declarationSpan ? { span: declarationSpan } : {}),
          });
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          valid = false;
          declarationDiagnostics.push({
            severity: 'error',
            code: 'TABLE_DECLARATION_SHAPE',
            message: `table declaration ${name} must be a mapping`,
            source,
            ...(declarationSpan ? { span: declarationSpan } : {}),
          });
          continue;
        }
        const value = raw as Record<string, unknown>;
        const allowed = new Set(['scope', 'class', 'id_column', 'columns']);
        for (const key of Object.keys(value))
          if (!allowed.has(key)) {
            valid = false;
            declarationDiagnostics.push({
              severity: 'error',
              code: 'TABLE_DECLARATION_KEY',
              message: `table declaration ${name} key ${key} is not supported`,
              source,
              ...(frontSpans[`${declarationPath}.${key}`]
                ? { span: frontSpans[`${declarationPath}.${key}`] }
                : declarationSpan
                  ? { span: declarationSpan }
                  : {}),
            });
          }
        const scope = typeof value.scope === 'string' ? value.scope : '';
        const runtimeClass = typeof value.class === 'string' ? value.class : '';
        const idColumn = typeof value.id_column === 'string' ? value.id_column : '';
        const columns = value.columns;
        if (
          !scope ||
          !runtimeClass ||
          !idColumn ||
          !columns ||
          typeof columns !== 'object' ||
          Array.isArray(columns)
        ) {
          valid = false;
          declarationDiagnostics.push({
            severity: 'error',
            code: 'TABLE_DECLARATION_SHAPE',
            message: `table declaration ${name} requires scope, class, id_column, and columns mapping`,
            source,
            ...(declarationSpan ? { span: declarationSpan } : {}),
          });
        }
        const normalizedColumns: Record<string, string> = {};
        if (columns && typeof columns === 'object' && !Array.isArray(columns))
          for (const [header, slot] of Object.entries(columns as Record<string, unknown>)) {
            if (typeof slot !== 'string' || !slot) {
              valid = false;
              declarationDiagnostics.push({
                severity: 'error',
                code: 'TABLE_COLUMN_SHAPE',
                message: `table declaration ${name} column ${header} must map to a slot name`,
                source,
                ...(declarationSpan ? { span: declarationSpan } : {}),
              });
              continue;
            }
            normalizedColumns[header] = slot;
          }
        tableDeclarations.push({
          name,
          scope,
          class: runtimeClass,
          idColumn,
          columns: normalizedColumns,
          source,
          physicalPath: path,
          valid,
          ...(declarationSpan ? { span: declarationSpan } : {}),
        });
      }
    }
  }
  delete front.lore;
  const propertySources: Record<string, SourceDescriptor> = {};
  for (const key of Object.keys(front))
    propertySources[key] = {
      source: path,
      physicalPath: path,
      representation: 'frontmatter',
      ...(frontSpans[key] ? { span: frontSpans[key] } : {}),
    };
  return {
    source: path,
    physicalPath: path,
    data: front,
    spans,
    body,
    bodyStartLine: start + 1,
    ...(title === undefined ? {} : { observedTitle: title }),
    ...(description === undefined ? {} : { observedDescription: description }),
    ...(typeof front.title === 'string' ? { frontmatterTitle: front.title } : {}),
    ...(headingTitle === undefined ? {} : { headingTitle }),
    ...(typeof front.description === 'string' ? { frontmatterDescription: front.description } : {}),
    ...(bodyDescription === undefined ? {} : { bodyDescription }),
    links: uniqueLinks,
    sections,
    propertySources,
    narrativeSource: { source: path, physicalPath: path, representation: 'narrative' },
    ...(Object.keys(sectionDeclarations).length ? { sectionDeclarations } : {}),
    ...(tableDeclarations.length ? { tableDeclarations } : {}),
    tables: scanMarkdownTables(body, start + 1),
    ...(declarationDiagnostics.length ? { parseDiagnostics: declarationDiagnostics } : {}),
  };
}
function objectCandidates(
  path: string,
  value: unknown,
  spans: Record<string, SourceSpan> = {},
): Candidate[] {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return [
      {
        source: path,
        physicalPath: path,
        data: value as Record<string, unknown>,
        spans,
        links: [],
        sections: [],
      },
    ];
  if (Array.isArray(value))
    return value.map((v, i) => {
      if (!v || typeof v !== 'object' || Array.isArray(v))
        throw new Error(`${path}[${i}] is not an object`);
      const candidateSpans = Object.fromEntries(
        Object.entries(spans)
          .filter(([key]) => key.startsWith(`[${i}].`))
          .map(([key, value]) => [key.slice(`[${i}].`.length), value]),
      );
      return {
        source: `${path}#${i + 1}`,
        physicalPath: path,
        data: v as Record<string, unknown>,
        spans: candidateSpans,
        links: [],
        sections: [],
      };
    });
  throw new Error(`${path} root must be object or array of objects`);
}
function parseJsonl(text: string, path: string): Candidate[] {
  const out: Candidate[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!;
    if (!raw.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${path}: JSONL line ${index + 1} is malformed: ${String(error)}`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`${path}: JSONL line ${index + 1} must be an object`);
    out.push({
      source: `${path}#line=${index + 1}`,
      physicalPath: path,
      data: value as Record<string, unknown>,
      spans: sourceSpans(raw, Object.keys(value)),
      links: [],
      sections: [],
    });
  }
  return out;
}
export function parseContents(path: string, text: string): Candidate[] {
  const ext = extname(path).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return [markdown(path, text)];
  if (ext === '.csv') return parseCsv(text, path);
  if (ext === '.jsonl') return parseJsonl(text, path);
  if (ext === '.json') {
    return objectCandidates(path, JSON.parse(text));
  }
  const docs = parseAllDocuments(text);
  const out: Candidate[] = [];
  let n = 0;
  for (const doc of docs) {
    n++;
    if (doc.errors.length) throw new Error(`${path} document ${n}: ${String(doc.errors[0])}`);
    const v = doc.toJS();
    if (v === null || v === undefined) continue;
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      (v as Record<string, unknown>).lore_manifest !== undefined
    ) {
      const manifest = v as Record<string, unknown>;
      const version = manifest.lore_manifest;
      const rawBindings = manifest.bindings;
      const rawTables = manifest.tables;
      const spans = nodeSpans(doc, text);
      const diagnostics: import('@khaale/lore-core').Diagnostic[] = [];
      for (const key of Object.keys(manifest))
        if (key !== 'lore_manifest' && key !== 'bindings' && key !== 'tables')
          diagnostics.push({
            severity: 'error',
            code: 'BINDING_KEY',
            message: `manifest key ${key} is not supported`,
            source: path,
            ...(spans[key] ? { span: spans[key] } : {}),
          });
      if (version !== 1) {
        diagnostics.push({
          severity: 'error',
          code: 'BINDING_VERSION',
          message: 'lore_manifest must be version 1',
          source: path,
          ...(spans.lore_manifest ? { span: spans.lore_manifest } : {}),
        });
      }
      if (rawBindings !== undefined && !Array.isArray(rawBindings)) {
        diagnostics.push({
          severity: 'error',
          code: 'BINDING_SHAPE',
          message: 'manifest bindings must be a list',
          source: path,
          ...(spans.bindings ? { span: spans.bindings } : {}),
        });
      }
      const bindings: ManifestBinding[] = [];
      for (const [index, item] of (Array.isArray(rawBindings) ? rawBindings : []).entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          diagnostics.push({
            severity: 'error',
            code: 'BINDING_SHAPE',
            message: `manifest binding ${index + 1} must be a mapping`,
            source: path,
            ...(spans[`bindings[${index}]`] ? { span: spans[`bindings[${index}]`] } : {}),
          });
          continue;
        }
        const value = item as Record<string, unknown>;
        for (const key of Object.keys(value))
          if (!['document', 'anchor', 'heading_id', 'id', 'properties'].includes(key))
            diagnostics.push({
              severity: 'error',
              code: 'BINDING_KEY',
              message: `manifest binding ${index + 1} key ${key} is not supported`,
              source: path,
              ...(spans[`bindings[${index}].${key}`]
                ? { span: spans[`bindings[${index}].${key}`] }
                : spans[`bindings[${index}]`]
                  ? { span: spans[`bindings[${index}]`] }
                  : {}),
            });
        const document = typeof value.document === 'string' ? value.document : '';
        const id = typeof value.id === 'string' ? value.id : '';
        const headingIdValue = value.heading_id;
        const headingId = typeof headingIdValue === 'string' ? headingIdValue : '';
        const properties = value.properties;
        const anchorValue = value.anchor;
        const anchor =
          anchorValue === undefined
            ? undefined
            : typeof anchorValue === 'string'
              ? anchorValue
              : '';
        if (anchorValue !== undefined && (!anchor || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(anchor)))
          diagnostics.push({
            severity: 'error',
            code: 'BINDING_ANCHOR',
            message: `manifest binding ${index + 1} anchor must match [A-Za-z][A-Za-z0-9_-]*`,
            source: path,
            ...(spans[`bindings[${index}].anchor`]
              ? { span: spans[`bindings[${index}].anchor`] }
              : {}),
          });
        if (headingIdValue !== undefined && (!headingId || anchorValue !== undefined || id))
          diagnostics.push({
            severity: 'error',
            code: 'BINDING_TARGET_MODE',
            message: `manifest binding ${index + 1} heading_id requires a non-empty value and cannot be combined with anchor or id`,
            source: path,
            ...(spans[`bindings[${index}].heading_id`]
              ? { span: spans[`bindings[${index}].heading_id`] }
              : {}),
          });
        if (
          !document ||
          (!id && !headingId) ||
          !properties ||
          typeof properties !== 'object' ||
          Array.isArray(properties) ||
          (anchorValue !== undefined && !anchor) ||
          (headingIdValue !== undefined && (!headingId || anchorValue !== undefined || !!id))
        ) {
          diagnostics.push({
            severity: 'error',
            code: 'BINDING_SHAPE',
            message: `manifest binding ${index + 1} requires document, id and mapping properties`,
            source: path,
            ...(spans[`bindings[${index}]`] ? { span: spans[`bindings[${index}]`] } : {}),
          });
          continue;
        }
        const propertySpans: Record<string, SourceSpan> = {};
        for (const name of Object.keys(properties)) {
          const located =
            spans[`bindings[${index}].properties.${name}`] ?? spans[`bindings[${index}]`];
          if (located) propertySpans[name] = located;
        }
        bindings.push({
          document,
          ...(anchor ? { anchor } : {}),
          ...(headingId ? { headingId } : {}),
          id: id || headingId,
          properties: properties as Record<string, unknown>,
          source: path,
          ...(spans[`bindings[${index}]`] ? { span: spans[`bindings[${index}]`] } : {}),
          propertySpans,
        });
      }
      const tables: TableDeclaration[] = [];
      if (rawTables !== undefined && !Array.isArray(rawTables))
        diagnostics.push({
          severity: 'error',
          code: 'TABLE_DECLARATION_SHAPE',
          message: 'manifest tables must be a list',
          source: path,
          ...(spans.tables ? { span: spans.tables } : {}),
        });
      for (const [index, item] of (Array.isArray(rawTables) ? rawTables : []).entries()) {
        const tablePath = `tables[${index}]`;
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          diagnostics.push({
            severity: 'error',
            code: 'TABLE_DECLARATION_SHAPE',
            message: `manifest table ${index + 1} must be a mapping`,
            source: path,
            ...(spans[tablePath] ? { span: spans[tablePath] } : {}),
          });
          continue;
        }
        const value = item as Record<string, unknown>;
        const sourceSpan = spans[tablePath];
        const allowed = new Set(['document', 'name', 'scope', 'class', 'id_column', 'columns']);
        let valid = true;
        for (const key of Object.keys(value))
          if (!allowed.has(key)) {
            valid = false;
            diagnostics.push({
              severity: 'error',
              code: 'TABLE_DECLARATION_KEY',
              message: `manifest table ${index + 1} key ${key} is not supported`,
              source: path,
              ...(spans[`${tablePath}.${key}`]
                ? { span: spans[`${tablePath}.${key}`] }
                : sourceSpan
                  ? { span: sourceSpan }
                  : {}),
            });
          }
        const document = typeof value.document === 'string' ? value.document : '';
        const name = typeof value.name === 'string' ? value.name : '';
        const scope = typeof value.scope === 'string' ? value.scope : '';
        const runtimeClass = typeof value.class === 'string' ? value.class : '';
        const idColumn = typeof value.id_column === 'string' ? value.id_column : '';
        const columns = value.columns;
        if (
          !document ||
          !name ||
          !scope ||
          !runtimeClass ||
          !idColumn ||
          !columns ||
          typeof columns !== 'object' ||
          Array.isArray(columns)
        ) {
          valid = false;
          diagnostics.push({
            severity: 'error',
            code: 'TABLE_DECLARATION_SHAPE',
            message: `manifest table ${index + 1} requires document, name, scope, class, id_column, and columns`,
            source: path,
            ...(sourceSpan ? { span: sourceSpan } : {}),
          });
        }
        if (!tableNamePattern.test(name)) {
          valid = false;
          diagnostics.push({
            severity: 'error',
            code: 'TABLE_NAME',
            message: `table declaration name ${JSON.stringify(name)} must match [A-Za-z][A-Za-z0-9_-]*`,
            source: path,
            ...(sourceSpan ? { span: sourceSpan } : {}),
          });
        }
        const normalizedColumns: Record<string, string> = {};
        if (columns && typeof columns === 'object' && !Array.isArray(columns))
          for (const [header, slot] of Object.entries(columns as Record<string, unknown>))
            if (typeof slot === 'string' && slot) normalizedColumns[header] = slot;
            else {
              valid = false;
              diagnostics.push({
                severity: 'error',
                code: 'TABLE_COLUMN_SHAPE',
                message: `manifest table ${index + 1} column ${header} must map to a slot name`,
                source: path,
                ...(sourceSpan ? { span: sourceSpan } : {}),
              });
            }
        tables.push({
          document,
          name,
          scope,
          class: runtimeClass,
          idColumn,
          columns: normalizedColumns,
          source: path,
          physicalPath: path,
          valid,
          ...(sourceSpan ? { span: sourceSpan } : {}),
        });
      }
      out.push({
        source: path,
        physicalPath: path,
        data: {},
        spans,
        links: [],
        sections: [],
        manifest: {
          version: typeof version === 'number' ? version : Number(version),
          bindings,
          ...(tables.length ? { tables } : {}),
        },
        ...(diagnostics.length ? { parseDiagnostics: diagnostics } : {}),
      });
      continue;
    }
    const spans = nodeSpans(doc, text);
    const cs = objectCandidates(path, v, spans).map((candidate) => ({
      ...candidate,
      spans: Object.keys(candidate.spans).length
        ? candidate.spans
        : sourceSpans(text, Object.keys(candidate.data)),
    }));
    for (const c of cs) {
      if (docs.length > 1) c.source = `${path}#doc=${n}${c.source.slice(path.length)}`;
      out.push(c);
    }
  }
  return out;
}
export async function parseFile(path: string): Promise<Candidate[]> {
  return parseContents(path, await readFile(path, 'utf8'));
}
function sourcePattern(pattern: string): RegExp {
  let expression = '^';
  for (let i = 0; i < pattern.length; i++) {
    const part = pattern[i]!;
    if (part === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') {
        expression += '(?:.*/)?';
        i++;
      } else expression += '.*';
    } else if (part === '*') expression += '[^/]*';
    else if (part === '?') expression += '[^/]';
    else expression += part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${expression}$`);
}
/** Shared CLI and updater ingestion. A declared source exclusively owns each
 * matched file; errors are returned for the existing publication gate. */
export async function readSources(
  options: ScanOptions,
  compiled: CompiledSchema,
  discoveredFiles?: readonly string[],
): Promise<{ candidates: Candidate[]; diagnostics: import('@khaale/lore-core').Diagnostic[] }> {
  const files =
    discoveredFiles ?? (await discover({ ...options, dependencies: compiled.dependencies }));
  const candidates: Candidate[] = [],
    diagnostics: import('@khaale/lore-core').Diagnostic[] = [];
  const plans = (compiled.ir.sources ?? []).map((plan) => ({
    plan,
    patterns: plan.files.map(sourcePattern),
  }));
  const root = resolve(options.root);
  const relativeFiles = files.map((file) => relative(root, file).split('\\').join('/'));
  for (const { plan } of plans)
    for (const literal of plan.files.filter((pattern) => !/[?*]/.test(pattern))) {
      if (!relativeFiles.includes(literal))
        diagnostics.push({
          severity: 'error',
          code: 'SOURCE_INPUT',
          source: resolve(root, literal),
          message: `${plan.name}: literal source input is missing or excluded`,
        });
    }
  const readBatchSize = 16;
  for (let offset = 0; offset < files.length; offset += readBatchSize) {
    const batch = files.slice(offset, offset + readBatchSize).map((path, index) => ({
      path,
      rel: relativeFiles[offset + index]!,
      owners: plans.filter(({ patterns }) =>
        patterns.some((pattern) => pattern.test(relativeFiles[offset + index]!)),
      ),
    }));
    const contents = await Promise.allSettled(
      batch.map(({ path, owners }) =>
        owners.length > 1 ? Promise.resolve('') : readFile(path, 'utf8'),
      ),
    );
    // Consume in discovery order even when reads complete out of order.
    for (const [index, { path, rel, owners }] of batch.entries()) {
      if (owners.length > 1) {
        diagnostics.push({
          severity: 'error',
          code: 'SOURCE_OWNERSHIP',
          source: path,
          message: `ambiguous source ownership: ${owners.map(({ plan }) => plan.name).join(', ')}`,
        });
        continue;
      }
      try {
        const content = contents[index]!;
        if (content.status === 'rejected') throw content.reason;
        const text = content.value;
        const owner = owners[0]?.plan;
        if (!owner) {
          candidates.push(...parseContents(path, text));
          continue;
        }
        let document: unknown;
        if (extname(path).toLowerCase() === '.json') document = JSON.parse(text);
        else if (['.yaml', '.yml'].includes(extname(path).toLowerCase())) {
          const docs = parseAllDocuments(text);
          if (docs.length !== 1 || docs[0]!.errors.length)
            throw new Error('declared YAML source must contain exactly one valid document');
          document = docs[0]!.toJS();
        } else throw new Error('declared sources support YAML and JSON only');
        const namespace = owner.namespace === undefined ? [owner.name, rel] : [owner.namespace];
        candidates.push(...extractSource(document, owner, namespace, path));
      } catch (error) {
        diagnostics.push({
          severity: 'error',
          code:
            error instanceof SourceExtractionError
              ? error.code
              : owners.length
                ? 'SOURCE_EXTRACTION'
                : 'PARSE',
          source: path,
          message:
            owners[0] && !(error instanceof SourceExtractionError)
              ? `${owners[0].plan.name}/<document> at #: ${String(error)}`
              : String(error),
        });
      }
    }
  }
  return { candidates, diagnostics };
}
export type ScanOptions = {
  root: string;
  schemaPath?: string;
  ignorePath?: string;
  outputPath?: string;
  dependencies?: string[];
};
/** Discover local schema imports without requiring the schema to compile. This
 * deliberately only follows relative file-like import values and is used by
 * watch so a broken import can still be repaired and trigger a rebuild. */
export async function discoverSchemaDependencies(schemaPath: string): Promise<string[]> {
  const found = new Set<string>();
  const visit = async (file: string): Promise<void> => {
    const absolute = resolve(file);
    if (found.has(absolute)) return;
    found.add(absolute);
    let text: string;
    try {
      text = await readFile(absolute, 'utf8');
    } catch {
      return;
    }
    const values = [...text.matchAll(/^\s*(?:-|)\s*imports?\s*:\s*(?:\[([^\]]*)\]|([^\s#]+))/gim)]
      .flatMap((m) =>
        (m[1] ?? m[2] ?? '').split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')),
      )
      .filter((x) => x && !x.startsWith('linkml:') && !isAbsolute(x));
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*imports?\s*:\s*$/.test(lines[i]!)) continue;
      for (let j = i + 1; j < lines.length && /^\s*-\s*/.test(lines[j]!); j++) {
        const value = lines[j]!.replace(/^\s*-\s*/, '')
          .split('#', 1)[0]!
          .trim()
          .replace(/^['"]|['"]$/g, '');
        if (value && !value.startsWith('linkml:') && !isAbsolute(value)) values.push(value);
      }
    }
    for (const value of values) {
      const candidate = resolve(
        dirname(absolute),
        value.endsWith('.yaml') || value.endsWith('.yml') ? value : `${value}.yaml`,
      );
      await visit(candidate);
    }
  };
  await visit(schemaPath);
  found.delete(resolve(schemaPath));
  return [...found].sort();
}
export async function discover(options: ScanOptions): Promise<string[]> {
  const root = resolve(options.root);
  const ignores: string[] = [];
  if (options.ignorePath) {
    try {
      ignores.push(...(await readFile(options.ignorePath, 'utf8')).split(/\r?\n/));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(`read ignore file ${options.ignorePath}: ${String(e)}`);
    }
  }
  const matcher = ignore();
  try {
    for (const pattern of ignores) {
      const trimmed = pattern.trimEnd();
      if (
        trimmed &&
        !trimmed.startsWith('#') &&
        (trimmed.match(/\[/g)?.length ?? 0) !== (trimmed.match(/\]/g)?.length ?? 0)
      )
        throw new Error(`invalid ignore pattern ${trimmed}`);
    }
    matcher.add(ignores);
  } catch (error) {
    throw new Error(`invalid ignore pattern: ${String(error)}`);
  }
  const excluded = new Set([
    ...MODEL_FILENAMES.map((name) => resolve(root, name)),
    resolve(options.schemaPath ?? ''),
    resolve(options.ignorePath ?? ''),
    resolve(options.outputPath ?? ''),
    ...(options.dependencies ?? []).map((x) => resolve(x)),
  ]);
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const p = join(dir, e.name),
        rel = relative(root, p).split('\\').join('/');
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === '.artifact-index') continue;
        if (matcher.ignores(`${rel}/`)) continue;
        await walk(p);
      } else if (!excluded.has(resolve(p)) && supported(p) && !matcher.ignores(rel)) out.push(p);
    }
  }
  await walk(root);
  return out.sort();
}
export async function readIndex(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function publishIndex(path: string, index: unknown): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(index, null, 2), { mode: 0o644 });
    await rename(temp, path);
  } catch (e) {
    try {
      await unlink(temp);
    } catch {
      // Best effort cleanup; preserve the original publication error.
    }
    throw e;
  }
}
export type FileStamp = { path: string; size: number; mtimeMs: number };
export async function snapshot(
  options: ScanOptions,
  discoveredFiles?: readonly string[],
): Promise<FileStamp[]> {
  const files = new Set(discoveredFiles ?? (await discover(options)));
  for (const path of [options.schemaPath, options.ignorePath, ...(options.dependencies ?? [])]) {
    if (path && resolve(path) !== resolve(options.outputPath ?? '')) files.add(path);
  }
  const stamps = await Promise.all(
    [...files].sort().map(async (p) => {
      try {
        const s = await stat(p);
        return { path: p, size: s.size, mtimeMs: s.mtimeMs };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          return { path: p, size: -1, mtimeMs: -1 };
        throw error;
      }
    }),
  );
  return stamps;
}
export type WatchClock = {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
};
export class PollWatcher {
  private last = '';
  private readonly clock: WatchClock;
  constructor(
    public readonly pollMs = 150,
    public readonly debounceMs = 300,
    clock: WatchClock = {
      now: () => Date.now(),
      sleep: (milliseconds) => new Promise((r) => setTimeout(r, milliseconds)),
    },
  ) {
    this.clock = clock;
  }
  async run(
    options: ScanOptions,
    onChange: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    let dirty = 0;
    while (!signal?.aborted) {
      const current = JSON.stringify(await snapshot(options));
      if (this.last && current !== this.last) dirty = this.clock.now();
      this.last = current;
      if (dirty && this.clock.now() - dirty >= this.debounceMs) {
        dirty = 0;
        await onChange();
      }
      await this.clock.sleep(this.pollMs);
    }
  }
}
