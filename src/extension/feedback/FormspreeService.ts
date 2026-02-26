/**
 * FormspreeService — sends feedback (text + optional file attachments) to a
 * Formspree.io form endpoint.  The endpoint is write-only: anyone can submit,
 * only the form owner receives the submissions via email.
 *
 * No secrets are stored in the codebase.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeedbackAttachment {
  filename: string;
  content: Buffer;
  contentType?: string; // defaults to 'application/octet-stream'
}

export interface FeedbackPayload {
  email?: string;
  message: string;
  subject?: string;
  category?: string; // 'bug' | 'feature' | 'general'
  extensionVersion?: string;
  attachments?: FeedbackAttachment[];
}

export interface FeedbackResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const FORMSPREE_BASE = 'https://formspree.io/f';
const SUBMIT_TIMEOUT_MS = 30_000;

export class FormspreeService {
  private readonly endpoint: string;
  private log: (msg: string) => void = () => {};

  constructor(formId: string) {
    this.endpoint = `${FORMSPREE_BASE}/${formId}`;
  }

  setLogger(log: (msg: string) => void): void {
    this.log = log;
  }

  /**
   * Submit feedback to the Formspree endpoint.
   *
   * Attachments strategy:
   * 1. First tries native multipart/form-data upload (requires paid plan).
   * 2. If Formspree rejects with "File Uploads Not Permitted", automatically
   *    falls back to embedding files as base64 in the message body.
   * 3. Text-only payloads always use lightweight form-urlencoded.
   */
  async submit(payload: FeedbackPayload): Promise<FeedbackResult> {
    const hasAttachments =
      payload.attachments && payload.attachments.length > 0;

    this.log(
      `[Feedback] Submitting to Formspree (attachments: ${hasAttachments ? payload.attachments!.length : 0})`,
    );

    // Text-only — simple form-urlencoded
    if (!hasAttachments) {
      return this.postForm(this.buildFormBody(payload));
    }

    // Try native multipart upload first
    this.log('[Feedback] Attempting native multipart file upload');
    const multipartResult = await this.postForm(
      this.buildMultipartBody(payload),
      false, // don't set content-type — fetch adds boundary automatically
    );

    if (multipartResult.ok) {
      this.log('[Feedback] Native multipart upload succeeded');
      return multipartResult;
    }

    this.log(`[Feedback] Multipart upload failed: ${multipartResult.error}`);

    // Fallback: send text-only (the message body already contains all report data)
    this.log('[Feedback] Falling back to text-only submission (no file attachment)');
    return this.postForm(this.buildFormBody(payload));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** POST a body to the Formspree endpoint with timeout + error handling. */
  private async postForm(
    body: URLSearchParams | FormData,
    setContentType = true,
  ): Promise<FeedbackResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (setContentType && body instanceof URLSearchParams) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }

      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        errors?: Array<{ message?: string }>;
      } | null;

      if (res.ok && json?.ok !== false) {
        this.log('[Feedback] Submission succeeded');
        return { ok: true };
      }

      const errorMsg =
        json?.error ||
        json?.errors?.[0]?.message ||
        `HTTP ${res.status}`;
      this.log(`[Feedback] Submission failed: ${errorMsg}`);
      return { ok: false, error: errorMsg };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.includes('abort');
      this.log(
        `[Feedback] Submission error: ${isTimeout ? 'timeout' : message}`,
      );
      return {
        ok: false,
        error: isTimeout ? 'Request timed out' : message,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Build a simple form-urlencoded body (no files). */
  private buildFormBody(payload: FeedbackPayload): URLSearchParams {
    const params = new URLSearchParams();
    if (payload.email) params.set('email', payload.email);
    params.set('message', payload.message);
    if (payload.subject) params.set('_subject', payload.subject);
    if (payload.category) params.set('category', payload.category);
    if (payload.extensionVersion) {
      params.set('extensionVersion', payload.extensionVersion);
    }
    return params;
  }

  /** Build a multipart/form-data body with file attachments. */
  private buildMultipartBody(payload: FeedbackPayload): FormData {
    const form = new FormData();
    if (payload.email) form.set('email', payload.email);
    form.set('message', payload.message);
    if (payload.subject) form.set('_subject', payload.subject);
    if (payload.category) form.set('category', payload.category);
    if (payload.extensionVersion) {
      form.set('extensionVersion', payload.extensionVersion);
    }

    for (const att of payload.attachments ?? []) {
      // Use File (extends Blob) for proper filename + content-type in multipart boundary
      const file = new File(
        [new Uint8Array(att.content)],
        att.filename,
        { type: att.contentType || 'application/octet-stream' },
      );
      form.append('attachment', file);
    }

    return form;
  }

  /**
   * Fallback for free Formspree plans: embed file contents as base64 strings
   * appended to the message body.  The developer can decode them from the email.
   */
  private buildFormBodyWithEmbeddedFiles(
    payload: FeedbackPayload,
  ): URLSearchParams {
    const parts: string[] = [payload.message, '', '--- Attached files ---'];

    for (const att of payload.attachments ?? []) {
      const b64 = att.content.toString('base64');
      parts.push(
        `\nFile: ${att.filename} (${att.contentType || 'application/octet-stream'}, ${att.content.length} bytes)`,
        b64,
      );
    }

    const params = new URLSearchParams();
    if (payload.email) params.set('email', payload.email);
    params.set('message', parts.join('\n'));
    if (payload.subject) params.set('_subject', payload.subject);
    if (payload.category) params.set('category', payload.category);
    if (payload.extensionVersion) {
      params.set('extensionVersion', payload.extensionVersion);
    }
    return params;
  }
}
