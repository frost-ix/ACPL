const fs = require('fs');
const path = require('path');

const platform = process.platform === 'win32' ? `win32-${process.arch}` : `${process.platform}-${process.arch}`;
const srcDir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds', platform);
const targetDir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'build', 'Release');

if (fs.existsSync(srcDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  const files = fs.readdirSync(srcDir);
  for (const file of files) {
    const srcFile = path.join(srcDir, file);
    const targetFile = path.join(targetDir, file);
    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, targetFile);
    } else if (fs.statSync(srcFile).isDirectory()) {
      fs.mkdirSync(targetFile, { recursive: true });
      const subFiles = fs.readdirSync(srcFile);
      for (const sf of subFiles) {
        fs.copyFileSync(path.join(srcFile, sf), path.join(targetFile, sf));
      }
    }
  }
  console.log(`Successfully prepared node-pty prebuilt binaries for ${platform}`);
} else {
  console.log(`Prebuilt directory not found: ${srcDir}`);
}
