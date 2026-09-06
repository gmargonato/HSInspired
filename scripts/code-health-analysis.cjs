const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const ts = require('typescript')

const slash = (value) => value.replace(/\\/g, '/')
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const testPath = (value) =>
  /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|\/(?:__tests__|tests)\/)/.test(value)
const callable = (node) =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessor(node) ||
  ts.isSetAccessor(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  ts.isMethodSignature(node) ||
  ts.isCallSignatureDeclaration(node) ||
  ts.isFunctionTypeNode(node)
const unique = (items) => [...new Set(items)].sort()

function components(ids, edges) {
  const adjacency = new Map(ids.map((id) => [id, []]))
  for (const edge of edges)
    if (adjacency.has(edge.from) && adjacency.has(edge.to))
      adjacency.get(edge.from).push(edge.to)
  const indices = new Map(),
    low = new Map(),
    stack = [],
    active = new Set(),
    result = []
  let index = 0
  function visit(id) {
    indices.set(id, index)
    low.set(id, index++)
    stack.push(id)
    active.add(id)
    for (const next of adjacency.get(id)) {
      if (!indices.has(next)) {
        visit(next)
        low.set(id, Math.min(low.get(id), low.get(next)))
      } else if (active.has(next)) low.set(id, Math.min(low.get(id), indices.get(next)))
    }
    if (low.get(id) !== indices.get(id)) return
    const group = []
    let next
    do {
      next = stack.pop()
      active.delete(next)
      group.push(next)
    } while (next !== id)
    result.push(group.sort())
  }
  for (const id of ids) if (!indices.has(id)) visit(id)
  return result
}

function analyzeCodebase(
  root,
  cruise = { modules: [], summary: {} },
  registry = { subsystems: [], flows: [] },
  configNames = ['tsconfig.node.json', 'tsconfig.web.json']
) {
  const relative = (file) => slash(path.relative(root, file))
  const files = new Map(),
    symbols = new Map(),
    relationships = new Map(),
    diagnostics = [],
    unresolved = []
  const programs = []
  const configurations = []
  const classify = (file) => {
    const matches = registry.subsystems.filter((subsystem) =>
      subsystem.roots.some((prefix) => file.startsWith(prefix))
    )
    return {
      process: file.startsWith('src/renderer/')
        ? 'renderer'
        : file.startsWith('src/main/')
          ? 'main'
          : file.startsWith('src/preload/')
            ? 'preload'
            : 'neutral',
      layer: file.startsWith('src/renderer/') ? file.split('/')[2] : file.split('/')[1],
      subsystem: matches[0]?.id || 'unmapped',
      subsystemMatches: matches.map((item) => item.id),
      scope: testPath(file)
        ? 'test'
        : /\/(?:dev|__fixtures__)\//.test(file) || /\/dev-/.test(file)
          ? 'development'
          : file.endsWith('.d.ts')
            ? 'declaration'
            : 'production'
    }
  }
  function location(node) {
    const source = node.getSourceFile(),
      start = source.getLineAndCharacterOfPosition(node.getStart(source))
    return {
      file: relative(source.fileName),
      line: start.line + 1,
      column: start.character + 1,
      endLine: source.getLineAndCharacterOfPosition(node.end).line + 1
    }
  }
  const declarationId = (node) =>
    `${relative(node.getSourceFile().fileName)}#${node.getStart(node.getSourceFile())}:${ts.SyntaxKind[node.kind]}`
  function addEdge(from, to, kind, node, evidence = 'statically-resolved', extra = {}) {
    const source = location(node)
    const id = hash(JSON.stringify([from, to, kind, source, extra])).slice(0, 20)
    if (!relationships.has(id))
      relationships.set(id, {
        id,
        from,
        to,
        kind,
        evidence,
        location: source,
        ...extra
      })
    return id
  }
  for (const configName of configNames) {
    const configFile = path.join(root, configName)
    const config = ts.readConfigFile(configFile, ts.sys.readFile)
    if (config.error)
      throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
    if (parsed.errors.length)
      throw new Error(
        parsed.errors
          .map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n'))
          .join('\n')
      )
    const program = ts.createProgram(parsed.fileNames, {
      ...parsed.options,
      noEmit: true,
      incremental: false,
      composite: false
    })
    programs.push({ program, configName })
    configurations.push({
      file: configName,
      options: parsed.options,
      rootFiles: parsed.fileNames.map(relative).sort()
    })
    for (const diagnostic of [
      ...program.getOptionsDiagnostics(),
      ...program.getGlobalDiagnostics()
    ])
      diagnostics.push({
        configuration: configName,
        file: null,
        line: null,
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
      })
  }
  // Prefer each adapter's own configuration; shared/domain declarations use the first program.
  const owned = new Set()
  for (const { program, configName } of programs) {
    const checker = program.getTypeChecker()
    const sources = program.getSourceFiles().filter((source) => {
      const file = relative(source.fileName)
      return (
        file.startsWith('src/') &&
        !owned.has(file) &&
        !(configName.includes('node') && file.startsWith('src/renderer/'))
      )
    })
    const nodeIds = new Map()
    function register(node, parentId) {
      let owner = parentId
      const isSymbol =
        callable(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isPropertySignature(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        (ts.isParameter(node) &&
          node.modifiers?.some((m) =>
            [
              ts.SyntaxKind.PublicKeyword,
              ts.SyntaxKind.PrivateKeyword,
              ts.SyntaxKind.ProtectedKeyword,
              ts.SyntaxKind.ReadonlyKeyword
            ].includes(m.kind)
          ))
      if (isSymbol) {
        const id = declarationId(node)
        const name =
          node.name?.getText() ||
          (ts.isConstructorDeclaration(node)
            ? 'constructor'
            : callable(node)
              ? '<callback>'
              : '<anonymous>')
        const source = location(node)
        const kind = callable(node)
          ? ts.isMethodSignature(node) ||
            ts.isCallSignatureDeclaration(node) ||
            ts.isFunctionTypeNode(node)
            ? 'signature'
            : 'callable'
          : ts.isClassDeclaration(node) || ts.isClassExpression(node)
            ? 'class'
            : ts.isInterfaceDeclaration(node)
              ? 'interface'
              : ts.isPropertyDeclaration(node) ||
                  ts.isPropertySignature(node) ||
                  ts.isParameter(node)
                ? 'field'
                : 'declaration'
        const item = {
          id,
          name,
          qualifiedName: `${symbols.get(parentId)?.qualifiedName || source.file}::${name}`,
          kind,
          syntaxKind: ts.SyntaxKind[node.kind],
          parent: parentId,
          location: source,
          ...classify(source.file),
          exported: Boolean(
            node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ||
            (ts.isVariableDeclaration(node) &&
              node.parent.parent.modifiers?.some(
                (m) => m.kind === ts.SyntaxKind.ExportKeyword
              ))
          ),
          signature: callable(node)
            ? node
                .getText()
                .slice(0, node.body ? node.body.pos - node.getStart() : 300)
                .trim()
                .slice(0, 500)
            : undefined
        }
        if (callable(node) && node.body) {
          item.metrics = methodMetrics(node)
          item.excerpt = node.getText().slice(0, 1600)
          item.excerptTruncated = node.getText().length > 1600
        }
        symbols.set(id, item)
        nodeIds.set(node, id)
        owner = id
      }
      ts.forEachChild(node, (child) => register(child, owner))
    }
    for (const source of sources) {
      const file = relative(source.fileName)
      owned.add(file)
      files.set(file, {
        id: file,
        hash: hash(source.text),
        lines: source.getLineAndCharacterOfPosition(source.end).line + 1,
        configuration: configName,
        ...classify(file)
      })
      register(source, file)
    }
    const resolveSymbol = (node) => {
      let symbol = checker.getSymbolAtLocation(node)
      if (symbol?.flags & ts.SymbolFlags.Alias)
        symbol = checker.getAliasedSymbol(symbol)
      return symbol
    }
    const targetOf = (node) => {
      const symbol = resolveSymbol(node)
      const declaration =
        symbol?.declarations?.find((item) => callable(item) && item.body) ||
        symbol?.valueDeclaration ||
        symbol?.declarations?.[0]
      if (!declaration) return null
      // Function-valued variables/properties are callable declarations in their own right.
      const target =
        declaration.initializer && callable(declaration.initializer)
          ? declaration.initializer
          : declaration
      return {
        id: ts.isSourceFile(target) ? relative(target.fileName) : declarationId(target),
        declaration: target,
        file: relative(target.getSourceFile().fileName)
      }
    }
    const literal = (node) => {
      if (!node) return null
      if (ts.isStringLiteralLike(node)) return node.text
      const type = checker.getTypeAtLocation(node)
      return type.isStringLiteral() ? type.value : null
    }
    function walk(node, owner) {
      // Local variable initializers execute in the containing method. Retain the
      // variable as a symbol without incorrectly making it a separate caller.
      if (!ts.isVariableDeclaration(node)) owner = nodeIds.get(node) || owner
      const dynamicImport =
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      const importEquals =
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      if (dynamicImport || importEquals) {
        const specifier = dynamicImport
          ? node.arguments[0]
          : node.moduleReference.expression
        const target =
          specifier && ts.isStringLiteralLike(specifier) ? targetOf(specifier) : null
        if (target)
          addEdge(
            relative(node.getSourceFile().fileName),
            target.file,
            dynamicImport
              ? 'imports-dynamic'
              : node.isTypeOnly
                ? 'imports-type'
                : 'imports-value',
            node,
            'statically-resolved',
            { specifier: specifier.text, typeOnly: Boolean(node.isTypeOnly) }
          )
        else
          unresolved.push({
            kind: 'dynamic-import',
            owner,
            location: location(node),
            expression: specifier?.getText(),
            reason: 'Module specifier is nonliteral or could not be resolved.'
          })
      }
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) {
          const moduleTarget = targetOf(node.moduleSpecifier)
          const destination =
            moduleTarget?.file || `external:${node.moduleSpecifier.text}`
          const clause = node.importClause
          const bindings = clause?.namedBindings
          const allType =
            node.isTypeOnly ||
            clause?.isTypeOnly ||
            (node.exportClause &&
              ts.isNamedExports(node.exportClause) &&
              node.exportClause.elements.length > 0 &&
              node.exportClause.elements.every((item) => item.isTypeOnly)) ||
            (bindings &&
              ts.isNamedImports(bindings) &&
              !clause.name &&
              bindings.elements.length > 0 &&
              bindings.elements.every((item) => item.isTypeOnly))
          const kind = ts.isExportDeclaration(node)
            ? 're-exports'
            : allType
              ? 'imports-type'
              : 'imports-value'
          addEdge(
            relative(node.getSourceFile().fileName),
            destination,
            kind,
            node,
            moduleTarget ? 'statically-resolved' : 'inferred',
            { specifier: node.moduleSpecifier.text, typeOnly: Boolean(allType) }
          )
          const entries = ts.isExportDeclaration(node)
            ? node.exportClause && ts.isNamedExports(node.exportClause)
              ? node.exportClause.elements
              : []
            : [
                ...(clause?.name ? [clause] : []),
                ...(bindings && ts.isNamedImports(bindings) ? bindings.elements : [])
              ]
          for (const entry of entries) {
            const target = targetOf(entry.name)
            if (target?.file.startsWith('src/'))
              addEdge(
                relative(node.getSourceFile().fileName),
                target.id,
                ts.isExportDeclaration(node) ? 're-exports-symbol' : 'imports-symbol',
                entry,
                'statically-resolved',
                { via: destination, typeOnly: Boolean(allType || entry.isTypeOnly) }
              )
          }
        }
      }
      if (ts.isHeritageClause(node))
        for (const type of node.types) {
          const target = targetOf(type.expression)
          if (target?.file.startsWith('src/'))
            addEdge(
              owner,
              target.id,
              node.token === ts.SyntaxKind.ImplementsKeyword ? 'implements' : 'extends',
              type
            )
        }
      if ((ts.isCallExpression(node) && !dynamicImport) || ts.isNewExpression(node)) {
        const target = targetOf(
          ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name
            : node.expression
        )
        const signature = checker.getResolvedSignature(node)
        const declared = signature?.declaration
        const fallback = declared && {
          id: declarationId(declared),
          declaration: declared,
          file: relative(declared.getSourceFile().fileName)
        }
        const chosen = target || fallback
        const dispatch =
          chosen &&
          (ts.isMethodSignature(chosen.declaration) ||
            ts.isPropertySignature(chosen.declaration) ||
            ts.isParameter(chosen.declaration) ||
            ts.isVariableDeclaration(chosen.declaration) ||
            ts.isFunctionTypeNode(chosen.declaration))
            ? 'declared-target'
            : 'static-target'
        if (chosen)
          addEdge(
            owner,
            chosen.id,
            ts.isNewExpression(node) ? 'constructs' : 'calls',
            node,
            'statically-resolved',
            { dispatch }
          )
        else if (!chosen)
          unresolved.push({
            kind: 'call',
            owner,
            location: location(node),
            expression: node.expression.getText().slice(0, 180),
            reason: 'No declaration resolved; dynamic invocation or incomplete types.'
          })
        const expression = node.expression
        if (ts.isPropertyAccessExpression(expression)) {
          const method = expression.name.text
          const receiver = expression.expression.getText()
          const channel = literal(node.arguments?.[0])
          const electron =
            chosen && /(?:node_modules\/electron\/|\/electron\.d\.ts)/.test(chosen.file)
          if (
            channel &&
            electron &&
            ['handle', 'handleOnce', 'on', 'once', 'invoke', 'send'].includes(method) &&
            /ipc(?:Main|Renderer)/.test(receiver)
          ) {
            const channelId = `channel:${channel}`
            addEdge(
              owner,
              channelId,
              ['invoke', 'send'].includes(method)
                ? 'invokes-channel'
                : 'handles-channel',
              node,
              'statically-resolved',
              { channel }
            )
            const callback = node.arguments[1]
            if (callback && !['invoke', 'send'].includes(method)) {
              const handler = nodeIds.get(callback) || targetOf(callback)?.id
              if (handler)
                addEdge(
                  channelId,
                  handler,
                  'dispatches-handler',
                  callback,
                  'inferred',
                  {
                    reason:
                      'Matched Electron registration; execution depends on a runtime message.'
                  }
                )
            }
          }
          if (
            [
              'on',
              'once',
              'addEventListener',
              'subscribe',
              'then',
              'catch',
              'finally'
            ].includes(method)
          ) {
            for (const argument of node.arguments || []) {
              const callback = nodeIds.get(argument) || targetOf(argument)?.id
              if (
                callback &&
                (callable(argument) ||
                  checker.getTypeAtLocation(argument).getCallSignatures().length)
              )
                addEdge(owner, callback, 'registers-handler', argument, 'inferred', {
                  api: expression.getText(),
                  event: channel,
                  reason:
                    'Recognized registration API; not proof of callback execution.'
                })
            }
          }
        }
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const target = targetOf(
          ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression
        )
        if (
          target?.file.startsWith('src/') &&
          (ts.isPropertyDeclaration(target.declaration) ||
            ts.isPropertySignature(target.declaration) ||
            ts.isParameter(target.declaration))
        ) {
          const parent = node.parent
          const assignment =
            ts.isBinaryExpression(parent) &&
            parent.left === node &&
            parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          const update =
            (ts.isPostfixUnaryExpression(parent) ||
              ts.isPrefixUnaryExpression(parent)) &&
            [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(
              parent.operator
            )
          const deletion = ts.isDeleteExpression(parent)
          if (!assignment || parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
            addEdge(owner, target.id, 'reads-state', node)
          if (assignment || update || deletion)
            addEdge(owner, target.id, 'writes-state', node)
          if (
            ts.isPropertyAccessExpression(parent) &&
            ts.isCallExpression(parent.parent) &&
            parent.parent.expression === parent &&
            [
              'push',
              'pop',
              'splice',
              'shift',
              'unshift',
              'set',
              'add',
              'delete',
              'clear',
              'sort',
              'reverse',
              'fill',
              'copyWithin'
            ].includes(parent.name.text)
          )
            addEdge(owner, target.id, 'writes-state', node, 'inferred', {
              reason:
                'Known mutator name on field receiver; alias effects are not tracked.'
            })
        }
      }
      if (
        ts.isIdentifier(node) &&
        !(
          node.parent.name === node &&
          (ts.isVariableDeclaration(node.parent) || callable(node.parent))
        )
      ) {
        const target = targetOf(node)
        if (
          target?.file.startsWith('src/') &&
          !testPath(target.file) &&
          target.id !== owner &&
          (testPath(relative(node.getSourceFile().fileName)) ||
            callable(target.declaration) ||
            ts.isClassDeclaration(target.declaration) ||
            ts.isInterfaceDeclaration(target.declaration) ||
            ts.isTypeAliasDeclaration(target.declaration))
        )
          addEdge(
            owner,
            target.id,
            testPath(relative(node.getSourceFile().fileName))
              ? 'test-references'
              : 'references-symbol',
            node
          )
      }
      ts.forEachChild(node, (child) => walk(child, owner))
    }
    for (const source of sources) {
      walk(source, relative(source.fileName))
      for (const diagnostic of [
        ...program.getSyntacticDiagnostics(source),
        ...program.getSemanticDiagnostics(source)
      ]) {
        diagnostics.push({
          configuration: configName,
          file: relative(source.fileName),
          line: source.getLineAndCharacterOfPosition(diagnostic.start || 0).line + 1,
          code: diagnostic.code,
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        })
      }
    }
  }
  // Explicit implementation candidates are separate from the declared call target.
  for (const edge of [...relationships.values()].filter(
    (item) => item.kind === 'implements'
  )) {
    const members = [...symbols.values()].filter(
      (item) => item.parent === edge.to && item.kind === 'signature'
    )
    for (const member of members) {
      for (const implementation of [...symbols.values()].filter(
        (item) =>
          item.parent === edge.from &&
          item.name === member.name &&
          item.kind === 'callable'
      )) {
        const id = hash(
          JSON.stringify([member.id, implementation.id, 'possible-implementation'])
        ).slice(0, 20)
        relationships.set(id, {
          id,
          from: member.id,
          to: implementation.id,
          kind: 'possible-implementation',
          evidence: 'inferred',
          location: implementation.location,
          reason:
            'Matching method on an explicit implementing class; receiver identity and structural implementations remain unknown.'
        })
      }
    }
  }
  // Imported declarations can belong to a different program, or unsupported syntax.
  // Keep those endpoints explicit instead of silently dropping their relationships.
  const externalTargets = new Map()
  for (const edge of relationships.values())
    for (const id of [edge.from, edge.to]) {
      if (!symbols.has(id) && !files.has(id))
        externalTargets.set(id, {
          id,
          kind: id.startsWith('channel:') ? 'channel' : 'unindexed-target',
          name: id,
          reason:
            'Channel, external module, or declaration outside the indexed symbol kinds.'
        })
    }
  const data = {
    schemaVersion: 1,
    analyzerVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    snapshot: snapshot(root, files, configNames, configurations),
    scope: {
      configurations: configNames,
      excludedSourceFiles: ts.sys
        .readDirectory(path.join(root, 'src'), ['.ts', '.tsx'], undefined, ['**/*'])
        .map(relative)
        .filter((file) => !files.has(file)),
      sourceRoot: 'src',
      tests: 'Indexed separately; references are not execution coverage.',
      coverage: 'Not collected',
      exclusions: [
        'Dependencies outside src (boundary endpoints only)',
        'Assets and generated output',
        'Runtime traces'
      ],
      limitations: [
        'Calls resolve declarations, not runtime execution. Interface dispatch and callbacks can have unknown implementations.',
        'State access covers explicit properties and selected mutator names; aliases, reflective access and deep mutation are incomplete.',
        'Implementation counts cover explicit implements/extends clauses, not all structural TypeScript implementations.',
        'Potential impact is static reachability, not a guarantee that every consumer changes.',
        'Method metrics exclude nested functions, which have separate records. Size includes comments and blank lines.',
        'Subsystem ownership uses the registry first match; overlaps and unmapped files are reported.',
        'No discovered consumer does not prove dead code. Entry points and framework callbacks require review.'
      ]
    },
    subsystems: registry.subsystems,
    curatedFlows: registry.flows.map((flow) => ({
      ...flow,
      evidence: 'manually-annotated',
      verified: false
    })),
    files: [...files.values()].sort((a, b) => a.id.localeCompare(b.id)),
    symbols: [...symbols.values()].sort((a, b) => a.id.localeCompare(b.id)),
    relationships: [...relationships.values()].sort((a, b) => a.id.localeCompare(b.id)),
    externalTargets: [...externalTargets.values()].sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    diagnostics,
    unresolved,
    boundaryViolations: cruise.summary?.violations || [],
    dependencySummary: cruise.summary || {}
  }
  deriveHealth(data)
  return data
}

function methodMetrics(node) {
  let branches = 0,
    maxNesting = 0,
    returns = 0,
    awaits = 0
  const decisions = new Set([
    ts.SyntaxKind.IfStatement,
    ts.SyntaxKind.ForStatement,
    ts.SyntaxKind.ForInStatement,
    ts.SyntaxKind.ForOfStatement,
    ts.SyntaxKind.WhileStatement,
    ts.SyntaxKind.DoStatement,
    ts.SyntaxKind.CatchClause,
    ts.SyntaxKind.CaseClause,
    ts.SyntaxKind.ConditionalExpression
  ])
  function visit(child, depth) {
    if (child !== node && callable(child)) return
    const decision = decisions.has(child.kind)
    const logical =
      ts.isBinaryExpression(child) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken
      ].includes(child.operatorToken.kind)
    if (decision || logical) branches++
    if (decision) depth++
    maxNesting = Math.max(maxNesting, depth)
    if (ts.isReturnStatement(child)) returns++
    if (ts.isAwaitExpression(child)) awaits++
    ts.forEachChild(child, (next) => visit(next, depth))
  }
  visit(node.body, 0)
  const body = node.body,
    statements = ts.isBlock(body) ? body.statements : null
  let returned =
    statements?.length === 1 && ts.isReturnStatement(statements[0])
      ? statements[0].expression
      : !ts.isBlock(body)
        ? body
        : null
  if (returned && ts.isAwaitExpression(returned)) returned = returned.expression
  // Exact argument forwarding only: expressions that transform input are not thin wrappers.
  const forwarding =
    returned &&
    ts.isCallExpression(returned) &&
    returned.arguments.length === node.parameters.length &&
    returned.arguments.every(
      (arg, index) =>
        ts.isIdentifier(arg) &&
        ts.isIdentifier(node.parameters[index].name) &&
        arg.text === node.parameters[index].name.text
    )
  const source = node.getSourceFile()
  return {
    lines:
      source.getLineAndCharacterOfPosition(node.end).line -
      source.getLineAndCharacterOfPosition(node.getStart()).line +
      1,
    branches,
    cyclomaticApproximation: branches + 1,
    maxNesting,
    parameters: node.parameters.length,
    returns,
    awaits,
    exactForwarder: Boolean(forwarding)
  }
}

function snapshot(root, files, configNames, configurations) {
  const git = (args) => {
    const result = spawnSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
    return result.status === 0 ? result.stdout.trim() : null
  }
  const inputPaths = [
    'package.json',
    'package-lock.json',
    '.dependency-cruiser.cjs',
    'architecture/subsystems.cjs',
    ...configNames,
    'scripts/code-health-analysis.cjs',
    'scripts/code-health-report.cjs',
    'scripts/generate-architecture-atlas.cjs',
    'scripts/verify-code-health.cjs'
  ]
  const inputs = inputPaths
    .filter((file) => fs.existsSync(path.join(root, file)))
    .map((file) => ({ file, hash: hash(fs.readFileSync(path.join(root, file))) }))
  const sourceHash = hash(
    [...files.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((file) => `${file.id}:${file.hash}`)
      .join('\n')
  )
  const status = git(['status', '--porcelain=v1', '--untracked-files=all'])
  const changedSinceRead = [...files.values()]
    .filter(
      (file) =>
        !fs.existsSync(path.join(root, file.id)) ||
        hash(ts.sys.readFile(path.join(root, file.id))) !== file.hash
    )
    .map((file) => file.id)
  return {
    commit: git(['rev-parse', 'HEAD']),
    dirty: status === null ? null : status.length > 0,
    gitStatus: status,
    sourceHash,
    sourceHashEncoding:
      'TypeScript-decoded source text; byte-order marks are removed by the compiler reader',
    changedSinceRead,
    inputs,
    configurations,
    analysisHash: hash(JSON.stringify({ sourceHash, inputs, configurations })),
    typescriptVersion: ts.version
  }
}

function deriveHealth(data) {
  const byId = new Map(data.symbols.map((symbol) => [symbol.id, symbol]))
  const fileById = new Map(data.files.map((file) => [file.id, file]))
  const incoming = new Map(),
    outgoing = new Map()
  for (const edge of data.relationships) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, [])
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, [])
    incoming.get(edge.to).push(edge)
    outgoing.get(edge.from).push(edge)
  }
  const production = (id) => (byId.get(id) || fileById.get(id))?.scope === 'production'
  const fileOf = (id) => byId.get(id)?.location.file || (fileById.has(id) ? id : null)
  const ownerOf = (id) => {
    let current = byId.get(id),
      outerCallable = id
    while (current) {
      if (current.kind === 'class') return current.id
      if (current.kind === 'callable') outerCallable = current.id
      current = byId.get(current.parent)
    }
    return outerCallable
  }
  const findings = []
  function finding(
    kind,
    subject,
    evidence,
    why,
    justification,
    priority = 2,
    level = 'review'
  ) {
    const item = {
      id: `finding:${hash(JSON.stringify([kind, subject])).slice(0, 16)}`,
      kind,
      subject,
      level,
      priority,
      evidence,
      why,
      possibleJustification: justification,
      location:
        byId.get(subject)?.location ||
        (fileById.has(subject) ? { file: subject, line: 1 } : null)
    }
    findings.push(item)
  }
  for (const symbol of data.symbols) {
    const callers = (incoming.get(symbol.id) || []).filter(
      (edge) => ['calls', 'constructs'].includes(edge.kind) && production(edge.from)
    )
    const out = outgoing.get(symbol.id) || []
    symbol.usage = {
      productionCallers: unique(callers.map((edge) => edge.from)),
      consumers: unique(
        (incoming.get(symbol.id) || [])
          .filter(
            (edge) =>
              production(edge.from) &&
              !['reads-state', 'writes-state'].includes(edge.kind)
          )
          .map((edge) => edge.from)
      ),
      testFiles: unique(
        (incoming.get(symbol.id) || [])
          .filter((edge) => edge.kind === 'test-references')
          .map((edge) => edge.location.file)
      ),
      callees: unique(
        out.filter((edge) => edge.kind === 'calls').map((edge) => edge.to)
      ),
      reads: unique(
        out.filter((edge) => edge.kind === 'reads-state').map((edge) => edge.to)
      ),
      writes: unique(
        out.filter((edge) => edge.kind === 'writes-state').map((edge) => edge.to)
      ),
      implementations: unique(
        (incoming.get(symbol.id) || [])
          .filter((edge) => ['implements', 'extends'].includes(edge.kind))
          .map((edge) => edge.from)
      )
    }
    if (symbol.scope !== 'production') continue
    if (
      symbol.exported &&
      ['callable', 'class'].includes(symbol.kind) &&
      symbol.usage.consumers.filter((id) => id !== symbol.id).length === 0 &&
      !data.subsystems.some((subsystem) =>
        subsystem.entryPoints.includes(symbol.location.file)
      )
    )
      finding(
        'No discovered production consumer',
        symbol.id,
        { testFiles: symbol.usage.testFiles, scope: symbol.scope },
        'No production call, import or symbol reference was resolved to this exported declaration.',
        'Framework entry points, external consumers and unresolved dynamic dispatch may use it. Confirm runtime registration before removal.',
        3
      )
    if (
      symbol.metrics &&
      (symbol.metrics.branches >= 15 ||
        symbol.metrics.maxNesting >= 5 ||
        symbol.metrics.lines >= 120 ||
        symbol.metrics.parameters >= 7)
    ) {
      finding(
        'Complex method',
        symbol.id,
        {
          metrics: symbol.metrics,
          callers: symbol.usage.productionCallers,
          testFiles: symbol.usage.testFiles
        },
        'Branching, nesting or size can make behavior difficult to change safely.',
        'Rule dispatch tables and cohesive algorithms can legitimately be large. Inspect branch responsibilities and related tests.',
        1
      )
    }
    if (symbol.metrics?.exactForwarder) {
      const chain = [symbol.id],
        visited = new Set(chain)
      let current = symbol
      while (current?.metrics?.exactForwarder) {
        const calls = (outgoing.get(current.id) || []).filter(
          (edge) => edge.kind === 'calls'
        )
        if (calls.length !== 1 || visited.has(calls[0].to)) break
        chain.push(calls[0].to)
        visited.add(calls[0].to)
        current = byId.get(calls[0].to)
      }
      finding(
        'Exact forwarding method',
        symbol.id,
        {
          chain,
          consumers: symbol.usage.consumers,
          relationshipIds: out
            .filter((edge) => edge.kind === 'calls')
            .map((edge) => edge.id)
        },
        'Input is forwarded unchanged. A chain of these methods can increase navigation cost.',
        'An adapter may preserve a public API or own behavior elsewhere, including constructor-installed wrappers. Review the enclosing class before removal.',
        chain.length >= 3 ? 1 : 3
      )
    }
    if (
      symbol.kind === 'interface' &&
      symbol.usage.implementations.length <= 1 &&
      data.symbols.some(
        (member) => member.parent === symbol.id && member.kind === 'signature'
      ) &&
      unique(symbol.usage.consumers.map(fileOf)).length <= 2
    )
      finding(
        'Few explicit implementations',
        symbol.id,
        {
          implementations: symbol.usage.implementations,
          consumers: symbol.usage.consumers
        },
        'Check whether this contract isolates a useful boundary or adds unnecessary indirection.',
        'Structural typing, IPC schemas, test seams and stable contracts commonly need no explicit implements clause.',
        3
      )
    if (symbol.kind === 'field') {
      const writes = (incoming.get(symbol.id) || []).filter(
        (edge) => edge.kind === 'writes-state' && production(edge.from)
      )
      const writers = unique(writes.map((edge) => edge.from))
      const owners = unique(writers.map(ownerOf))
      if (owners.length > 1)
        finding(
          'State written by multiple owners',
          symbol.id,
          { writers, owners, relationshipIds: writes.map((edge) => edge.id) },
          'Distributed mutation can make state transitions and invariants difficult to follow.',
          'A shared state model may intentionally be updated by separate rule functions. Check whether writes are serialized and validated.',
          2
        )
    }
  }
  // Member cohesion is an observation, not a universal class quality score.
  for (const parent of data.symbols.filter((symbol) => symbol.kind === 'class')) {
    const methods = data.symbols.filter(
      (symbol) =>
        (symbol.parent === parent.id ||
          (byId.get(symbol.parent)?.kind === 'field' &&
            byId.get(symbol.parent)?.parent === parent.id)) &&
        symbol.metrics &&
        symbol.name !== 'constructor'
    )
    const memberIds = new Set(methods.map((method) => method.id))
    const links = []
    for (const method of methods)
      for (const other of methods) {
        if (method === other) continue
        const fields = [...method.usage.reads, ...method.usage.writes]
        if (
          fields.some((id) =>
            [...other.usage.reads, ...other.usage.writes].includes(id)
          ) ||
          method.usage.callees.includes(other.id) ||
          other.usage.callees.includes(method.id)
        )
          links.push({ from: method.id, to: other.id })
      }
    parent.responsibilityGroups = components([...memberIds], links)
    if (
      parent.scope === 'production' &&
      methods.length >= 8 &&
      parent.responsibilityGroups.length >= 3
    )
      finding(
        'Separate member groups',
        parent.id,
        { methodCount: methods.length, groups: parent.responsibilityGroups },
        'Several method groups share neither resolved field access nor direct member calls.',
        'Lifecycle adapters and stateless utility classes can have independent methods intentionally. Callback and alias gaps can split groups artificially.',
        2
      )
  }
  const imports = data.relationships.filter(
    (edge) =>
      ['imports-value', 'imports-type', 'imports-dynamic', 're-exports'].includes(
        edge.kind
      ) &&
      fileById.has(edge.from) &&
      fileById.has(edge.to) &&
      production(edge.from) &&
      production(edge.to)
  )
  const ids = data.files
    .filter((file) => file.scope === 'production')
    .map((file) => file.id)
  const runtimeImports = imports.filter(
    (edge) =>
      edge.kind !== 'imports-type' && edge.kind !== 'imports-dynamic' && !edge.typeOnly
  )
  const cyclic = (edges) =>
    components(ids, edges).filter(
      (group) =>
        group.length > 1 ||
        edges.some((edge) => edge.from === group[0] && edge.to === group[0])
    )
  const runtimeGroups = cyclic(runtimeImports)
  data.cycles = [
    ...runtimeGroups.map((members) => ({
      kind: 'value-import-component',
      members,
      relationshipIds: runtimeImports
        .filter((edge) => members.includes(edge.from) && members.includes(edge.to))
        .map((edge) => edge.id)
    })),
    ...cyclic(imports.filter((edge) => edge.kind !== 'imports-dynamic'))
      .filter(
        (group) =>
          !runtimeGroups.some(
            (runtime) =>
              runtime.length === group.length &&
              runtime.every((id) => group.includes(id))
          )
      )
      .map((members) => ({
        kind: 'type-involved-component',
        members,
        relationshipIds: imports
          .filter(
            (edge) =>
              edge.kind !== 'imports-dynamic' &&
              members.includes(edge.from) &&
              members.includes(edge.to)
          )
          .map((edge) => edge.id)
      }))
  ]
  for (const cycle of data.cycles)
    finding(
      cycle.kind,
      cycle.members[0],
      cycle,
      'These files form a strongly connected component. Inspect the concrete internal edges.',
      'Type-involved components can be harmless contracts; value imports do not prove initialization failure.',
      1
    )
  for (const violation of data.boundaryViolations)
    finding(
      `Boundary: ${violation.rule?.name || 'unknown'}`,
      violation.from || 'repository',
      violation,
      'A configured dependency rule was violated.',
      'If the boundary is intentional, review the rule and the architecture contract together.',
      0,
      violation.rule?.severity === 'error' ? 'violation' : 'review'
    )
  const reverse = new Map(ids.map((id) => [id, new Set()]))
  for (const edge of imports) reverse.get(edge.to)?.add(edge.from)
  for (const file of data.files) {
    const direct = unique(
      (incoming.get(file.id) || [])
        .filter(
          (edge) =>
            ['imports-value', 'imports-type', 'imports-dynamic', 're-exports'].includes(
              edge.kind
            ) && production(edge.from)
        )
        .map((edge) => edge.from)
    )
    const reached = new Set(),
      queue = [...direct]
    while (queue.length) {
      const next = queue.pop()
      if (next === file.id || reached.has(next)) continue
      reached.add(next)
      queue.push(...(reverse.get(next) || []))
    }
    file.coupling = {
      dynamicDependencies: unique(
        (outgoing.get(file.id) || [])
          .filter((edge) => edge.kind === 'imports-dynamic')
          .map((edge) => edge.to)
      ),
      directImporters: direct,
      potentialTransitiveImporters: [...reached].sort(),
      valueDependencies: unique(
        (outgoing.get(file.id) || [])
          .filter((edge) => edge.kind === 'imports-value')
          .map((edge) => edge.to)
      ),
      typeDependencies: unique(
        (outgoing.get(file.id) || [])
          .filter((edge) => edge.kind === 'imports-type')
          .map((edge) => edge.to)
      )
    }
    file.testFiles = unique(
      data.relationships
        .filter(
          (edge) => edge.kind === 'test-references' && fileOf(edge.to) === file.id
        )
        .map((edge) => edge.location.file)
    )
  }
  for (const symbol of data.symbols.filter(
    (item) => item.scope === 'production' && item.metrics?.branches >= 15
  )) {
    const callerSubsystems = unique(
      symbol.usage.productionCallers.map((id) => byId.get(id)?.subsystem || 'unmapped')
    )
    if (callerSubsystems.length >= 2)
      finding(
        'Complex behavior used across subsystems',
        symbol.id,
        {
          callerSubsystems,
          callers: symbol.usage.productionCallers,
          potentialFileImpact: fileById.get(symbol.location.file)?.coupling
            .potentialTransitiveImporters
        },
        'Branch-heavy behavior has direct callers in multiple ownership areas.',
        'A central domain operation may be the correct shared boundary. Transitive import reach is only a potential impact estimate.',
        1
      )
  }
  data.classification = {
    unmapped: data.files
      .filter((file) => file.subsystem === 'unmapped')
      .map((file) => file.id),
    overlaps: data.files
      .filter((file) => file.subsystemMatches.length > 1)
      .map((file) => ({
        file: file.id,
        selected: file.subsystem,
        matches: file.subsystemMatches
      })),
    missingEntryPoints: data.subsystems.flatMap((subsystem) =>
      subsystem.entryPoints
        .filter((file) => !fileById.has(file))
        .map((file) => ({ subsystem: subsystem.id, file }))
    )
  }
  data.findings = findings.sort(
    (a, b) =>
      a.priority - b.priority ||
      a.kind.localeCompare(b.kind) ||
      (b.evidence.metrics?.branches || 0) - (a.evidence.metrics?.branches || 0) ||
      (b.evidence.metrics?.lines || 0) - (a.evidence.metrics?.lines || 0) ||
      (b.evidence.chain?.length || 0) - (a.evidence.chain?.length || 0) ||
      a.subject.localeCompare(b.subject)
  )
  data.thresholds = {
    complexMethod: 'branches >= 15 OR nesting >= 5 OR lines >= 120 OR parameters >= 7',
    separateMemberGroups:
      'at least 8 methods and 3 disconnected groups, excluding constructors',
    multipleStateOwners:
      'at least 2 distinct classes or outer functions; nested callbacks share their enclosing owner',
    fewImplementations:
      'behavioral interface with at most 1 explicit implementation and at most 2 production consumer files; excludes data-only interfaces',
    unreferencedExport:
      'exported function/class without resolved production consumers, outside registered entry-point files; not proof of dead code',
    forwarding: 'single return of call with exactly the original parameters in order',
    priority:
      '0 configured boundary, 1 complex/cyclic/long forwarding, 2 ownership/cohesion, 3 abstraction review. No aggregate health score.'
  }
}

module.exports = { analyzeCodebase, components, methodMetrics }
