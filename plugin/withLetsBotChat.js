'use strict';

/**
 * Expo config plugin for @letsbot/react-native-chat.
 *
 * - iOS: adds NSCameraUsageDescription, NSPhotoLibraryUsageDescription and NSMicrophoneUsageDescription (attachments
 *   and voice notes in the chat). Existing values in the app config are kept; plugin options override the defaults.
 * - Android: adds RECORD_AUDIO and MODIFY_AUDIO_SETTINGS (voice notes in the WebView).
 *
 * Usage (app.json): "plugins": ["@letsbot/react-native-chat"] or
 * ["@letsbot/react-native-chat", { "microphonePermission": "…", "microphone": true }]
 */

const pkg = require('../package.json');

const DEFAULT_IOS_PERMISSIONS = {
  NSCameraUsageDescription: 'Allow $(PRODUCT_NAME) to use the camera to send photos in support chat.',
  NSPhotoLibraryUsageDescription:
    'Allow $(PRODUCT_NAME) to access your photos to send them in support chat.',
  NSMicrophoneUsageDescription:
    'Allow $(PRODUCT_NAME) to use the microphone to record voice messages in support chat.',
};

const ANDROID_MICROPHONE_PERMISSIONS = [
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
];

/**
 * Applies the iOS usage descriptions to an Info.plist object.
 * Precedence: plugin option > value already in the app config > SDK default. `false` skips a key.
 */
function applyIosPermissions(infoPlist, options) {
  const opts = options || {};
  const result = Object.assign({}, infoPlist);
  const map = {
    NSCameraUsageDescription: opts.cameraPermission,
    NSPhotoLibraryUsageDescription: opts.photosPermission,
    NSMicrophoneUsageDescription: opts.microphone === false ? false : opts.microphonePermission,
  };
  Object.keys(map).forEach((key) => {
    const option = map[key];
    if (option === false) {
      return;
    }
    if (typeof option === 'string' && option.length > 0) {
      result[key] = option;
    } else if (!result[key]) {
      result[key] = DEFAULT_IOS_PERMISSIONS[key];
    }
  });
  return result;
}

/** Adds the Android permissions to an AndroidManifest object (as parsed by @expo/config-plugins). */
function applyAndroidPermissions(androidManifest, options) {
  const opts = options || {};
  if (opts.microphone === false) {
    return androidManifest;
  }
  const manifest = androidManifest.manifest;
  if (!Array.isArray(manifest['uses-permission'])) {
    manifest['uses-permission'] = [];
  }
  const existing = new Set(
    manifest['uses-permission'].map((item) => item && item.$ && item.$['android:name'])
  );
  ANDROID_MICROPHONE_PERMISSIONS.forEach((name) => {
    if (!existing.has(name)) {
      manifest['uses-permission'].push({ $: { 'android:name': name } });
    }
  });
  return androidManifest;
}

function loadConfigPlugins() {
  try {
    return require('expo/config-plugins');
  } catch {
    return require('@expo/config-plugins');
  }
}

function withLetsBotChat(config, options) {
  const plugins = loadConfigPlugins();
  let next = plugins.withInfoPlist(config, (mod) => {
    mod.modResults = applyIosPermissions(mod.modResults, options);
    return mod;
  });
  next = plugins.withAndroidManifest(next, (mod) => {
    mod.modResults = applyAndroidPermissions(mod.modResults, options);
    return mod;
  });
  return next;
}

function createPlugin() {
  try {
    const plugins = loadConfigPlugins();
    return plugins.createRunOncePlugin(withLetsBotChat, pkg.name, pkg.version);
  } catch {
    return withLetsBotChat;
  }
}

module.exports = createPlugin();
module.exports.withLetsBotChat = withLetsBotChat;
module.exports.applyIosPermissions = applyIosPermissions;
module.exports.applyAndroidPermissions = applyAndroidPermissions;
module.exports.DEFAULT_IOS_PERMISSIONS = DEFAULT_IOS_PERMISSIONS;
module.exports.ANDROID_MICROPHONE_PERMISSIONS = ANDROID_MICROPHONE_PERMISSIONS;
