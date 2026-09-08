/**
 * Seeds the origin's asset directory with a handful of static files so
 * there's something realistic to cache: JSON API-style payloads, a CSS
 * file, a JS bundle stub, and a couple of small SVG "images". Re-run any
 * time with `npm run seed --workspace=origin`.
 */
import fs from 'fs';
import path from 'path';

const ASSETS_DIR = path.join(__dirname, '..', 'data', 'assets');

function write(relPath: string, content: string) {
  const full = path.join(ASSETS_DIR, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  console.log(`seeded ${relPath} (${content.length} bytes)`);
}

function svgPlaceholder(label: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">
  <rect width="100%" height="100%" fill="${color}"/>
  <text x="50%" y="50%" font-family="sans-serif" font-size="20" fill="white" text-anchor="middle" dominant-baseline="middle">${label}</text>
</svg>`;
}

write('hero-banner.svg', svgPlaceholder('hero-banner', '#4f46e5'));
write('logo.svg', svgPlaceholder('logo', '#0ea5e9'));
write('thumbnail-1.svg', svgPlaceholder('thumb-1', '#16a34a'));
write('thumbnail-2.svg', svgPlaceholder('thumb-2', '#ea580c'));

write(
  'styles/main.css',
  `body { font-family: system-ui, sans-serif; margin: 0; background: #0b0f19; color: #e6e8ee; }
.card { border-radius: 12px; padding: 16px; background: #131a2b; }
`,
);

write(
  'scripts/app.js',
  `console.log("MiniCDN demo bundle loaded at " + new Date().toISOString());
`,
);

write(
  'api/config.json',
  JSON.stringify(
    {
      appName: 'MiniCDN Demo',
      featureFlags: { newCheckout: true, darkMode: true },
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

write(
  'api/products.json',
  JSON.stringify(
    {
      products: Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        name: `Widget #${i + 1}`,
        price: Number((5 + i * 1.25).toFixed(2)),
      })),
    },
    null,
    2,
  ),
);

write('robots.txt', 'User-agent: *\nAllow: /\n');

console.log('\nSeed complete. Assets live under origin/data/assets/');
