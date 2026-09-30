const APP_FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function readScalar(value) {
  const text = value.trim();
  if (text.startsWith('"')) {
    try { return JSON.parse(text); } catch { return text.slice(1, -1); }
  }
  return text;
}

export function splitAiFrontmatter(source) {
  const body = String(source ?? '');
  const match = body.match(APP_FRONTMATTER);
  if (!match) return {metadata:null, body};

  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-z_]+):\s*(.*)$/);
    if (field) metadata[field[1]] = readScalar(field[2]);
  }
  if (metadata.type !== 'lecture' || !/^lecture-[a-z0-9-]+$/i.test(metadata.id || '')) {
    return {metadata:null, body};
  }
  return {metadata, body:body.slice(match[0].length).replace(/^(?:\r?\n)+/, '')};
}

export function withAiFrontmatter(source, metadata) {
  const body = splitAiFrontmatter(source).body;
  const yaml = [
    `course_id: ${yamlString(metadata.course_id)}`,
    `course_name: ${yamlString(metadata.course_name)}`,
    `created: ${metadata.created}`,
    `id: ${yamlString(metadata.id)}`,
    'type: lecture',
    `semester: ${yamlString(metadata.semester)}`,
    `status: ${metadata.status || 'draft'}`,
    `updated: ${metadata.updated}`
  ].join('\n');
  return `---\n${yaml}\n---\n\n${body}`;
}

