/** @type {import('next').NextConfig} */
const config={
 serverExternalPackages:['pdfjs-dist'],
 outputFileTracingIncludes:{'/api/invoice-intake/*/read':['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs']}
};
export default config;
