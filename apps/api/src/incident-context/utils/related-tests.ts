const TEST_FILENAME_MARKER = /\.(test|spec)\.[^./]+$/;
const TEST_DIR_SEGMENT = /(^|\/)(tests|__tests__|test)\//;

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function sourceBaseName(path: string): string {
  return fileName(path).replace(/\.[^./]+$/, '');
}

function testBaseName(path: string): string {
  const name = fileName(path);
  const match = name.match(TEST_FILENAME_MARKER);
  return match ? name.slice(0, match.index) : name.replace(/\.[^./]+$/, '');
}

/**
 * Heuristically finds likely test files for a source file: same base filename,
 * either marked with .test/.spec or living under a tests/__tests__/test directory.
 */
export function findRelatedTestPaths(sourcePath: string, repositoryPaths: string[]): string[] {
  const sourceBase = sourceBaseName(sourcePath);

  return repositoryPaths.filter((path) => {
    if (path === sourcePath) return false;
    const isTestFile = TEST_FILENAME_MARKER.test(fileName(path)) || TEST_DIR_SEGMENT.test(path);
    if (!isTestFile) return false;
    return testBaseName(path) === sourceBase;
  });
}
