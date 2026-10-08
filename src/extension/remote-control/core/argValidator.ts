/**
 * Runtime validation of untrusted tool arguments against the catalog's JSON
 * schemas. Supports exactly the subset the catalog uses: type (single or
 * list), enum, properties / required / additionalProperties:false, items,
 * minLength / maxLength, minimum / maximum, maxItems. Also enforces global
 * caps on string size, array size and nesting depth for every value.
 */

export type JsonSchema = Record<string, unknown>;

export interface ValidationLimits {
  /** Applies to every string without its own maxLength. */
  maxStringLength: number;
  /** Applies to every array without its own maxItems. */
  maxArrayItems: number;
  maxDepth: number;
}

export const DEFAULT_LIMITS: ValidationLimits = {
  // Base64 images go through `images[].base64`; 15 MB of base64 ~ 11 MB image.
  maxStringLength: 15 * 1024 * 1024,
  maxArrayItems: 1000,
  maxDepth: 12,
};

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  const actual = typeOf(value);
  if (expected === 'number') {
    return actual === 'number' || actual === 'integer';
  }
  return actual === expected;
}

export function validateArgs(
  value: unknown,
  schema: JsonSchema,
  limits: ValidationLimits = DEFAULT_LIMITS,
): string[] {
  const errors: string[] = [];

  const walk = (node: unknown, s: JsonSchema, where: string, depth: number): void => {
    if (depth > limits.maxDepth) {
      errors.push(`${where}: nested too deeply`);
      return;
    }
    if (typeof node === 'number' && !Number.isFinite(node)) {
      errors.push(`${where}: must be a finite number`);
      return;
    }
    const declared = s.type;
    if (declared !== undefined) {
      const allowed = Array.isArray(declared) ? (declared as string[]) : [declared as string];
      if (!allowed.some((t) => matchesType(node, t))) {
        errors.push(`${where}: expected ${allowed.join(' or ')}, got ${typeOf(node)}`);
        return;
      }
    }
    if (Array.isArray(s.enum) && !(s.enum as unknown[]).includes(node)) {
      errors.push(`${where}: must be one of ${(s.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')}`);
      return;
    }
    if (typeof node === 'string') {
      const max = typeof s.maxLength === 'number' ? s.maxLength : limits.maxStringLength;
      if (node.length > max) {
        errors.push(`${where}: longer than ${max} characters`);
      }
      if (typeof s.minLength === 'number' && node.length < s.minLength) {
        errors.push(`${where}: shorter than ${s.minLength} characters`);
      }
      return;
    }
    if (typeof node === 'number') {
      if (typeof s.minimum === 'number' && node < s.minimum) {
        errors.push(`${where}: must be >= ${s.minimum}`);
      }
      if (typeof s.maximum === 'number' && node > s.maximum) {
        errors.push(`${where}: must be <= ${s.maximum}`);
      }
      return;
    }
    if (Array.isArray(node)) {
      const max = typeof s.maxItems === 'number' ? s.maxItems : limits.maxArrayItems;
      if (node.length > max) {
        errors.push(`${where}: more than ${max} items`);
        return;
      }
      const itemSchema = (s.items && typeof s.items === 'object' ? s.items : {}) as JsonSchema;
      node.forEach((item, i) => walk(item, itemSchema, `${where}[${i}]`, depth + 1));
      return;
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      const props = (s.properties && typeof s.properties === 'object' ? s.properties : {}) as Record<string, JsonSchema>;
      const required = Array.isArray(s.required) ? (s.required as string[]) : [];
      for (const key of required) {
        if (record[key] === undefined) {
          errors.push(`${where === '' ? '' : `${where}.`}${key}: is required`);
        }
      }
      for (const [key, child] of Object.entries(record)) {
        const childWhere = where === '' ? key : `${where}.${key}`;
        if (props[key]) {
          if (child !== undefined) {
            walk(child, props[key], childWhere, depth + 1);
          }
        } else if (s.additionalProperties === false) {
          errors.push(`${childWhere}: unknown argument`);
        } else {
          // Free-form value (e.g. dispatch_ui_action.action extra fields): still apply global caps.
          walk(child, {}, childWhere, depth + 1);
        }
      }
    }
  };

  walk(value, schema, '', 0);
  return errors;
}
