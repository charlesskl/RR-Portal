import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const template=readFileSync(new URL('../templates/index.html',import.meta.url),'utf8');
const script=template.match(/<script>([\s\S]*?)<\/script>/)[1].replace("{{ 'true' if local_mode else 'false' }}",'false');
function fixture(){
 const nodes=new Map();
 const element=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',style:{},classList:{add(){},remove(){}},addEventListener(){},scrollIntoView(){}});return nodes.get(id);};
 const context=vm.createContext({document:{getElementById:element,querySelectorAll:()=>[]},fetch:async()=>({json:async()=>({})}),setTimeout,clearTimeout,console});
 vm.runInContext(script,context);
 return {nodes,context,run:code=>vm.runInContext(code,context)};
}
const attack='<img src=x onerror="globalThis.injected=true">';
test('item result renders arbitrary added, changed and duplicate codes as text',()=>{
 const f=fixture();f.context.attack=attack;
 f.run('showItemUpdateResult({added:[attack],changed:[attack],dupes:[attack],total:3})');
 const html=f.nodes.get('itemResultPanel').innerHTML;
 assert.equal((html.match(/&lt;img/g)||[]).length,3);assert(!html.includes('<img'));
 assert.equal(f.run('escapeHtml(0)'), '0');assert.equal(f.run('escapeHtml(null)'), '');
});
test('processing results escape PO, customer, file and parse error text plus download arguments',()=>{
 const f=fixture();f.context.attack=attack;
 f.run('showResult({details:[attack],revisions:[attack],warnings:[attack],parse_errors:[attack],written:1,filename:attack+".xlsx"})');
 const html=f.nodes.get('resultPanel').innerHTML;
 assert.equal((html.match(/&lt;img/g)||[]).length,5);assert(!html.includes('<img'));
 assert(html.includes('onclick="dlFile(&quot;'));assert.equal(f.context.injected,undefined);
});
test('classification and duplicate PO lists escape spreadsheet and filename fields',()=>{
 const f=fixture();f.context.attack=attack;
 f.run('selectedFiles=[{name:attack+".xlsx"}];fileClassification={[attack+".xlsx"]:{po:attack,is_revision:false,missing_items:[attack]}};duplicatePos={[attack]:[attack+".xlsx",attack]};renderFileList()');
 const html=f.nodes.get('fileList').innerHTML;
 assert.equal((html.match(/&lt;img/g)||[]).length,4);assert(!html.includes('<img'));
});
