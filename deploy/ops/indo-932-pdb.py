"""Bounded read-only Portable PDB document and matching PE CodeView proof."""
import hashlib
import uuid

MAX_FILE = 32 * 1024 * 1024
SHA256_GUID = '8829d00f-11b8-4213-878b-770e8597ac16'


def need(value):
    if not value:
        raise ValueError('INDO_932_PDB_PROOF_FAILED')


class Reader:
    def __init__(self, data):
        need(isinstance(data, bytes) and 0 < len(data) <= MAX_FILE)
        self.data = data

    def take(self, offset, size):
        need(isinstance(offset, int) and isinstance(size, int) and offset >= 0 and size >= 0
             and offset + size <= len(self.data))
        return self.data[offset:offset + size]

    def number(self, offset, size):
        need(size in (1, 2, 4, 8))
        return int.from_bytes(self.take(offset, size), 'little')


def compressed(reader, offset):
    first = reader.number(offset, 1)
    if first < 0x80:
        return first, offset + 1
    if first < 0xc0:
        return ((first & 0x3f) << 8) | reader.number(offset + 1, 1), offset + 2
    need(first < 0xe0)
    return ((first & 0x1f) << 24) | int.from_bytes(reader.take(offset + 1, 3), 'big'), offset + 4


def streams(data):
    reader = Reader(data)
    need(reader.take(0, 4) == b'BSJB')
    version_size = reader.number(12, 4)
    need(version_size <= 256)
    offset = (16 + version_size + 3) & ~3
    count = reader.number(offset + 2, 2)
    need(1 <= count <= 16)
    offset += 4
    result = {}
    for _ in range(count):
        start, size = reader.number(offset, 4), reader.number(offset + 4, 4)
        offset += 8
        end = data.find(b'\0', offset, offset + 32)
        need(end >= offset)
        name = reader.take(offset, end - offset).decode('ascii')
        need(name not in result)
        result[name] = Reader(reader.take(start, size))
        offset = (end + 4) & ~3
    need({'#Pdb', '#~', '#Blob', '#GUID'} <= set(result))
    return result


def pdb_documents(data):
    heap = streams(data)
    table = heap['#~']
    flags = table.number(6, 1)
    valid = table.number(8, 8)
    need(valid & ((1 << 48) - 1) == 0 and valid & (1 << 48))
    counts, offset = {}, 24
    for table_id in range(64):
        if valid & (1 << table_id):
            counts[table_id] = table.number(offset, 4)
            need(counts[table_id] <= 1000000)
            offset += 4
    blob_size, guid_size = (4 if flags & 4 else 2), (4 if flags & 2 else 2)
    width = 2 * (blob_size + guid_size)
    need(0 < counts[48] <= 10000)

    def blob(index):
        need(index >= 0)
        if index == 0:
            return b''
        size, start = compressed(heap['#Blob'], index)
        need(size <= 1024 * 1024)
        return heap['#Blob'].take(start, size)

    def guid(index):
        need(index > 0)
        return str(uuid.UUID(bytes_le=heap['#GUID'].take((index - 1) * 16, 16)))

    result = {}
    for row in range(counts[48]):
        current = offset + row * width
        name_index = table.number(current, blob_size)
        algorithm = table.number(current + blob_size, guid_size)
        hash_index = table.number(current + blob_size + guid_size, blob_size)
        encoded_name = Reader(blob(name_index))
        separator = chr(encoded_name.number(0, 1))
        need(separator in ('/', '\\'))
        position, segments = 1, []
        while position < len(encoded_name.data):
            index, position = compressed(encoded_name, position)
            segments.append(blob(index).decode('utf-8'))
        name = separator.join(segments).replace('\\', '/')
        need(name not in result and len(name) <= 4096)
        checksum = blob(hash_index)
        need(guid(algorithm) == SHA256_GUID and len(checksum) == 32)
        result[name] = checksum.hex()
    return heap['#Pdb'].take(0, 20), result


