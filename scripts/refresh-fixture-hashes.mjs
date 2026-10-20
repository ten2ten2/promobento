// Development-only fixture generation; never declares real render evidence.
import { writeFileSync } from 'node:fs';
import { load, digest, contentIdentity } from './contract-validation.mjs';
const save=(p,v)=>writeFileSync(new URL('../'+p,import.meta.url),JSON.stringify(v,null,2)+'\n');
const facts=load('contracts/fact-manifest.example.json'), c=load('contracts/composition.example.json');
c.factManifestHash=digest(facts); save('contracts/composition.example.json',c);
const r=load('contracts/release-snapshot.example.json');
r.compositionHash=digest(c);r.contentHash=digest(contentIdentity(c));r.factManifestHash=c.factManifestHash;r.variants=c.variants;
save('contracts/release-snapshot.example.json',r);
const e=load('contracts/export-manifest.example.json'); e.snapshotHash=digest(r); e.compositionHash=digest(c);save('contracts/export-manifest.example.json',e);
const p=load('tests/contracts/protocol-fixtures.json'); p.valid.render_init.manifestHash=digest(c);p.valid.render_ready.manifestHash=digest(c);save('tests/contracts/protocol-fixtures.json',p);
