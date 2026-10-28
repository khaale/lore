#!/usr/bin/env node
import { openFilesystemWorkspace } from '@khaale/lore';

const workspace = await openFilesystemWorkspace({ root: 'examples/decisions' });
// These fields belong to the included decisions model; other models supply their own vocabulary.
const saved = await workspace.call(async (read) =>
  read.retain(
    await read.query({
      type: 'Decision',
      where: { status: { eq: 'accepted' } },
      select: ['title', 'status'],
    }),
  ),
);
if (saved.status === 'failed') throw new Error(saved.error.message);
const reference = saved.result;

const response = await workspace.call(async (read) => {
  const { value: decisions } = await read.results.get(reference);
  const graph = await read.graph.neighborhood(decisions, { depth: 1 });
  return { decisions: read.limitItems(decisions), graph: read.limitGraph(graph) };
});
if (response.status === 'failed') throw new Error(response.error.message);
console.log(JSON.stringify(response.result, null, 2));
console.log(response.trace);
