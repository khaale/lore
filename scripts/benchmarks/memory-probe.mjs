// Loaded in the actual CLI process, so native SQLite allocations are included.
import { writeFileSync } from 'node:fs';
process.on('exit', () => {
  writeFileSync(
    process.env.LORE_BENCHMARK_MEMORY_PATH,
    JSON.stringify({ peakRssKiB: process.resourceUsage().maxRSS, atExit: process.memoryUsage() }),
  );
});
