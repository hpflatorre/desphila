import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { storedZip, crc32 } from '../src/lib/zip.js';
test('ZIP CRC reference vector', () => assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926));
test('ZIP independently opens with Python zipfile; unicode paths and PDF bytes intact', async () => {
  const encoder = new TextEncoder();
  const zip = storedZip([{ path: 'turma/avaliação.pdf', bytes: encoder.encode('%PDF-1.4\nsynthetic') }, { path: 'notas.csv', bytes: encoder.encode('\uFEFF"ação";"0"\r\n') }]);
  const result = execFileSync('python3', ['-c', 'import sys,io,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; assert z.read("turma/avaliação.pdf")==b"%PDF-1.4\\nsynthetic"; assert z.read("notas.csv").startswith(b"\\xef\\xbb\\xbf"); print(len(z.namelist()))'], { input: Buffer.from(await zip.arrayBuffer()) });
  assert.equal(result.toString().trim(), '2');
});
test('ZIP rejects path traversal and duplicate entries', () => {
  const bytes = new Uint8Array();
  for (const path of ['../file', '/file', 'a/../file', 'a\\file', 'a//file']) assert.throws(() => storedZip([{ path, bytes }]));
  assert.throws(() => storedZip([{ path: 'file', bytes }, { path: 'file', bytes }]));
});
