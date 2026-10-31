import { describe, expect, it } from 'vitest';
import { buildGraph, checkReport, explore, type Candidate } from './index.js';
import type { CompiledSchema } from '@khaale/lore-schema';

const compiled = {
  hash: 'h',
  dependencies: [],
  schema: { classes: {}, slots: {}, types: {}, enums: {} },
  ir: {
    name: 'x',
    classes: {
      Thing: {
        name: 'Thing',
        typeId: 'Thing',
        mixins: [],
        abstract: false,
        mixin: false,
        slots: {
          id: {
            name: 'id',
            range: 'string',
            required: true,
            recommended: false,
            multivalued: false,
            identifier: true,
            key: false,
            mode: 'scalar',
            designatesType: false,
            patterns: [],
            anyOf: [],
            allOf: [],
            noneOf: [],
            exactlyOneOf: [],
            annotations: {},
          },
          kind: {
            name: 'kind',
            range: 'string',
            required: false,
            recommended: false,
            multivalued: false,
            identifier: false,
            key: false,
            mode: 'scalar',
            designatesType: true,
            patterns: [],
            anyOf: [],
            allOf: [],
            noneOf: [],
            exactlyOneOf: [],
            annotations: {},
          },
        },
        classificationRules: [],
        designatorSlot: 'kind',
        uniqueKeys: {},
        allowExtra: false,
        depth: 1,
        annotations: {},
      },
    },
    types: {},
    enums: {},
    designators: {},
  },
} as unknown as CompiledSchema;
const candidate = (data: Record<string, unknown>): Candidate => ({
  source: '/workspace/a.yaml',
  physicalPath: '/workspace/a.yaml',
  data,
  spans: {},
  links: [],
  sections: [],
});
describe('core graph', () => {
  it('preserves direct IDs, path resolution and ambiguous ID/stem collisions', () => {
    const thing = compiled.ir.classes.Thing!;
    const withReferences = {
      ...compiled,
      ir: {
        ...compiled.ir,
        classes: {
          Thing: {
            ...thing,
            slots: {
              ...thing.slots,
              depends: {
                ...thing.slots.id!,
                name: 'depends',
                identifier: false,
                required: false,
                multivalued: true,
                range: 'Thing',
                mode: 'reference' as const,
              },
            },
          },
        },
      },
    };
    const document = (id: string, path: string): Candidate => ({
      ...candidate({ id, kind: 'Thing' }),
      source: path,
      physicalPath: path,
    });
    const source = document('document', '/workspace/document.md');
    source.data.depends = ['target', '[[target]]', '[Target](./target.md)', '[[same|Label]]'];
    source.links = [{ syntax: 'markdown', target: './target.md' }];
    const result = buildGraph(
      [
        source,
        document('target', '/workspace/elsewhere.md'),
        document('other', '/workspace/target.md'),
        document('same', '/workspace/same.md'),
      ],
      { root: '/workspace', compiled: withReferences },
    );
    expect(
      result.index.edges?.map(({ relation, to, surface }) => ({ relation, to, surface })),
    ).toEqual([
      { relation: 'depends', to: 'other', surface: '[Target](./target.md)' },
      { relation: 'depends', to: 'same', surface: '[[same|Label]]' },
      { relation: 'depends', to: 'target', surface: 'target' },
      { relation: 'references', to: 'other', surface: './target.md' },
    ]);
    expect(result.index.diagnostics?.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'BROKEN_REFERENCE', message: 'cannot resolve reference "[[target]]"' },
    ]);
  });

  it('keeps shared physical paths and duplicate file stems ambiguous', () => {
    const document = (id: string, source: string, physicalPath = source): Candidate => ({
      ...candidate({ id, kind: 'Thing' }),
      source,
      physicalPath,
    });
    const source = document('document', '/workspace/document.md');
    source.links = [
      { syntax: 'markdown', target: './group.md' },
      { syntax: 'wiki', target: '[[group]]' },
      { syntax: 'wiki', target: '[[duplicate]]' },
    ];
    const result = buildGraph(
      [
        source,
        document('first', '/workspace/group.md#one', '/workspace/group.md'),
        document('second', '/workspace/group.md#two', '/workspace/group.md'),
        document('left', '/workspace/left/duplicate.md'),
        document('right', '/workspace/right/duplicate.md'),
      ],
      { root: '/workspace', compiled },
    );
    expect(result.index.edges).toEqual([]);
    expect(result.index.diagnostics?.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'UNRESOLVED_WIKILINK', message: 'cannot resolve wiki-link [[[[group]]]]' },
      { code: 'UNRESOLVED_WIKILINK', message: 'cannot resolve wiki-link [[[[duplicate]]]]' },
    ]);
  });

  it('builds identity, reports, and bounded exploration', () => {
    const result = buildGraph([candidate({ id: 'a', kind: 'Thing' })], {
      root: '/workspace',
      compiled,
    });
    expect(result.index.artifacts.a?.kind).toBe('Thing');
    expect(checkReport(result.index).summary.artifacts).toBe(1);
    expect(explore(result.index, 'overview', undefined, 1, compiled.ir).data).toMatchObject({
      artifacts: 1,
    });
    expect(() => explore(result.index, 'tree', 'a', 33, compiled.ir)).toThrow(/depth/);
  });

  it('retains valid artifacts while reporting strict extras', () => {
    const result = buildGraph([candidate({ id: 'a', kind: 'Thing', extra: 1 })], {
      root: '/workspace',
      compiled,
    });
    expect(result.index.artifacts.a).toBeDefined();
    expect((result.index.diagnostics ?? []).map((x) => x.code)).toContain('UNKNOWN_SLOT');
  });

  it('reports invalid and overlapping semantic Markdown selectors', () => {
    const baseClass = compiled.ir.classes.Thing!;
    const invalidClass = {
      ...baseClass,
      slots: {
        ...baseClass.slots,
        id: {
          ...baseClass.slots.id!,
          annotations: { 'lore:markdown_selectors': ['### Depends', 'Depends'] },
        },
        kind: {
          ...baseClass.slots.kind!,
          annotations: { 'lore:markdown_selectors': '### Depends' },
        },
      },
    };
    const result = buildGraph(
      [
        {
          ...candidate({ id: 'a', kind: 'Thing' }),
          sections: [{ heading: 'Depends', level: 3, blocks: ['value'], lists: [], links: [] }],
        },
      ],
      {
        root: '/workspace',
        compiled: {
          ...compiled,
          ir: { ...compiled.ir, classes: { ...compiled.ir.classes, Thing: invalidClass } },
        },
      },
    );
    expect(result.index.diagnostics?.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['INVALID_MARKDOWN_SELECTOR', 'AMBIGUOUS_MARKDOWN_SELECTOR']),
    );
  });

  it('rejects nested selected Markdown regions with located ownership diagnostics', () => {
    const baseClass = compiled.ir.classes.Thing!;
    const selectedClass = {
      ...baseClass,
      slots: {
        ...baseClass.slots,
        status: {
          ...baseClass.slots.id!,
          name: 'status',
          annotations: { 'lore:markdown_selectors': ['### Status'] },
        },
        detail: {
          ...baseClass.slots.id!,
          name: 'detail',
          annotations: { 'lore:markdown_selectors': ['#### Detail'] },
        },
      },
    };
    const result = buildGraph(
      [
        {
          ...candidate({ id: 'a', kind: 'Thing' }),
          enriched: true,
          sections: [
            {
              heading: 'Status',
              level: 3,
              blocks: ['active'],
              lists: [],
              links: [],
              span: { line: 2, column: 1 },
            },
            {
              heading: 'Detail',
              level: 4,
              blocks: ['text'],
              lists: [],
              links: [],
              span: { line: 3, column: 1 },
            },
            {
              heading: 'Next',
              level: 2,
              blocks: [],
              lists: [],
              links: [],
              span: { line: 4, column: 1 },
            },
          ],
        },
      ],
      {
        root: '/workspace',
        compiled: {
          ...compiled,
          ir: { ...compiled.ir, classes: { ...compiled.ir.classes, Thing: selectedClass } },
        },
      },
    );
    const overlap = result.index.diagnostics?.find(
      (diagnostic) => diagnostic.code === 'OWNERSHIP_CONFLICT' && diagnostic.slot === 'detail',
    );
    expect(overlap).toMatchObject({ span: { line: 3 }, related_spans: [{ line: 2 }] });
  });

  it('treats declared empty and null values as enriched ownership, including document bindings', () => {
    const selectedClass = {
      ...compiled.ir.classes.Thing!,
      slots: {
        ...compiled.ir.classes.Thing!.slots,
        status: {
          ...compiled.ir.classes.Thing!.slots.id!,
          name: 'status',
          annotations: { 'lore:markdown_selectors': ['### Status'] },
        },
        depends: {
          ...compiled.ir.classes.Thing!.slots.id!,
          name: 'depends',
          range: 'Thing',
          multivalued: true,
          mode: 'reference' as const,
          annotations: { 'lore:markdown_selectors': ['### Depends'] },
        },
      },
    };
    const document = {
      ...candidate({ id: 'doc', kind: 'Thing', status: 'active' }),
      physicalPath: '/workspace/doc.md',
      source: '/workspace/doc.md',
      sections: [
        {
          heading: 'Status',
          level: 3,
          blocks: ['active'],
          lists: [],
          links: [],
          span: { line: 2, column: 1 },
        },
      ],
    };
    const manifest = {
      ...candidate({}),
      source: '/workspace/enrich.yaml',
      physicalPath: '/workspace/enrich.yaml',
      manifest: {
        version: 1,
        bindings: [
          {
            document: 'doc.md',
            id: 'doc',
            properties: { status: 'active' },
            source: '/workspace/enrich.yaml',
          },
        ],
      },
    };
    const bound = buildGraph([document, manifest], {
      root: '/workspace',
      compiled: {
        ...compiled,
        ir: { ...compiled.ir, classes: { ...compiled.ir.classes, Thing: selectedClass } },
      },
      strict: true,
    });
    expect(bound.index.artifacts.doc?.provenance?.enriched).toBe(true);
    expect(bound.index.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
      'OWNERSHIP_CONFLICT',
    );

    const section = buildGraph(
      [
        {
          ...candidate({ id: 'doc', kind: 'Thing' }),
          sectionDeclarations: { one: { id: 'one', kind: 'Thing', status: null, depends: [] } },
          sections: [
            {
              heading: 'One',
              level: 2,
              anchor: 'one',
              blocks: [],
              lists: [],
              links: [],
              span: { line: 2, column: 1 },
            },
            {
              heading: 'Status',
              level: 3,
              blocks: ['active'],
              lists: [],
              links: [],
              span: { line: 3, column: 1 },
            },
            {
              heading: 'Depends',
              level: 3,
              blocks: [],
              lists: [],
              links: [],
              span: { line: 4, column: 1 },
            },
          ],
        },
      ],
      {
        root: '/workspace',
        compiled: {
          ...compiled,
          ir: { ...compiled.ir, classes: { ...compiled.ir.classes, Thing: selectedClass } },
        },
        strict: true,
      },
    );
    expect(section.index.diagnostics?.map((diagnostic) => diagnostic.code)).not.toContain(
      'MARKDOWN_SLOT_SHAPE',
    );
    expect(section.index.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
      'OWNERSHIP_CONFLICT',
    );
    expect(section.index.artifacts.one?.provenance?.properties?.depends?.representation).toBe(
      'frontmatter',
    );

    const writable = buildGraph(
      [
        {
          ...candidate({ id: 'doc', kind: 'Thing' }),
          sectionDeclarations: { one: { id: 'one', kind: 'Thing' } },
          sections: [
            {
              heading: 'One',
              level: 2,
              anchor: 'one',
              blocks: [],
              lists: [],
              links: [],
              span: { line: 2, column: 1 },
            },
            {
              heading: 'Depends',
              level: 3,
              blocks: [],
              lists: [],
              links: [],
              span: { line: 3, column: 1 },
            },
          ],
        },
      ],
      {
        root: '/workspace',
        compiled: {
          ...compiled,
          ir: { ...compiled.ir, classes: { ...compiled.ir.classes, Thing: selectedClass } },
        },
        strict: true,
      },
    );
    expect(writable.index.diagnostics?.map((diagnostic) => diagnostic.code)).not.toContain(
      'MARKDOWN_SLOT_SHAPE',
    );
    expect(writable.index.artifacts.one?.provenance?.properties?.depends?.representation).toBe(
      'markdown',
    );
  });

  it('classifies section declarations through runtime uid and category slots', () => {
    const runtimeClass = {
      ...compiled.ir.classes.Thing!,
      slots: {
        uid: { ...compiled.ir.classes.Thing!.slots.id!, name: 'uid', identifier: true },
        category: {
          ...compiled.ir.classes.Thing!.slots.kind!,
          name: 'category',
          designatesType: true,
        },
      },
      designatorSlot: 'category',
    };
    const result = buildGraph(
      [
        {
          ...candidate({ uid: 'doc', category: 'Thing' }),
          sectionDeclarations: { one: { uid: 'one', category: 'Thing' } },
          sections: [
            {
              heading: 'One',
              level: 2,
              anchor: 'one',
              blocks: [],
              lists: [],
              links: [],
              span: { line: 2, column: 1 },
            },
          ],
        },
      ],
      {
        root: '/workspace',
        compiled: { ...compiled, ir: { ...compiled.ir, classes: { Thing: runtimeClass } } },
        strict: true,
      },
    );
    expect(result.index.artifacts.one?.id).toBe('one');
    expect(result.index.artifacts.one?.data).toMatchObject({ uid: 'one', category: 'Thing' });
    expect(result.index.diagnostics).toEqual([]);

    const invalid = buildGraph(
      [
        {
          ...candidate({ uid: 'doc', category: 'Thing' }),
          sectionDeclarations: { one: { uid: 'one', category: 'Missing' } },
          sections: [
            {
              heading: 'One',
              level: 2,
              anchor: 'one',
              blocks: [],
              lists: [],
              links: [],
              span: { line: 2, column: 1 },
            },
          ],
        },
      ],
      {
        root: '/workspace',
        compiled: { ...compiled, ir: { ...compiled.ir, classes: { Thing: runtimeClass } } },
        strict: true,
      },
    );
    expect(invalid.index.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
      'INVALID_CLASS',
    );
  });

  it('does not copy document diagnostics into expanded sibling sections', () => {
    const documentDiagnostic = {
      severity: 'error' as const,
      code: 'BINDING_ANCHOR',
      message: 'unsupported section declaration anchor section.1',
      source: '/workspace/document.md',
      artifact: 'document',
      slot: 'lore.sections',
      span: { line: 4, column: 5 },
      related_spans: [{ line: 7, column: 1 }],
    };
    const result = buildGraph(
      [
        {
          ...candidate({ id: 'document', kind: 'Thing' }),
          parseDiagnostics: [documentDiagnostic],
          sectionDeclarations: {
            one: { kind: 'Thing' },
            two: { id: 'two', kind: 'Thing' },
          },
          sections: [
            {
              heading: 'One',
              level: 2,
              anchor: 'one',
              blocks: [],
              lists: [],
              links: [],
              span: { line: 7, column: 1 },
            },
            {
              heading: 'Two',
              level: 2,
              anchor: 'two',
              blocks: [],
              lists: [],
              links: [],
              span: { line: 10, column: 1 },
            },
          ],
        },
      ],
      { root: '/workspace', compiled, strict: true },
    );

    expect(result.index.diagnostics).toEqual(
      expect.arrayContaining([
        documentDiagnostic,
        expect.objectContaining({
          code: 'SECTION_ID_REQUIRED',
          artifact: 'one',
          span: { line: 7, column: 1 },
        }),
      ]),
    );
    expect(
      result.index.diagnostics?.filter((diagnostic) => diagnostic.code === documentDiagnostic.code),
    ).toEqual([documentDiagnostic]);
    expect(result.index.diagnostics?.filter((diagnostic) => diagnostic.artifact === 'one')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SECTION_ID_REQUIRED', span: { line: 7, column: 1 } }),
      ]),
    );
  });
});
