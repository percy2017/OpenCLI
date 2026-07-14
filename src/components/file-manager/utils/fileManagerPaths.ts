export const parentPathOf = (filePath: string): string => {
  const separatorIndex = filePath.lastIndexOf('/');
  return separatorIndex < 0 ? '' : filePath.slice(0, separatorIndex);
};

export const joinWorkspacePath = (parentPath: string, name: string): string => (
  parentPath ? `${parentPath}/${name}` : name
);

export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
};
