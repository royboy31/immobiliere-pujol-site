import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const dirs = ['src/content/articles', 'src/content/services', 'src/content/pages', 'src/content/serviceImmobilier'];
let fixed = 0;
const errors = [];

for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const fp = path.join(dir, f);
    const content = fs.readFileSync(fp, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) continue;

    try {
      yaml.load(match[1]);
    } catch (e) {
      // Derive title from slug
      const slugMatch = match[1].match(/^slug:\s*"(.*)"/m);
      const slug = slugMatch ? slugMatch[1].replace(/^(services|service-immobilier)\//, '') : f.replace('.md', '');
      const newTitle = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/"/g, '');

      // Replace the broken title line
      let newFm = match[1].replace(/^title:\s*".*"/m, `title: "${newTitle}"`);

      // Remove any escaped quotes that break YAML
      newFm = newFm.replace(/\\"/g, '"');

      try {
        yaml.load(newFm);
        const newContent = '---\n' + newFm + '\n---' + content.slice(match[0].length);
        fs.writeFileSync(fp, newContent);
        fixed++;
      } catch (e2) {
        errors.push({ file: f, error: e2.message.substring(0, 100) });
      }
    }
  }
}

console.log('Fixed:', fixed, 'YAML errors');
if (errors.length) console.log('Remaining errors:', JSON.stringify(errors, null, 2));
