// Electron Builder Configuration for Universal (x64 + ARM64) macOS ZIP update package
const fs = require('node:fs');
const universalConfig = require('./electron-builder-universal.js');

module.exports = {
  ...universalConfig,
  mac: {
    ...universalConfig.mac,
    target: [
      {
        target: 'zip',
        arch: ['universal']
      }
    ],
  },
  afterAllArtifactBuild: async (buildResult) => {
    for (const artifactPath of buildResult.artifactPaths) {
      if (artifactPath.endsWith('.dmg') || artifactPath.endsWith('.dmg.blockmap')) {
        fs.rmSync(artifactPath, { force: true });
      }
    }
  },
};
