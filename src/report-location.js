import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './core.js';
export async function reportDirectory(){
 try{const value=JSON.parse(await fs.readFile(path.join(ROOT,'native/report-location.json'),'utf8'));if(typeof value.reportRoot==='string'&&path.isAbsolute(value.reportRoot))return path.resolve(value.reportRoot);}catch{}
 return path.join(ROOT,'reports');
}
