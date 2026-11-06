// Detect supported content from bytes, including Drive responses sent as octet-stream.
export async function previewType(blob){
 const b=new Uint8Array(await blob.slice(0,16).arrayBuffer()),s=String.fromCharCode(...b);
 if(s.startsWith('%PDF-'))return 'application/pdf';
 if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
 if([137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v))return 'image/png';
 if(/^GIF8[79]a/.test(s))return 'image/gif';
 if(s.startsWith('RIFF')&&s.slice(8,12)==='WEBP')return 'image/webp';
 return null;
}
