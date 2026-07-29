import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lostboard.triad',
  appName: 'LostBoard',
  // Vite builds the web app into dist/; Capacitor bundles that into the APK.
  webDir: 'dist',
  backgroundColor: '#050505',
  android: {
    // Match the app's near-black CRT background so there is no white flash on launch.
    backgroundColor: '#050505',
    // Keep the WebView inspectable via chrome://inspect for debug builds only.
    webContentsDebuggingEnabled: true,
  },
};

export default config;
