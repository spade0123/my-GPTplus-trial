import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {saveCapture} from '../../src/browser-review.js';
import {ensureWorker} from '../../src/review-queue.js';
const saved=await saveCapture(JSON.parse(await fs.readFile(process.argv[2],'utf8')));
await ensureWorker({workerFile:fileURLToPath(new URL('./queue-worker.js',import.meta.url))});
console.log(saved.id);
