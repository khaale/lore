import {
  openFilesystemWorkspace,
  type Entity,
  type GraphResult,
  type GraphOptions,
  type QueryResult,
  type Workspace,
  type PtcResponse,
} from '@khaale/lore';

export async function validPtcConsumer(root: string): Promise<PtcResponse<string[]>> {
  const workspace = await openFilesystemWorkspace({ root });
  const saved = await workspace.call(async (read) => read.retain(await read.query()));
  if (saved.status === 'failed') throw new Error(saved.error.message);
  const reference = saved.result;
  return workspace.call(async (read) => {
    const { value } = await read.results.get(reference);
    await read.graph.subgraph(value);
    return read.limitItems(value).items.map(({ id }) => id);
  });
}

export async function validConsumer(root: string): Promise<QueryResult & { entity?: Entity }> {
  const workspace: Workspace = await openFilesystemWorkspace({ root });

  const description = await workspace.describe();
  const types = await workspace.schema.listTypes({ limit: 5 });
  const selectedType = types.items[0]?.name;
  if (!selectedType)
    return {
      items: [],
      coverage: { complete: true, examined: 0, returned: 0, remaining: 0, reason: 'empty' },
      snapshot: description.snapshot,
    };
  const page = await workspace.query({ type: selectedType, select: ['id'], limit: 5 });
  const entity = page.items[0];
  return { ...page, ...(entity === undefined ? {} : { entity }) };
}

export async function validGraphConsumer(root: string): Promise<GraphResult> {
  const workspace: Workspace = await openFilesystemWorkspace({ root });

  const options: GraphOptions = {
    direction: 'both',
    relations: ['related'],
    nodeTypes: ['Child'],
    maxNodes: 20,
    maxEdges: 40,
  };
  await workspace.graph.neighbors(['seed'], options);
  const records = await workspace.query({ type: 'Child', limit: 10 });
  await workspace.graph.subgraph(records, options);
  await workspace.graph.neighbors(records.items, options);
  await workspace.graph.subgraph(['seed'], options);
  await workspace.graph.boundary(['seed'], options);
  return workspace.readSnapshot((read) =>
    read.graph.neighborhood(['seed'], { ...options, depth: 2 }),
  );
}

export async function validSqliteConsumer(indexPath: string): Promise<string> {
  const { openSqliteWorkspace, refreshSqliteIndex } = await import('@khaale/lore');
  const workspace = await openSqliteWorkspace({
    indexPath,
    freshness: { mode: 'refresh-on-read', maxAgeMs: 1000 },
  });
  try {
    await refreshSqliteIndex({ indexPath });
    return await workspace.readSnapshot(async (read) => {
      const page = await read.query({ limit: 10 });
      await read.graph.neighborhood(page, { depth: 1 });
      const kind: 'sqlite-generation' = page.snapshot.kind;
      return kind + page.snapshot.generationId;
    });
  } finally {
    await workspace.close();
  }
}

export async function validConstraintConsumer(
  root: string,
): Promise<import('@khaale/lore').RecordConstraintExpression[]> {
  const workspace = await openFilesystemWorkspace({ root });
  const catalog = await workspace.schema.listTypes();
  const type = await workspace.schema.describeType(catalog.items[0]!.name);
  const annotations: Record<string, unknown>[] = [
    type.annotations,
    ...type.fields.map((field) => field.annotations),
    ...(type.referencePaths ?? []).map((path) => path.annotations),
  ];
  const constraint: import('@khaale/lore').FieldConstraints | undefined =
    type.fields[0]?.constraints;
  console.log(
    annotations,
    constraint?.listElementsUnique,
    type.rules?.[0]?.postconditions,
    type.referencePaths?.[0]?.path,
  );
  return type.recordConstraints ?? [];
}

export async function validHierarchyConsumer(workspace: Workspace): Promise<string[]> {
  const proposal = await workspace.hierarchy.propose();
  const score: import('@khaale/lore').HierarchyTypeScores | undefined = Object.values(
    proposal.typeScores,
  )[0];
  void score;
  const definition: import('@khaale/lore').HierarchyDefinition = proposal.definition;
  const roots = await workspace.hierarchy.read({ definition, includeScores: true });
  const scoreItem = roots.items.find((n) => n.kind === 'entity');
  const individual: import('@khaale/lore').HierarchyInstanceScores | undefined = scoreItem?.scores;
  void individual;
  return roots.items.flatMap((node) => (node.kind === 'entity' ? [node.entityId] : []));
}
