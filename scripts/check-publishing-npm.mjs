import { execFileSync } from 'node:child_process';

const version = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
const [major, minor, patch] = version.split('.').map(Number);
if (!(major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1))))) {
  throw new Error(`npm >=11.5.1 is required for trusted publishing; found ${version}`);
}
console.log(`Publishing with npm ${version}`);
