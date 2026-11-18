// Rebuild model/witkowo.glb from model/src.glb: weld (index) the flat triangle soup, then meshopt-compress.
//   node tools/optimize_glb.cjs [src] [dst]
// Node names, materials and the node tree are untouched. Weld only merges vertices whose position AND normal are
// bit-identical (corners shared by triangles of the same flat face), so the shading is unchanged; the GPU then
// shades each shared corner once (indexed draw + vertex cache) instead of once per triangle.
// The FarmDroid wheel parts stay non-indexed: lib/growth.js splits them per wheel by triangle (needs a soup).
// Drip irrigation stays non-indexed too: lib/water.js averages its vertices to place the 640 emitters, and a
// welded vertex set moves one emitter to the other side of its line (1200 vertices, nothing to gain).
// Needs @gltf-transform (core/extensions/functions 4.x) + meshoptimizer, e.g. from an `npx @gltf-transform/cli` cache.
const path = require('path');
const { execSync } = require('child_process');
const base = process.env.GLTF_NODE_MODULES || path.resolve(execSync('ls -d ~/.npm/_npx/*/node_modules/@gltf-transform/cli | head -1', { shell: '/bin/zsh' }).toString().trim(), '../..');
const req = (m) => require(path.join(base, m));
const { NodeIO } = req('@gltf-transform/core');
const { ALL_EXTENSIONS } = req('@gltf-transform/extensions');
const { weldPrimitive, meshopt } = req('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder } = req('meshoptimizer');

const root = path.resolve(__dirname, '..');
const SRC = path.resolve(process.argv[2] || path.join(root, 'model/src.glb'));
const DST = path.resolve(process.argv[3] || path.join(root, 'model/witkowo.glb'));
const KEEP_SOUP = new Set(['FarmDroid / tires', 'FarmDroid / wheel rims', 'FarmDroid / tire lugs', 'Drip irrigation']);

(async () => {
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(SRC);
  let before = 0, after = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      const n0 = prim.getAttribute('POSITION').getCount(); before += n0;
      if (!KEEP_SOUP.has(node.getName())) weldPrimitive(prim);
      after += prim.getAttribute('POSITION').getCount();
    }
  }
  console.log(`weld: ${before} -> ${after} vertices`);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(DST, doc);
  console.log('wrote', DST, require('fs').statSync(DST).size, 'bytes');
})().catch((e) => { console.error(e); process.exit(1); });
