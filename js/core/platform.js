// Platform checks with no imports, so the app shell can use them without loading the player.
// js/player/engine.js and native.js keep their own copies (their tests run them with imports stripped): keep in sync.
const ua = navigator.userAgent;
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|Android/.test(ua);
/** The Streamora iOS app's native player plugin, when running inside it. */
export const nativePlayerPlugin = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StreamoraPlayer) || null;
/** True inside the iOS app with the native player plugin available. */
export const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && nativePlayerPlugin());
