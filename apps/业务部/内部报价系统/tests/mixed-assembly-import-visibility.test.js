const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('department export preserves ordinary and mixed assembly imports on initial render and observer updates',()=>{
 const source=fs.readFileSync(require.resolve('../frontend/workbench.js'),'utf8');
 const start=source.indexOf('function installDepartmentExport(');
 const end=source.indexOf('// 按产品分组的人工表',start);
 let callback;
 const control=(mixed,textContent='')=>({textContent,removed:false,closest:()=>mixed?{}:null,remove(){this.removed=true;}});
 const upload=control(true),apply=control(true,'导入装工'),ordinaryUpload=control(false);
 const assemblyImport=control(false,'📄 导入排拉/装工表'),packagingImport=control(false,'📄 导入排拉/装工表');
 const host={querySelectorAll:selector=>selector==='button'?[apply,assemblyImport,packagingImport]:[upload,ordinaryUpload],querySelector:()=>({})};
 const ctx={DEPARTMENT_EXPORT_NAMES:{assembly:'装配部'},MutationObserver:class{constructor(fn){callback=fn;}observe(){}}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 ctx.installDepartmentExport(host,'assembly',12);
 callback();
 for(const control of [upload,apply,ordinaryUpload,assemblyImport,packagingImport]) assert.equal(control.removed,false);
});
