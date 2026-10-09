import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import createDataImages from '../production/data-images.cjs';
test('image projection deduplicates, preserves full backups and rejects unknown references',()=>{
 const db=new DatabaseSync(':memory:');try{
  const images=createDataImages(db),uri='data:image/png;base64,aGVsbG8=';
  const full={products:[{id:1,image:uri},{id:2,image:uri}],records:{}};
  const compact=images.compact(full);assert.equal(full.products[0].image,uri);assert.equal(compact.products[0].image,compact.products[1].image);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM data_images').get().n,1);
  assert.deepEqual(images.restore(compact),full);
  assert.equal(images.image(compact.products[0].image.split('/').at(-1)).body.toString(),'hello');
  assert.equal(images.image('../snapshot'),null);
  assert.throws(()=>images.restore({image:'/api/production/data-images/missing'}),/引用已失效/);
  compact.products[0].image='';assert.equal(images.restore(compact).products[0].image,'','explicit image deletion remains supported');
 }finally{db.close();}
});
