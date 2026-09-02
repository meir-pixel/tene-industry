import type { CapacitorConfig } from '@capacitor/cli';

const workerAppUrl = String(process.env.WORKER_APP_WEB_URL || '').trim().replace(/\/+$/, '');
if (!/^https:\/\/[^/]+/i.test(workerAppUrl)) {
  throw new Error('WORKER_APP_WEB_URL must be the public HTTPS address of the IronBend cloud system.');
}

const host = new URL(workerAppUrl).host;
const config: CapacitorConfig = {
  appId: String(process.env.WORKER_APP_ID || 'il.co.tene.work'),
  appName: 'טנא עובדים',
  webDir: 'www',
  // The current worker product is the authenticated cloud scanner. Keeping it
  // on the same HTTPS origin preserves the server session and device header.
  server: { url: `${workerAppUrl}/scan.html`, cleartext: false, allowNavigation: [host] },
};

export default config;
