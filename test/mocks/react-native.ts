/**
 * Minimal `react-native` stand-in for unit tests of the core (no native runtime needed).
 */
type Listener<T> = (value: T) => void;

const appStateListeners = new Set<Listener<string>>();
const appearanceListeners = new Set<Listener<{ colorScheme: string | null }>>();

export const Platform = {
  OS: 'ios' as 'ios' | 'android',
  Version: '18.0' as string | number,
  select<T>(spec: { ios?: T; android?: T; default?: T }): T | undefined {
    return spec[Platform.OS] ?? spec.default;
  },
};

export const AppState = {
  currentState: 'active',
  addEventListener(_type: 'change', listener: Listener<string>) {
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  },
};

export const Appearance = {
  colorScheme: 'light' as string | null,
  getColorScheme() {
    return Appearance.colorScheme;
  },
  addChangeListener(listener: Listener<{ colorScheme: string | null }>) {
    appearanceListeners.add(listener);
    return { remove: () => appearanceListeners.delete(listener) };
  },
};

export const Linking = {
  openURL: jest.fn(async (_url: string) => true),
};

export const StyleSheet = {
  create<T>(styles: T): T {
    return styles;
  },
  absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
};

// Host components render as plain element types under react-test-renderer.
export const View = 'View';
export const Text = 'Text';
export const Pressable = 'Pressable';
export const ActivityIndicator = 'ActivityIndicator';
export const Modal = 'Modal';
export const useColorScheme = () => Appearance.colorScheme;

/** Test helpers. */
export const __mock = {
  setAppState(state: string) {
    AppState.currentState = state;
    appStateListeners.forEach((listener) => listener(state));
  },
  setColorScheme(colorScheme: string | null) {
    Appearance.colorScheme = colorScheme;
    appearanceListeners.forEach((listener) => listener({ colorScheme }));
  },
  listenerCount() {
    return { appState: appStateListeners.size, appearance: appearanceListeners.size };
  },
};
