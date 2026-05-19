import { DlpBoundary, DlpDestination, DlpFinding } from '../types';

export interface ScanContext {
  boundary: DlpBoundary;
  destination: DlpDestination;
  filePath?: string;
  mimeType?: string;
}

export interface ScanResult {
  findings: DlpFinding[];
  scannedBytes: number;
  latencyMs: number;
}

export interface ISecretScanner {
  name: string;
  scan(input: string, context?: ScanContext): ScanResult;
}
