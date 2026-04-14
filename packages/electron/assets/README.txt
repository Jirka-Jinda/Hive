Place your app icons here before building:

  icon.ico   — Windows (256×256+ multi-size .ico)
  icon.icns  — macOS (.icns)
  icon.png   — Linux (512×512 PNG)

Tools to generate all three from a single PNG:
  https://www.npmjs.com/package/electron-icon-builder
  npx electron-icon-builder --input=icon-source.png --output=./

Without icons, electron-builder will use Electron's default icon.
