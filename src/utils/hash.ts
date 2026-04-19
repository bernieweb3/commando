import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

// Compute SHA256 of a file by streaming it. We avoid reading the whole file
// into memory because some Sui binaries (e.g. sui-debug.exe ~395 MB) are large.
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
