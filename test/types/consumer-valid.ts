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
