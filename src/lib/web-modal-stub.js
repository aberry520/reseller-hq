// Stub for modal-enhanced-react-native-web on native platforms.
// expo-image-editor imports it unconditionally (via UniversalModal), but
// only renders it on web — on iOS/Android it uses React Native's Modal.
// The real web modal is a webpack bundle that crashes at load time on
// native (it expects a DOM), so Metro resolves it to this no-op instead.
// See metro.config.js. Never rendered on native.
module.exports = function WebModalStub() {
  return null;
};
module.exports.default = module.exports;
