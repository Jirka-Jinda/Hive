/**
 * Generates assets/icon.ico from assets/icon.svg using sharp + png-to-ico.
 * Run: node scripts/gen-icon.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(__dirname, '..', 'assets');
const svgPath = join(assetsDir, 'icon.svg');
const icoPath = join(assetsDir, 'icon.ico');

const sizes = [16, 24, 32, 48, 64, 128, 256];

console.log('Rendering SVG at sizes:', sizes.join(', '));
const svgBuffer = readFileSync(svgPath);

const pngBuffers = await Promise.all(
    sizes.map((size) =>
        sharp(svgBuffer, { density: Math.ceil((size / 256) * 96 * 2.667) })
            .resize(size, size)
            .ensureAlpha()
            .png()
            .toBuffer()
    )
);

const ico = await pngToIco(pngBuffers);
writeFileSync(icoPath, ico);
console.log(`Written ${icoPath} (${ico.length} bytes)`);
