import { createRequire } from 'node:module';
import type { NativeScaffoldInfo } from './types.js';

export interface NativeBinding {
  scaffold_info?: () => NativeScaffoldInfo;
  normalize_platform?: (value: string) => string;
}

function loadNativeBinding(): NativeBinding | null {
  const require = createRequire(import.meta.url);
  const candidates = [
    '../meeting_detector_native.node',
    '../native/index.node'
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate) as NativeBinding;
    } catch {
      // Try next candidate
    }
  }

  return null;
}

const nativeBinding = loadNativeBinding();

export function getNativeScaffoldInfo(): NativeScaffoldInfo | null {
  if (!nativeBinding?.scaffold_info) {
    return null;
  }

  return nativeBinding.scaffold_info();
}
