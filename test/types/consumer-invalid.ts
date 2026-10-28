import { openFilesystemWorkspace } from '@khaale/lore';

async function invalidConsumer(root: string): Promise<void> {
  const workspace = await openFilesystemWorkspace({ root });
  // @ts-expect-error consumer cannot access an undeclared query option.
  await workspace.query({ limit: 2, unknownArgument: true });
  const result = await workspace.query({ limit: 2 });
  // @ts-expect-error consumer cannot read a field that is not part of the public result.
  console.log(result.missingResultField);
  // @ts-expect-error neighborhood requires an explicit finite depth.
  await workspace.graph.neighborhood(['seed'], { maxNodes: 2 });
  // @ts-expect-error graph options do not accept an arbitrary limit name.
  await workspace.graph.neighbors(['seed'], { nodeLimit: 2 });
  // @ts-expect-error graph collections contain entity identities, not arbitrary rows.
  await workspace.graph.neighbors({ items: [{ name: 'seed' }] });
  await workspace.call(async (read) => {
    // @ts-expect-error PTC queries return complete collections, not pages.
    await read.query({ limit: 2 });
    // @ts-expect-error graph size limits belong to output previews in PTC.
    await read.graph.boundary(['seed'], { maxNodes: 2 });
    const values = await read.query();
    // @ts-expect-error complete PTC collections have no continuation token.
    console.log(values.continuation);
  });
}

void invalidConsumer('/tmp/unused-sdk-typecheck-fixture');
