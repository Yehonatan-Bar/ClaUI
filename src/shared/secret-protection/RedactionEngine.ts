import { DlpFinding, FindingSeverity, RedactionToken } from './types';

export interface RedactionResult {
  redacted: string;
  tokenMap: Map<string, RedactionToken>;
  replacementCount: number;
  replacedBytes: number;
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const OVERLAP_BUFFER_SIZE = 200;

export class RedactionEngine {
  private buffer = '';
  private chunkTokenMap = new Map<string, RedactionToken>();
  private chunkReplacementCount = 0;
  private chunkReplacedBytes = 0;
  private deferredFindings: DlpFinding[] = [];

  redact(text: string, findings: DlpFinding[]): RedactionResult {
    const tokenMap = new Map<string, RedactionToken>();

    const validFindings = findings.filter(
      (f) => f.location.byteStart != null && f.location.byteEnd != null
    );

    // Resolve overlaps: highest severity wins.
    const bySeverity = [...validFindings].sort((a, b) => {
      const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (sevDiff !== 0) return sevDiff;
      const aLen = a.location.byteEnd! - a.location.byteStart!;
      const bLen = b.location.byteEnd! - b.location.byteStart!;
      return bLen - aLen;
    });

    const resolvedRanges: Array<[number, number]> = [];
    const resolved: DlpFinding[] = [];
    for (const finding of bySeverity) {
      const start = finding.location.byteStart!;
      const end = finding.location.byteEnd!;
      const overlaps = resolvedRanges.some(
        ([rStart, rEnd]) => start < rEnd && end > rStart
      );
      if (!overlaps) {
        resolved.push(finding);
        resolvedRanges.push([start, end]);
      }
    }

    // Replace rightmost first so earlier byte offsets stay valid.
    resolved.sort((a, b) => b.location.byteStart! - a.location.byteStart!);

    let result = text;
    let replacementCount = 0;
    let replacedBytes = 0;

    for (const finding of resolved) {
      const start = finding.location.byteStart!;
      const end = finding.location.byteEnd!;
      replacedBytes += (end - start);
      result = result.slice(0, start) + finding.redaction.text + result.slice(end);
      tokenMap.set(finding.redaction.stableId, finding.redaction);
      replacementCount++;
    }

    return { redacted: result, tokenMap, replacementCount, replacedBytes };
  }

  redactChunked(chunk: string, findings: DlpFinding[]): RedactionResult {
    this.buffer += chunk;

    if (this.buffer.length <= OVERLAP_BUFFER_SIZE) {
      this.deferredFindings.push(...findings);
      return {
        redacted: '',
        tokenMap: new Map(),
        replacementCount: 0,
        replacedBytes: 0,
      };
    }

    const safeZoneEnd = this.buffer.length - OVERLAP_BUFFER_SIZE;
    const safeText = this.buffer.slice(0, safeZoneEnd);

    const allFindings = [...this.deferredFindings, ...findings];

    const safeFindings = allFindings.filter(
      (f) =>
        f.location.byteStart != null &&
        f.location.byteEnd != null &&
        f.location.byteStart >= 0 &&
        f.location.byteEnd <= safeZoneEnd
    );

    // Findings that extend past the safe zone get deferred to flush().
    const overlapFindings = allFindings.filter(
      (f) =>
        f.location.byteStart != null &&
        f.location.byteEnd != null &&
        f.location.byteEnd > safeZoneEnd
    );

    const result = this.redact(safeText, safeFindings);

    // Adjust deferred offsets for the buffer slide.
    this.deferredFindings = overlapFindings.map((f) => ({
      ...f,
      location: {
        ...f.location,
        byteStart: (f.location.byteStart ?? 0) - safeZoneEnd,
        byteEnd: (f.location.byteEnd ?? 0) - safeZoneEnd,
      },
    }));

    this.buffer = this.buffer.slice(safeZoneEnd);

    for (const [id, token] of result.tokenMap) {
      this.chunkTokenMap.set(id, token);
    }
    this.chunkReplacementCount += result.replacementCount;
    this.chunkReplacedBytes += result.replacedBytes;

    return {
      redacted: result.redacted,
      tokenMap: new Map(this.chunkTokenMap),
      replacementCount: this.chunkReplacementCount,
      replacedBytes: this.chunkReplacedBytes,
    };
  }

  flush(): RedactionResult {
    if (this.buffer.length === 0) {
      const tokenMap = new Map(this.chunkTokenMap);
      const count = this.chunkReplacementCount;
      const bytes = this.chunkReplacedBytes;
      this.reset();
      return { redacted: '', tokenMap, replacementCount: count, replacedBytes: bytes };
    }

    const remaining = this.buffer;

    // Apply deferred findings from previous redactChunked() calls.
    const tailFindings = this.deferredFindings.filter(
      (f) =>
        f.location.byteStart != null &&
        f.location.byteEnd != null &&
        f.location.byteStart >= 0 &&
        f.location.byteEnd <= remaining.length
    );

    const tailResult = this.redact(remaining, tailFindings);

    for (const [id, token] of tailResult.tokenMap) {
      this.chunkTokenMap.set(id, token);
    }
    this.chunkReplacementCount += tailResult.replacementCount;
    this.chunkReplacedBytes += tailResult.replacedBytes;

    const tokenMap = new Map(this.chunkTokenMap);
    const count = this.chunkReplacementCount;
    const bytes = this.chunkReplacedBytes;
    this.reset();

    return { redacted: tailResult.redacted, tokenMap, replacementCount: count, replacedBytes: bytes };
  }

  private reset(): void {
    this.buffer = '';
    this.chunkTokenMap = new Map();
    this.chunkReplacementCount = 0;
    this.chunkReplacedBytes = 0;
    this.deferredFindings = [];
  }
}
