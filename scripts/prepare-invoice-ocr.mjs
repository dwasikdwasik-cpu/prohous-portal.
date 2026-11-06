import {mkdir,copyFile,readdir,cp} from 'node:fs/promises';
const target=new URL('../public/ocr/',import.meta.url);
await mkdir(new URL('core/',target),{recursive:true});await mkdir(new URL('lang/',target),{recursive:true});
await copyFile(new URL('../node_modules/tesseract.js/dist/worker.min.js',import.meta.url),new URL('worker.min.js',target));
await copyFile(new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url),new URL('pdf.worker.min.mjs',target));
await copyFile(new URL('../node_modules/@tesseract.js-data/pol/4.0.0/pol.traineddata.gz',import.meta.url),new URL('lang/pol.traineddata.gz',target));
const core=new URL('../node_modules/tesseract.js-core/',import.meta.url);
for(const name of await readdir(core))if(/\.wasm(?:\.js)?$/.test(name))await copyFile(new URL(name,core),new URL('core/'+name,target));
console.log('Prepared local PDF/OCR assets.');

await cp(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url),new URL('standard_fonts/',target),{recursive:true});
await cp(new URL('../node_modules/pdfjs-dist/cmaps/',import.meta.url),new URL('cmaps/',target),{recursive:true});
