// Metro config for Reseller HQ.
// expo-sqlite on web loads wa-sqlite as a .wasm module, and Metro does not
// resolve .wasm files by default — without this, `npx expo export --platform
// web` fails with "Unable to resolve ./wa-sqlite/wa-sqlite.wasm".
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

// expo-image-editor imports modal-enhanced-react-native-web unconditionally
// (via UniversalModal), but only renders it on web — on iOS/Android it
// uses React Native's Modal. The real web modal is a webpack bundle that
// crashes at load time on native (it expects a DOM), which breaks the whole
// item screen ("missing the required default export"). Resolve it to a
// no-op stub on native platforms; web keeps the real module.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'modal-enhanced-react-native-web' && platform !== 'web') {
    return {
      filePath: path.resolve(__dirname, 'src/lib/web-modal-stub.js'),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
