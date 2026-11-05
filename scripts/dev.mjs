import {spawn} from 'node:child_process';
const args=process.argv.slice(2),out=['dev'];
for(let i=0;i<args.length;i++){if(args[i]==='--strictPort')continue;out.push(args[i]==='--host'?'-H':args[i]);}
const child=spawn(process.execPath,['node_modules/next/dist/bin/next',...out],{stdio:'inherit'});
child.on('exit',code=>process.exit(code??1));
