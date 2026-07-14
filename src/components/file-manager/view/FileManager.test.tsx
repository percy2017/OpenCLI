import assert from 'node:assert/strict';
import test from 'node:test';
import { FileArchive, FileCode2, FileImage } from 'lucide-react';

import {
  formatFileSize,
  joinWorkspacePath,
  parentPathOf,
} from '../utils/fileManagerPaths';
import { getFileIcon } from '../utils/fileManagerIcons';

test('keeps workspace paths relative and normalized for UI operations', () => {
  assert.equal(parentPathOf('src/components/App.tsx'), 'src/components');
  assert.equal(parentPathOf('README.md'), '');
  assert.equal(joinWorkspacePath('src/components', 'App.tsx'), 'src/components/App.tsx');
  assert.equal(joinWorkspacePath('', '.env'), '.env');
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(1024), '1.00 KB');
});

test('maps common file extensions to distinct Lucide icons', () => {
  assert.equal(getFileIcon('server.ts'), FileCode2);
  assert.equal(getFileIcon('photo.png'), FileImage);
  assert.equal(getFileIcon('backup.zip'), FileArchive);
});
