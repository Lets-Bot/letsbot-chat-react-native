// Resolves `@letsbot/react-native-chat` to the SDK sources in the parent folder. The SDK's own node_modules are
// blocked so every dependency (react, react-native, react-native-webview, …) comes from this example only, exactly
// like in a real app.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sdkRoot = path.resolve(projectRoot, '..');
const config = getDefaultConfig(projectRoot);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

config.watchFolders = [sdkRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.blockList = [new RegExp(`^${escapeRegExp(path.join(sdkRoot, 'node_modules'))}\\/.*$`)];

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@letsbot/react-native-chat') {
    return { type: 'sourceFile', filePath: path.join(sdkRoot, 'src', 'index.ts') };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
