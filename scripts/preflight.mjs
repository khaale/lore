#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));

const usage =
  'usage: pnpm preflight [--node-version <version>] [--pnpm-version <version>] [--project-root <path>]';

const parseArguments = (argumentsList) => {
  const options = { projectRoot: defaultRoot };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--') continue;
    if (argument === '--help') {
      console.log(usage);
      process.exit(0);
    }
    if (argument === '--node-version') {
      const value = argumentsList[++index];
      if (value === undefined || value.startsWith('--'))
        throw new Error(`missing value for ${argument}\n${usage}`);
      options.nodeVersion = value;
    } else if (argument === '--pnpm-version') {
      const value = argumentsList[++index];
      if (value === undefined || value.startsWith('--'))
        throw new Error(`missing value for ${argument}\n${usage}`);
      options.pnpmVersion = value;
    } else if (argument === '--project-root') {
      const value = argumentsList[++index];
      if (value === undefined || value.startsWith('--'))
        throw new Error(`missing value for ${argument}\n${usage}`);
      options.projectRoot = resolve(value);
    } else {
      throw new Error(`unknown argument ${argument}\n${usage}`);
    }
  }
  return options;
};

const readJson = async (path, label) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `cannot read ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const parseNodeRange = (value) => {
  if (typeof value !== 'string') throw new Error('package.json engines.node must be a string');
  const match = /^>=(\d+)\.0\.0 <(\d+)(?:\.0\.0)?$/.exec(value);
  if (!match || Number(match[2]) !== Number(match[1]) + 1)
    throw new Error(
      `unsupported engines.node declaration ${JSON.stringify(value)}; expected >=<major>.0.0 <<major+1>`,
    );
  return { minimumMajor: Number(match[1]), maximumMajor: Number(match[2]) };
};

const parsePackageManager = (value) => {
  if (typeof value !== 'string') throw new Error('package.json packageManager must be a string');
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(value);
  if (!match)
    throw new Error(
      `unsupported packageManager declaration ${JSON.stringify(value)}; expected pnpm@<version>`,
    );
  return { name: 'pnpm', version: match[1] };
};

const parseVersion = (value, label) => {
  const normalized = String(value ?? '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized))
    throw new Error(`${label} version is malformed: ${JSON.stringify(value)}`);
  return normalized;
};

const actualPnpmVersion = () => {
  const userAgent = process.env.npm_config_user_agent ?? '';
  const match = /(?:^|\s)pnpm\/(\d+\.\d+\.\d+)(?:\s|$)/.exec(userAgent);
  return match?.[1];
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const packageJson = await readJson(resolve(options.projectRoot, 'package.json'), 'package.json');
  const nodeRange = parseNodeRange(packageJson.engines?.node);
  const packageManager = parsePackageManager(packageJson.packageManager);
  if (packageJson.engines?.pnpm !== packageManager.version)
    throw new Error(
      `engines.pnpm ${JSON.stringify(packageJson.engines?.pnpm)} drifts from packageManager ${JSON.stringify(packageJson.packageManager)}`,
    );
  const selector = (await readFile(resolve(options.projectRoot, '.node-version'), 'utf8')).trim();
  if (!/^\d+$/.test(selector) || Number(selector) !== nodeRange.minimumMajor)
    throw new Error(
      `.node-version ${JSON.stringify(selector)} drifts from engines.node ${JSON.stringify(packageJson.engines.node)}`,
    );

  const nodeVersion = parseVersion(options.nodeVersion ?? process.versions.node, 'Node');
  const pnpmVersion = parseVersion(options.pnpmVersion ?? actualPnpmVersion(), 'pnpm');
  const nodeMajor = Number(nodeVersion.split('.')[0]);
  const failures = [];
  if (
    nodeVersion.includes('-') ||
    nodeMajor < nodeRange.minimumMajor ||
    nodeMajor >= nodeRange.maximumMajor
  )
    failures.push(`Node expected ${packageJson.engines.node}, actual ${nodeVersion}`);
  if (pnpmVersion !== packageManager.version)
    failures.push(`pnpm expected ${packageJson.packageManager}, actual pnpm@${pnpmVersion}`);
  if (failures.length) {
    for (const failure of failures) console.error(`toolchain preflight failed: ${failure}`);
    console.error('use the Node and pnpm versions declared in package.json, then retry');
    process.exitCode = 1;
    return;
  }
  console.log(`toolchain preflight passed: Node ${nodeVersion}; pnpm ${pnpmVersion}`);
};

try {
  await main();
} catch (error) {
  console.error(
    `toolchain preflight failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
