/** @type {import('next').NextConfig} */
const config={
 serverExternalPackages:['pdfjs-dist','nodemailer'],
 outputFileTracingIncludes:{'/api/admin/client-invitations':['./node_modules/nodemailer/**/*'],'/api/invoice-intake/*/read':['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs']}
};
export default config;
