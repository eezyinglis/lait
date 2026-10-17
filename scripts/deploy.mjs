// Tests, builds and publishes dist/ to the gh-pages branch (GitHub Pages "deploy from branch").
// Usage: npm run deploy
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const remote = execSync('git remote get-url origin').toString().trim();
const sha = execSync('git rev-parse --short HEAD').toString().trim();

run('npm test');
run('npm run build');
// No Jekyll processing on Pages; serve files as built.
fs.writeFileSync('dist/.nojekyll', '');

const git = (args) => run(`git ${args}`, { cwd: 'dist' });
fs.rmSync('dist/.git', { recursive: true, force: true });
git('init -q -b gh-pages');
git('add -A');
git(`-c user.name="LAIT deploy" -c user.email="deploy@lait.local" commit -q -m "Deploy ${sha}"`);
git(`push -q -f ${remote} gh-pages`);
fs.rmSync('dist/.git', { recursive: true, force: true });
console.log(`Deployed ${sha} to gh-pages.`);
