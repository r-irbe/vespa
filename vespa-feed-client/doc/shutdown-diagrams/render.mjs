import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const dir=path.dirname(fileURLToPath(import.meta.url));
const cases=JSON.parse(await fs.readFile(path.join(dir,'cases.json'),'utf8'));
assert.ok(cases.length>0);
assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);
for(const c of cases){
  for(const key of ['id','title','status','issue','change','code','evidence','language']) assert.ok(c[key]);
  assert.match(c.id,/^[A-Z][0-9]{2}$/);
  assert.equal(c.before.length,3); assert.equal(c.after.length,3);
  assert.ok(!/\b(lean|proofs?)\b/i.test(JSON.stringify(c)));
}
await fs.mkdir(path.join(dir,'images'),{recursive:true});
const browser=await chromium.launch({headless:true});
const manifest={p5:'1.11.11',browser:browser.version(),width:960,images:[]};
try {
 const page=await browser.newPage({viewport:{width:960,height:400},deviceScaleFactor:1});
 await page.setContent('<html><body style="margin:0"></body></html>');
 await page.addScriptTag({path:path.join(dir,'node_modules/p5/lib/p5.min.js')});
 for(const c of cases){
  const rendered=await page.evaluate(async c=>{
   if(window.diagram) window.diagram.remove();
   return await new Promise((resolve,reject)=>{
    window.diagram=new p5(p=>{
     p.setup=()=>{try{
      p.createCanvas(960,400);p.pixelDensity(1);p.noLoop();p.textFont('sans-serif');
      const lines=(s,size,width)=>{
       p.textSize(size);let out=[],line='';
       for(const word of s.split(' ')){
        if(p.textWidth(word)>width) throw new Error(c.id+': word exceeds box: '+word);
        const next=line?line+' '+word:word;
        if(p.textWidth(next)>width&&line){out.push(line);line=word;}else line=next;
       }out.push(line);return out;
      };
      const title=lines(c.id+'  '+c.title,22,928);
      const status=lines(c.status,16,928);
      const before=c.before.map(s=>lines(s,18,240));
      const after=c.after.map(s=>lines(s,18,240));
      if(title.length>2||status.length>1||[...before,...after].some(a=>a.length>3))throw new Error(c.id+': too many lines');
      const top=16+title.length*27+status.length*20+12;
      const heights=[before,after].map(row=>Math.max(...row.map(a=>a.length))*22+20);
      const height=top+heights[0]+heights[1]+10+16;
      if(height>300)throw new Error(c.id+': unexpectedly tall diagram');
      p.resizeCanvas(960,height);p.background('#f4f6fa');
      const text=(ls,x,y,size,color)=>{p.noStroke();p.fill(color);p.textSize(size);p.textAlign(p.LEFT,p.TOP);ls.forEach((s,i)=>p.text(s,x,y+i*(size===22?27:size===18?22:20)));};
      text(title,16,12,22,'#14243b');text(status,16,12+title.length*27,16,'#40516b');
      const lane=(label,row,y,h,color)=>{
       text([label],16,y+(h-20)/2,16,color);
       row.forEach((ls,i)=>{
        const x=104+i*282;p.fill('#fff');p.stroke(color);p.strokeWeight(1.5);p.rect(x,y,264,h,6);
        text(ls,x+12,y+(h-ls.length*22)/2,18,'#14243b');
        if(i<2){const ax=x+268,ay=y+h/2;p.stroke(color);p.line(ax,ay,ax+10,ay);p.line(ax+6,ay-4,ax+10,ay);p.line(ax+6,ay+4,ax+10,ay);}
       });
      };
      lane('Risk',before,top,heights[0],'#a33636');
      lane('Change',after,top+heights[0]+10,heights[1],'#236579');
      resolve({data:p.canvas.toDataURL('image/png'),height});
     }catch(e){reject(e);}};
    });
   });
  },c);
  const bytes=Buffer.from(rendered.data.split(',')[1],'base64');
  assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),960);assert.equal(bytes.readUInt32BE(20),rendered.height);assert.ok(bytes.length>5000);
  await fs.writeFile(path.join(dir,'images',c.id+'.png'),bytes);
  manifest.images.push({id:c.id,height:rendered.height,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
}finally{await browser.close();}
let md=await fs.readFile(path.join(dir,'intro.md'),'utf8');
md+='\n| Case | Failure mode | Status |\n| --- | --- | --- |\n';
for(const c of cases)md+=`| [${c.id}](#${c.id.toLowerCase()}) | ${c.title} | ${c.status} |\n`;
for(const c of cases)md+=`\n<a id="${c.id.toLowerCase()}"></a>\n\n## ${c.id}: ${c.title}\n\n${c.issue}\n\n${c.change}\n\n\`\`\`${c.language}\n${c.code}\n\`\`\`\n\n![${c.title}: ${c.before.join(' → ')}; ${c.after.join(' → ')}](${path.basename(dir)}/images/${c.id}.png)\n\nEvidence: ${c.evidence}\n`;
try{md+=await fs.readFile(path.join(dir,'outro.md'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
assert.ok(!/\b(lean|proofs?)\b/i.test(md));
// Check local document targets as well as the images, so moves cannot silently break links.
for(const match of md.matchAll(/\]\(([^)]+)\)/g)){
 const target=match[1].split('#')[0];
 if(target&&!/^https?:/.test(target))await fs.access(path.resolve(dir,'..',target));
}
await fs.writeFile(path.join(dir,'../shutdown.md'),md);
await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const pngs=(await fs.readdir(path.join(dir,'images'))).filter(f=>f.endsWith('.png')).sort();
assert.deepEqual(pngs,cases.map(c=>c.id+'.png').sort());
console.log(`Rendered and validated ${cases.length} compact PNGs, guide links and text fit.`);