def codeview_ids(data):
    reader = Reader(data)
    need(reader.take(0, 2) == b'MZ')
    pe = reader.number(0x3c, 4)
    need(reader.take(pe, 4) == b'PE\0\0')
    section_count = reader.number(pe + 6, 2)
    optional_size = reader.number(pe + 20, 2)
    optional = pe + 24
    kind = reader.number(optional, 2)
    need(kind in (0x10b, 0x20b) and 1 <= section_count <= 96)
    directories = optional + (96 if kind == 0x10b else 112)
    need(reader.number(directories - 4, 4) >= 7)
    debug_rva, debug_size = reader.number(directories + 48, 4), reader.number(directories + 52, 4)
    need(debug_size > 0 and debug_size % 28 == 0 and debug_size <= 28 * 128)
    sections = optional + optional_size
    raw_debug = None
    for index in range(section_count):
        section = sections + index * 40
        virtual_size = reader.number(section + 8, 4)
        virtual_address = reader.number(section + 12, 4)
        raw_size, raw_pointer = reader.number(section + 16, 4), reader.number(section + 20, 4)
        if virtual_address <= debug_rva < virtual_address + max(virtual_size, raw_size):
            need(raw_debug is None and debug_rva - virtual_address + debug_size <= raw_size)
            raw_debug = raw_pointer + debug_rva - virtual_address
    need(raw_debug is not None)
    result = []
    for index in range(debug_size // 28):
        entry = raw_debug + index * 28
        if reader.number(entry + 12, 4) != 2:
            continue
        stamp = reader.take(entry + 4, 4)
        size, pointer = reader.number(entry + 16, 4), reader.number(entry + 24, 4)
        need(25 <= size <= 4096)
        payload = reader.take(pointer, size)
        need(payload[:4] == b'RSDS' and payload[20:24] == b'\x01\0\0\0' and payload.endswith(b'\0'))
        result.append(payload[4:20] + stamp)
    need(len(result) == 1)
    return result[0]


def prove(dll, pdb, expected_documents):
    need(isinstance(expected_documents, dict) and expected_documents)
    pdb_id, documents = pdb_documents(pdb)
    need(codeview_ids(dll) == pdb_id)
    checked, matched_paths = {}, set()
    for relative, expected in expected_documents.items():
        need(relative.startswith('src/') and relative.endswith('.cs') and '..' not in relative
             and len(expected) == 64)
        matches = [(path, checksum) for path, checksum in documents.items()
                   if path == relative or path.endswith('/' + relative)]
        need(len(matches) == 1 and matches[0][1] == expected)
        checked[relative] = expected
        matched_paths.add(matches[0][0])
    projects = {path.split('/')[1] for path in checked}
    need(len(projects) == 1)
    project = next(iter(projects))
    need(project in ('IndoShipping.Api', 'IndoShipping.Domain', 'IndoShipping.Infrastructure'))
    generated_names = {project + '.GlobalUsings.g.cs', project + '.AssemblyInfo.cs',
                       '.NETCoreApp,Version=v8.0.AssemblyAttributes.cs'}
    if project == 'IndoShipping.Api':
        generated_names.add(project + '.MvcApplicationPartsAssemblyInfo.cs')
    generated_suffixes = {'src/' + project + '/obj/Release/net8.0/' + name for name in generated_names}
    for path in set(documents) - matched_paths:
        need(any(path == suffix or path.endswith('/' + suffix) for suffix in generated_suffixes))
    return {'dllSha256': hashlib.sha256(dll).hexdigest(), 'pdbSha256': hashlib.sha256(pdb).hexdigest(),
            'codeViewMatchesPortablePdb': True, 'reviewedDocumentChecksumsMatched': True,
            'reviewedDocuments': len(checked), 'pdbDocuments': len(documents),
            'nonGeneratedDocumentInventoryMatched': True,
            'documentManifestSha256': hashlib.sha256(''.join(path + ':' + checked[path] + '\n'
                for path in sorted(checked)).encode()).hexdigest()}
