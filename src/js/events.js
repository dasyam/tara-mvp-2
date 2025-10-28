// Simple unified event emitter for GA4 + Clarity
export function emitEvent(name, params = {}) {
  try {
    if (typeof window !== 'undefined') {
      if (window.gtag) {
        window.gtag('event', name, params);
      }
      if (window.clarity) {
        // Send a single blob param to keep Clarity clean
        window.clarity('track', name, params);
      }
    }
  } catch (_e) {
    // no-op
  }
}
