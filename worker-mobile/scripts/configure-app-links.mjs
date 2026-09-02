import fs from 'node:fs';
import path from 'node:path';

const platform = process.argv[2];
const baseUrl = String(process.env.WORKER_APP_WEB_URL || '').trim();
if (!['android', 'ios'].includes(platform) || !/^https:\/\/[^/]+/i.test(baseUrl)) {
  throw new Error('Usage: WORKER_APP_WEB_URL=https://domain npm run links:android|links:ios');
}
const domain = new URL(baseUrl).hostname;

function edit(file, change) {
  if (!fs.existsSync(file)) throw new Error(`Missing native project file: ${file}. Run npx cap add ${platform} first.`);
  const before = fs.readFileSync(file, 'utf8');
  const after = change(before);
  if (after === before) return console.log(`Already configured: ${file}`);
  fs.writeFileSync(file, after, 'utf8');
  console.log(`Configured: ${file}`);
}

if (platform === 'android') {
  const manifest = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
  const marker = 'data-auto-verified-worker-qr="true"';
  const intentFilter = `
            <intent-filter ${marker} android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="${domain}" android:path="/customer-scan.html" />
            </intent-filter>`;
  edit(manifest, source => source.includes(marker)
    ? source
    : source.replace('</activity>', `${intentFilter}\n        </activity>`));
}

if (platform === 'ios') {
  const entitlements = path.join('ios', 'App', 'App', 'App.entitlements');
  const marker = `<string>applinks:${domain}</string>`;
  const capability = `\n\t<key>com.apple.developer.associated-domains</key>\n\t<array>\n\t\t${marker}\n\t</array>`;
  edit(entitlements, source => source.includes(marker)
    ? source
    : source.replace('</dict>', `${capability}\n</dict>`));
}
