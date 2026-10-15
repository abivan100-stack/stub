import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.abivan.stub',
  appName: 'Stub',
  webDir: 'dist',
  // Pairing through another phone talks to it over plain http/ws on the local network
  // (StubHostServer.java), from this app's https://localhost page.
  android: { allowMixedContent: true },
  server: { cleartext: true },
}

export default config
