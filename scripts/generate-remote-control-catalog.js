// Generates src/extension/remote-control/uiActionCatalog.generated.json from the
// webview <-> extension message contract (src/extension/types/webview-messages.ts).
//
// The catalog lists every chat-UI action (WebviewToExtensionMessage member) and
// every UI event (ExtensionToWebviewMessage member) with its fields, so remote
// callers can discover what `dispatch_ui_action` accepts and what
// `waitForEvent` / `get_events` can return.
//
// Usage:  node scripts/generate-remote-control-catalog.js          (write)
//         node scripts/generate-remote-control-catalog.js --check  (exit 1 if stale)

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'src', 'extension', 'types', 'webview-messages.ts');
const OUTPUT = path.join(ROOT, 'src', 'extension', 'remote-control', 'uiActionCatalog.generated.json');

function readJsDoc(node, sourceFile) {
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) || [];
  const docs = ranges
    .map((r) => sourceFile.text.slice(r.pos, r.end))
    .filter((c) => c.startsWith('/**') || c.startsWith('//'))
    .map((c) =>
      c
        .replace(/^\/\*\*?/, '')
        .replace(/\*\/$/, '')
        .split('\n')
        .map((line) => line.replace(/^\s*\*\s?/, '').replace(/^\s*\/\/\s?/, '').trim())
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean);
  const text = docs.join(' ').trim();
  return text.length > 400 ? `${text.slice(0, 400)}...` : text;
}

function collect() {
  const text = fs.readFileSync(SOURCE, 'utf8');
  const sourceFile = ts.createSourceFile(SOURCE, text, ts.ScriptTarget.ES2022, true);

  const interfaces = new Map();
  const unions = new Map();

  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      interfaces.set(statement.name.text, statement);
    } else if (ts.isTypeAliasDeclaration(statement) && ts.isUnionTypeNode(statement.type)) {
      unions.set(
        statement.name.text,
        statement.type.types.filter(ts.isTypeReferenceNode).map((t) => t.typeName.getText(sourceFile)),
      );
    }
  }

  const describeInterface = (name) => {
    const decl = interfaces.get(name);
    if (!decl) {
      return null;
    }
    let messageType = null;
    const fields = [];
    for (const member of decl.members) {
      if (!ts.isPropertySignature(member) || !member.name) {
        continue;
      }
      const fieldName = member.name.getText(sourceFile).replace(/['"]/g, '');
      const typeText = member.type ? member.type.getText(sourceFile).replace(/\s+/g, ' ') : 'unknown';
      if (fieldName === 'type' && member.type && ts.isLiteralTypeNode(member.type) && ts.isStringLiteral(member.type.literal)) {
        messageType = member.type.literal.text;
        continue;
      }
      const field = { name: fieldName, type: typeText, optional: !!member.questionToken };
      const doc = readJsDoc(member, sourceFile);
      if (doc) {
        field.doc = doc;
      }
      fields.push(field);
    }
    if (!messageType) {
      return null;
    }
    const entry = { type: messageType, interface: name, fields };
    const extendsClause = (decl.heritageClauses || [])
      .flatMap((h) => h.types.map((t) => t.expression.getText(sourceFile)));
    if (extendsClause.length > 0) {
      entry.extends = extendsClause;
    }
    const doc = readJsDoc(decl, sourceFile);
    if (doc) {
      entry.doc = doc;
    }
    return entry;
  };

  const build = (unionName) => {
    const members = unions.get(unionName);
    if (!members) {
      throw new Error(`Union ${unionName} not found in ${SOURCE}`);
    }
    const seen = new Set();
    const out = [];
    for (const name of members) {
      const entry = describeInterface(name);
      if (!entry || seen.has(entry.type)) {
        continue;
      }
      seen.add(entry.type);
      out.push(entry);
    }
    return out.sort((a, b) => a.type.localeCompare(b.type));
  };

  return {
    generatedFrom: 'src/extension/types/webview-messages.ts',
    uiActions: build('WebviewToExtensionMessage'),
    uiEvents: build('ExtensionToWebviewMessage'),
  };
}

function main() {
  const catalog = collect();
  const json = `${JSON.stringify(catalog, null, 1)}\n`;
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
    if (current !== json) {
      console.error('[remote-control-catalog] STALE: run `npm run gen:remote-control-catalog`.');
      process.exit(1);
    }
    console.log('[remote-control-catalog] up to date');
    return;
  }
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, json, 'utf8');
  console.log(
    `[remote-control-catalog] wrote ${catalog.uiActions.length} UI actions and ${catalog.uiEvents.length} UI events to ${path.relative(ROOT, OUTPUT)}`,
  );
}

module.exports = { collect };

if (require.main === module) {
  main();
}
