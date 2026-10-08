// react-test-renderer still works with React 19 but logs a deprecation notice on every render.
const originalError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) {
    return;
  }
  originalError(...args);
};
