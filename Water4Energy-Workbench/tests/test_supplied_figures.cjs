const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'public/assets/dali-figures-provenance.json'),'utf8'));
test('all five supplied figures match their pinned source hashes, PNG dimensions and permitted static paths',()=>{
  assert.equal(manifest.source_commit,'d0199a817ddbfa0fbf65c9e81d9fcc53081611ee');
  assert.equal(manifest.files.length,5);
  for(const f of manifest.files){
    assert.match(f.filename,/^[a-z0-9_]+\.png$/);
    const bytes=fs.readFileSync(path.join(root,'public/assets',f.filename));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),f.sha256);
    assert.equal(bytes.subarray(1,4).toString(),'PNG');
    assert.equal(bytes.readUInt32BE(16),f.width);assert.equal(bytes.readUInt32BE(20),f.height);
    assert.equal(f.path,'/assets/'+f.filename);
    assert.equal(f.source_path,'Water4Energy-Workbench/public/assets/'+f.filename);
    assert.equal(f.source_url,'https://github.com/daliwang/water4energy_SC26Demo/blob/'+manifest.source_commit+'/'+f.source_path);
  }
});
test('monthly precipitation and CNN maps retain their distinct units, scope and interpretation',()=>{
  const rain=manifest.files.find(f=>f.filename==='april_2019_prcp_refine.png');
  assert.equal(rain.scope,'april_2019_month_30_days');assert.match(rain.units,/mm\/day/);
  assert.match(rain.interpretation_note,/Not weekly totals/);
  assert.match(rain.interpretation_note,/no coupled-pipeline claim/);
  const cnn=manifest.files.find(f=>f.filename==='valley_temperature_2019.png');
  assert.match(cnn.interpretation_note,/1×1 CNN, 3×3 CNN, 9×9 CNN/);
  assert.match(cnn.interpretation_note,/not the Reslim comparison/);
});
