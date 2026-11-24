import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.readit.reader',
  appName: 'Read IT',
  webDir: 'dist',
  plugins: {
    // Keep WebView CORS and streaming enabled for articles and model downloads.
    CapacitorHttp: { enabled: false },
  },
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
