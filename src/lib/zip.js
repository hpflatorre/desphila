// Small ZIP (stored, UTF-8) writer. No dependency, compression service or data upload.
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function storedZip(files) {
  if (files.length > 65535) throw new Error('Quantidade de arquivos excede o limite ZIP');
  const chunks = [], central = [], seen = new Set(); let offset = 0, directorySize = 0;
  for (const { path, bytes } of files) {
    if (seen.has(path) || path.startsWith('/') || path.includes('\\') || path.split('/').some(p => p === '..' || !p)) throw new Error('Caminho ZIP inválido ou duplicado');
    seen.add(path);
    const name = new TextEncoder().encode(path), checksum = crc32(bytes);
    if (name.length > 65535 || bytes.length > 0xffffffff || offset + bytes.length + name.length + 30 > 0xffffffff) throw new Error('ZIP excede limites suportados');
    const local = new Uint8Array(30), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint16(12, 33, true); // DOS date: 1980-01-01, no invented assessment date.
    lv.setUint32(14, checksum, true); lv.setUint32(18, bytes.length, true); lv.setUint32(22, bytes.length, true); lv.setUint16(26, name.length, true);
    chunks.push(local, name, bytes);
    const header = new Uint8Array(46), cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(14, 33, true); cv.setUint32(16, checksum, true); cv.setUint32(20, bytes.length, true); cv.setUint32(24, bytes.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    central.push(header, name); directorySize += header.length + name.length; offset += local.length + name.length + bytes.length;
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}
