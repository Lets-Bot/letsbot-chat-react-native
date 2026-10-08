/* eslint-disable @typescript-eslint/no-require-imports */
const plugin = require('../app.plugin.js');

describe('Expo config plugin', () => {
  it('adds iOS usage descriptions without overriding app values', () => {
    const result = plugin.applyIosPermissions({ NSCameraUsageDescription: 'Custom camera text' }, {});
    expect(result.NSCameraUsageDescription).toBe('Custom camera text');
    expect(result.NSPhotoLibraryUsageDescription).toBe(plugin.DEFAULT_IOS_PERMISSIONS.NSPhotoLibraryUsageDescription);
    expect(result.NSMicrophoneUsageDescription).toBe(plugin.DEFAULT_IOS_PERMISSIONS.NSMicrophoneUsageDescription);
    expect(result.NSUserTrackingUsageDescription).toBeUndefined();
  });

  it('lets plugin options override and disable keys', () => {
    const result = plugin.applyIosPermissions(
      { NSCameraUsageDescription: 'Old' },
      { cameraPermission: 'New camera', microphone: false }
    );
    expect(result.NSCameraUsageDescription).toBe('New camera');
    expect(result.NSMicrophoneUsageDescription).toBeUndefined();
  });

  it('adds Android microphone permissions once', () => {
    const manifest = {
      manifest: { 'uses-permission': [{ $: { 'android:name': 'android.permission.RECORD_AUDIO' } }] },
    };
    plugin.applyAndroidPermissions(manifest, {});
    plugin.applyAndroidPermissions(manifest, {});
    const names = manifest.manifest['uses-permission'].map((p: { $: Record<string, string> }) => p.$['android:name']);
    expect(names).toEqual(['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS']);
    const untouched = { manifest: {} as Record<string, unknown> };
    plugin.applyAndroidPermissions(untouched, { microphone: false });
    expect(untouched.manifest['uses-permission']).toBeUndefined();
  });

  it('registers infoPlist and AndroidManifest mods (run once)', () => {
    const config = plugin({ name: 'Example', slug: 'example' }, { microphonePermission: 'Voice notes' });
    expect(typeof config.mods.ios.infoPlist).toBe('function');
    expect(typeof config.mods.android.manifest).toBe('function');
    expect(config._internal.pluginHistory['@letsbot/react-native-chat']).toMatchObject({ version: '0.1.0' });
  });
});
