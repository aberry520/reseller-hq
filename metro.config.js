// Metro config for Reseller HQ.
// expo-sqlite on web loads wa-sqlite as a .wasm module, and Metro does not
// resolve .wasm files by default — without this, `npx expo export --platform
// web` fails with "Unable to resolve ./wa-sqlite/wa-sqlite.wasm".
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

module.exports = config;
