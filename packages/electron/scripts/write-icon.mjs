import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <radialGradient id="body" cx="50%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#d97706"/>
      <stop offset="100%" stop-color="#7c2d12"/>
    </radialGradient>
    <linearGradient id="wing-l" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a78bfa" stop-opacity="0.55"/>
      <stop offset="50%" stop-color="#38bdf8" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#fbbf24" stop-opacity="0.15"/>
    </linearGradient>
    <linearGradient id="wing-r" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#a78bfa" stop-opacity="0.55"/>
      <stop offset="50%" stop-color="#38bdf8" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#fbbf24" stop-opacity="0.15"/>
    </linearGradient>
  </defs>

  <!-- transparent background -->

  <!-- Upper-left wing -->
  <polygon points="108,90 32,28 8,72 44,110 90,118" fill="url(#wing-l)" stroke="#7c3aed" stroke-width="1.5" stroke-linejoin="round" opacity="0.85"/>
  <line x1="108" y1="90" x2="32" y2="28" stroke="#c4b5fd" stroke-width="0.8" opacity="0.6"/>
  <line x1="108" y1="90" x2="20" y2="52" stroke="#c4b5fd" stroke-width="0.7" opacity="0.45"/>
  <line x1="108" y1="90" x2="28" y2="80" stroke="#c4b5fd" stroke-width="0.7" opacity="0.4"/>
  <line x1="96" y1="110" x2="44" y2="110" stroke="#c4b5fd" stroke-width="0.6" opacity="0.3"/>

  <!-- Upper-right wing -->
  <polygon points="148,90 224,28 248,72 212,110 166,118" fill="url(#wing-r)" stroke="#7c3aed" stroke-width="1.5" stroke-linejoin="round" opacity="0.85"/>
  <line x1="148" y1="90" x2="224" y2="28" stroke="#c4b5fd" stroke-width="0.8" opacity="0.6"/>
  <line x1="148" y1="90" x2="236" y2="52" stroke="#c4b5fd" stroke-width="0.7" opacity="0.45"/>
  <line x1="148" y1="90" x2="228" y2="80" stroke="#c4b5fd" stroke-width="0.7" opacity="0.4"/>
  <line x1="160" y1="110" x2="212" y2="110" stroke="#c4b5fd" stroke-width="0.6" opacity="0.3"/>

  <!-- Lower-left wing -->
  <polygon points="100,130 26,136 18,168 58,172 96,154" fill="url(#wing-l)" stroke="#6d28d9" stroke-width="1.2" opacity="0.65"/>
  <line x1="100" y1="130" x2="26" y2="136" stroke="#c4b5fd" stroke-width="0.6" opacity="0.4"/>
  <line x1="96" y1="148" x2="40" y2="158" stroke="#c4b5fd" stroke-width="0.55" opacity="0.3"/>

  <!-- Lower-right wing -->
  <polygon points="156,130 230,136 238,168 198,172 160,154" fill="url(#wing-r)" stroke="#6d28d9" stroke-width="1.2" opacity="0.65"/>
  <line x1="156" y1="130" x2="230" y2="136" stroke="#c4b5fd" stroke-width="0.6" opacity="0.4"/>
  <line x1="160" y1="148" x2="216" y2="158" stroke="#c4b5fd" stroke-width="0.55" opacity="0.3"/>

  <!-- Front legs -->
  <polyline points="100,102 74,82 52,68" fill="none" stroke="#b45309" stroke-width="3" stroke-linecap="square"/>
  <polygon points="50,66 44,76 56,74" fill="#f59e0b"/>
  <polyline points="156,102 182,82 204,68" fill="none" stroke="#b45309" stroke-width="3" stroke-linecap="square"/>
  <polygon points="206,66 212,76 200,74" fill="#f59e0b"/>

  <!-- Mid legs -->
  <polyline points="92,122 66,116 46,126" fill="none" stroke="#b45309" stroke-width="3" stroke-linecap="square"/>
  <polygon points="44,124 36,134 48,132" fill="#f59e0b"/>
  <polyline points="164,122 190,116 210,126" fill="none" stroke="#b45309" stroke-width="3" stroke-linecap="square"/>
  <polygon points="212,124 220,134 208,132" fill="#f59e0b"/>

  <!-- Rear legs -->
  <polyline points="100,148 76,162 58,178" fill="none" stroke="#b45309" stroke-width="3" stroke-linecap="square"/>
  <polygon points="56,176 50,188 62,184" fill="#f59e0b"/>
  <polyline points="156,148 180,162 198,178" fill="none" stroke="#b45309" stroke-width="3" stroke-linecap="square"/>
  <polygon points="200,176 206,188 194,184" fill="#f59e0b"/>

  <!-- Antennae -->
  <polyline points="114,60 90,36 72,20" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="square"/>
  <polygon points="72,13 78,20 72,27 66,20" fill="#f59e0b"/>
  <polyline points="142,60 166,36 184,20" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="square"/>
  <polygon points="184,13 190,20 184,27 178,20" fill="#f59e0b"/>

  <!-- Mandibles -->
  <polygon points="109,70 80,58 64,72 70,84 86,86 109,82" fill="#92400e" stroke="#f59e0b" stroke-width="1.5"/>
  <polygon points="64,72 54,64 70,84" fill="#fbbf24"/>
  <polygon points="147,70 176,58 192,72 186,84 170,86 147,82" fill="#92400e" stroke="#f59e0b" stroke-width="1.5"/>
  <polygon points="192,72 202,64 186,84" fill="#fbbf24"/>

  <!-- Head -->
  <polygon points="128,52 152,60 160,76 152,92 128,100 104,92 96,76 104,60" fill="url(#body)" stroke="#f59e0b" stroke-width="2"/>
  <polygon points="110,72 120,68 123,80 113,84" fill="#0a0a0f"/>
  <polygon points="111,73 120,70 122,79 113,82" fill="#dc2626" opacity="0.95"/>
  <polygon points="146,72 136,68 133,80 143,84" fill="#0a0a0f"/>
  <polygon points="145,73 136,70 134,79 143,82" fill="#dc2626" opacity="0.95"/>

  <!-- Thorax -->
  <polygon points="128,100 158,108 166,130 158,152 128,160 98,152 90,130 98,108" fill="url(#body)" stroke="#f59e0b" stroke-width="2"/>
  <polygon points="128,114 144,120 148,130 144,140 128,146 112,140 108,130 112,120" fill="none" stroke="#fbbf24" stroke-width="1" opacity="0.4"/>
  <circle cx="128" cy="130" r="3.5" fill="#fbbf24" opacity="0.55"/>

  <!-- Abdomen 1 -->
  <polygon points="128,160 152,166 160,180 152,196 128,202 104,196 96,180 104,166" fill="url(#body)" stroke="#f59e0b" stroke-width="2"/>
  <line x1="100" y1="180" x2="156" y2="180" stroke="#fbbf24" stroke-width="1" opacity="0.35"/>

  <!-- Abdomen 2 -->
  <polygon points="128,202 144,208 148,220 144,230 128,234 112,230 108,220 112,208" fill="url(#body)" stroke="#f59e0b" stroke-width="2"/>

  <!-- Stinger -->
  <polygon points="128,234 133,244 128,252 123,244" fill="#fbbf24"/>
</svg>`;

const frontendPath = join(__dirname, '..', '..', 'frontend', 'public', 'icon.svg');
const electronPath = join(__dirname, '..', 'assets', 'icon.svg');

writeFileSync(frontendPath, svg, 'utf8');
writeFileSync(electronPath, svg, 'utf8');
console.log('SVG files written successfully.');
