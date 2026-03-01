import path from 'node:path';

/**
 * Junta um caminho relativo de forma segura dentro de um diretório base.
 * Retorna `null` quando detectar tentativa de path traversal.
 */
export const safeJoin = (baseDir, unsafePath) => {
  const baseAbsolutePath = path.resolve(String(baseDir || '.'));
  const normalizedUnsafePath = String(unsafePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  const normalizedRelativePath = path.posix.normalize(normalizedUnsafePath);
  if (normalizedRelativePath === '..' || normalizedRelativePath.startsWith('../') || normalizedRelativePath.includes('/../')) {
    return null;
  }

  const safeRelativePath = normalizedRelativePath === '.' ? '' : normalizedRelativePath;
  const resolvedPath = path.resolve(baseAbsolutePath, safeRelativePath);

  if (resolvedPath !== baseAbsolutePath && !resolvedPath.startsWith(`${baseAbsolutePath}${path.sep}`)) {
    return null;
  }

  return resolvedPath;
};
