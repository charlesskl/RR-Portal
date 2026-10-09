import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateConfig} from '../collector/config.mjs';
const valid=()=>({mode:'live',cloudUrl:'https://platform.test',token:'a'.repeat(64),consolePort:3103,bindingsFile:'/tmp/test-bindings.json',bambuPrinters:[{id:1,name:'test',host:'192.168.1.2',serial:'serial-test',accessCode:'private-test'}]});
test('collector validation blocks malformed setup before loading real drivers and never prints secrets',()=>{
 assert.deepEqual(validateConfig(valid()),[]);
 const duplicate=valid();duplicate.flashForgePrinters=[{id:1,name:'test2',host:'192.168.1.3',serial:'test',checkCode:'sensitive'}];assert.match(validateConfig(duplicate).join(),/重复/);
 for(const url of ['http://remote.test','ftp://localhost','https://user:password@remote.test','https://remote.test/subpath'])assert.ok(validateConfig({...valid(),cloudUrl:url}).length);
 assert.ok(validateConfig({...valid(),token:'REPLACE_WITH_STATION_TOKEN'}).length);
 assert.ok(validateConfig({...valid(),bambuPrinters:[]}).length);
 assert.ok(validateConfig({...valid(),bindingsFile:'relative.json'}).length);
 const invalid=valid();invalid.bambuPrinters[0].host='https://private-host/';assert.ok(!validateConfig(invalid).join().includes('private-host'));
 assert.deepEqual(validateConfig({mode:'simulation',cloudUrl:'http://127.0.0.1:3100',token:'b'.repeat(64)}),[]);
});

test('remote HTTP requires an explicit boolean opt-in; other protocols remain rejected',()=>{
 const config={...valid(),cloudUrl:'http://8.148.146.194:3100'};
 assert.ok(validateConfig(config).length);
 assert.ok(validateConfig({...config,allowInsecureHttp:'true'}).length);
 assert.deepEqual(validateConfig({...config,allowInsecureHttp:true}),[]);
 assert.ok(validateConfig({...config,allowInsecureHttp:true,cloudUrl:'ftp://remote.test'}).length);
});
