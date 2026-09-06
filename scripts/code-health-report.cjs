const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  )

function markdownReport(data) {
  const symbols = new Map(data.symbols.map((symbol) => [symbol.id, symbol]))
  const relationships = new Map(data.relationships.map((edge) => [edge.id, edge]))
  const lines = [
    '# Code health evidence',
    '',
    `Generated: ${data.generatedAt}. Analyzer: ${data.analyzerVersion}. TypeScript: ${data.snapshot.typescriptVersion}.`,
    `Commit: ${data.snapshot.commit || 'unavailable'}; dirty worktree: ${data.snapshot.dirty}.`,
    `Source SHA-256: ${data.snapshot.sourceHash}. Analysis SHA-256: ${data.snapshot.analysisHash}.`,
    '',
    '## Scope and confidence',
    '',
    `${data.files.length} files, ${data.symbols.length} symbols, ${data.relationships.length} relationships.`,
    `${data.diagnostics.length} compiler diagnostics; ${data.unresolved.length} unresolved call sites. Diagnostics can reduce resolution accuracy.`,
    `Coverage: ${data.scope.coverage}. ${data.scope.tests}`,
    ...(data.snapshot.changedSinceRead?.length
      ? [
          `Source changed during analysis: ${data.snapshot.changedSinceRead.join(', ')}. Regenerate before treating this as the current checkout.`
        ]
      : []),
    '',
    ...data.scope.limitations.map((item) => `- ${item}`),
    '',
    '## How to use this report',
    '',
    'A review candidate is not a defect or a recommendation to delete code. Open atlas.html to inspect incoming/outgoing relationships, state, callers, and tests. code-health.json contains every finding and relationship, with source locations and evidence categories. Value imports are source dependencies, not proof of emitted code or execution.',
    '',
    '## Classification gaps',
    '',
    `${data.classification.unmapped.length} unmapped files; ${data.classification.overlaps.length} overlapping registry matches; ${data.classification.missingEntryPoints.length} missing registered entry points. Complete lists are in code-health.json and the atlas.`,
    '',
    '## Detection rules',
    '',
    ...Object.entries(data.thresholds).map(([key, value]) => `- **${key}:** ${value}`),
    '',
    '## Review queue',
    '',
    `${data.findings.length} findings. All findings are included, ordered by priority and category, then descending branch count, size or forwarding-chain length, then name. This is not a health score.`,
    ''
  ]
  for (const finding of data.findings) {
    const subject = symbols.get(finding.subject)
    const evidenceSites = (finding.evidence.relationshipIds || [])
      .map((id) => relationships.get(id))
      .filter(Boolean)
    lines.push(
      `### ${finding.kind}: ${symbols.get(finding.subject)?.qualifiedName || finding.subject}`,
      '',
      `ID: ${finding.id}. Level: ${finding.level}. Priority: ${finding.priority}.`,
      finding.location
        ? `Inspect: ${finding.location.file}:${finding.location.line}.`
        : 'Inspect boundary evidence below.',
      '',
      finding.why,
      '',
      `**Possible justification:** ${finding.possibleJustification}`,
      '',
      '```json',
      JSON.stringify(finding.evidence, null, 2),
      '```',
      ...evidenceSites.map(
        (edge) =>
          `- ${edge.kind}: ${symbols.get(edge.from)?.qualifiedName || edge.from} → ${symbols.get(edge.to)?.qualifiedName || edge.to}; ${edge.evidence}; ${edge.location.file}:${edge.location.line}`
      ),
      ...(subject?.excerpt
        ? [
            '',
            `Source excerpt${subject.excerptTruncated ? ' (truncated; inspect the source for the complete implementation)' : ''}:`,
            '',
            '```typescript',
            subject.excerpt,
            '```'
          ]
        : []),
      ''
    )
  }
  lines.push(
    '## Supplemental narratives',
    '',
    'Curated flows in code-health.json are manually annotated and unverified, never generated call evidence.',
    ''
  )
  return lines.join('\n')
}

// Serialized into standalone HTML; no runtime package or network dependency.
/* eslint-disable no-undef */
function mountAtlas(data, focus) {
  const $ = (selector) => document.querySelector(selector)
  const nodes = new Map(
    [...data.files, ...data.symbols, ...data.externalTargets].map((node) => [
      node.id,
      node
    ])
  )
  const incoming = new Map(),
    outgoing = new Map()
  for (const edge of data.relationships) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, [])
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, [])
    incoming.get(edge.to).push(edge)
    outgoing.get(edge.from).push(edge)
  }
  const label = (id) => nodes.get(id)?.qualifiedName || nodes.get(id)?.name || id
  const esc = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
    )
  const button = (id) =>
    `<button class="node-link" data-node="${esc(id)}">${esc(label(id))}</button>`
  const sourceLink = (loc) =>
    loc
      ? `<a href="../../${encodeURI(loc.file).replace(/#/g, '%23')}#L${loc.line}" title="Source file; copy the displayed line if your viewer does not support line anchors">${esc(loc.file)}:${loc.line}</a>`
      : ''
  const json = (value) => `<pre>${esc(JSON.stringify(value, null, 2))}</pre>`
  let page = 0,
    view = focus ? 'symbols' : 'findings'
  const pageSize = 40
  function paging(items, render) {
    const maxPage = Math.max(0, Math.ceil(items.length / pageSize) - 1)
    page = Math.min(page, maxPage)
    return `<p>${items.length} results. Page ${page + 1} of ${maxPage + 1}. <button data-page="-1" ${page === 0 ? 'disabled' : ''}>Previous</button> <button data-page="1" ${page === maxPage ? 'disabled' : ''}>Next</button></p>${items
      .slice(page * pageSize, (page + 1) * pageSize)
      .map(render)
      .join('')}`
  }
  function matches(item) {
    const query = $('#search').value.toLowerCase(),
      scope = $('#scope').value
    const node = nodes.get(item.subject) || item
    return (
      (!scope || node.scope === scope || item.level === 'violation') &&
      (!query ||
        JSON.stringify(item).toLowerCase().includes(query) ||
        label(item.subject || item.id)
          .toLowerCase()
          .includes(query)) &&
      (!focus || new RegExp(focus).test(node.location?.file || node.id || ''))
    )
  }
  function edgeTable(edges) {
    return `<table><thead><tr><th>From → To</th><th>Relationship</th><th>Evidence / source</th></tr></thead><tbody>${edges.map((edge) => `<tr><td>${button(edge.from)} → ${button(edge.to)}</td><td>${esc(edge.kind)}${edge.dispatch ? `<br>${esc(edge.dispatch)}` : ''}</td><td>${esc(edge.evidence)}<br>${sourceLink(edge.location)}${edge.reason ? `<br>${esc(edge.reason)}` : ''}</td></tr>`).join('')}</tbody></table>`
  }
  function showNode(id) {
    const node = nodes.get(id) || { id },
      inEdges = incoming.get(id) || [],
      outEdges = outgoing.get(id) || []
    $('#details').innerHTML =
      `<h2>${esc(label(id))}</h2>${sourceLink(node.location || (node.hash ? { file: id, line: 1 } : null))}<p>${esc([node.kind, node.scope, node.process, node.layer, node.subsystem].filter(Boolean).join(' · '))}</p><p>${esc(node.signature || '')}</p><div id="neighborhood"></div><details open><summary>Metrics and usage</summary>${json(node.metrics || node.coupling || {})}${json(node.usage || {})}</details>${node.responsibilityGroups ? `<details><summary>Member responsibility groups</summary>${node.responsibilityGroups.map((group) => `<p>${group.map(button).join(' ')}</p>`).join('')}</details>` : ''}<details><summary>Incoming relationships (${inEdges.length})</summary>${edgeTable(inEdges)}</details><details><summary>Outgoing relationships (${outEdges.length})</summary>${edgeTable(outEdges)}</details>`
    const members = data.symbols.filter((member) => member.parent === id)
    if (members.length)
      $('#details').innerHTML +=
        `<details open><summary>Declared members (${members.length})</summary>${members.map((member) => `<p>${button(member.id)} · ${esc(member.kind)}</p>`).join('')}</details>`
    if (node.parent && nodes.has(node.parent))
      $('#details').innerHTML += `<p>Declared in ${button(node.parent)}</p>`
    if (node.excerpt)
      $('#details').innerHTML +=
        `<details><summary>Source excerpt${node.excerptTruncated ? ' (truncated)' : ''}</summary><pre>${esc(node.excerpt)}</pre></details>`
    drawGraph($('#neighborhood'), [...inEdges, ...outEdges].slice(0, 24), id)
  }
  function drawGraph(container, edges, center) {
    const ids = [...new Set([center, ...edges.flatMap((edge) => [edge.from, edge.to])])]
    const height = Math.max(280, ids.length * 38)
    const positions = new Map(
      ids.map((id, index) => [
        id,
        { x: id === center ? 30 : 430, y: id === center ? height / 2 : 30 + index * 36 }
      ])
    )
    container.innerHTML = `<p>Arrows follow relationship direction. Dashed = inferred. Drawing shows ${edges.length} relationships; the tables retain all relationships.</p><svg viewBox="0 0 850 ${height + 40}" role="img" aria-label="Relationship neighborhood"><defs><marker id="head" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#91bcec"/></marker></defs>${edges
      .map((edge) => {
        const from = positions.get(edge.from),
          to = positions.get(edge.to)
        return `<path d="M${from.x + 10},${from.y} Q250,${from.y - 15} ${to.x + 10},${to.y}" fill="none" stroke="#91bcec" ${edge.evidence === 'inferred' ? 'stroke-dasharray="5 4"' : ''} marker-end="url(#head)"><title>${esc(edge.kind)}: ${esc(edge.evidence)}</title></path>`
      })
      .join('')}${ids
      .map((id) => {
        const point = positions.get(id)
        return `<g data-node="${esc(id)}" tabindex="0" role="button" aria-label="${esc(label(id))}"><circle cx="${point.x}" cy="${point.y}" r="6" fill="#ffd083"/><text x="${point.x + 12}" y="${point.y + 4}" fill="#eef4ff" font-size="11">${esc(label(id).slice(-50))}</text><title>${esc(label(id))}</title></g>`
      })
      .join('')}</svg>`
  }
  function render() {
    document
      .querySelectorAll('[data-view]')
      .forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view))
    const panel = $('#results')
    if (view === 'findings')
      panel.innerHTML = paging(
        data.findings.filter(matches),
        (item) =>
          `<article class="${item.level}"><p>Priority ${item.priority} · ${esc(item.level)}</p><h2>${esc(item.kind)}</h2>${button(item.subject)}<p>${sourceLink(item.location)}</p><p>${esc(item.why)}</p><p><strong>Possible justification:</strong> ${esc(item.possibleJustification)}</p><details><summary>Observed evidence</summary>${json(item.evidence)}</details></article>`
      )
    else if (view === 'symbols')
      panel.innerHTML = paging(
        [...data.symbols, ...data.files].filter(matches),
        (node) =>
          `<article>${button(node.id)}<p>${esc([node.kind || 'file', node.scope, node.subsystem].join(' · '))}</p>${sourceLink(node.location)}${node.metrics ? `<p>${node.metrics.lines} lines · ${node.metrics.branches} branches · nesting ${node.metrics.maxNesting} · ${node.usage.productionCallers.length} production callers · ${node.usage.testFiles.length} test files</p>` : ''}</article>`
      )
    else if (view === 'state')
      panel.innerHTML = paging(
        data.symbols.filter((node) => node.kind === 'field' && matches(node)),
        (node) =>
          `<article>${button(node.id)}<p>${(incoming.get(node.id) || []).filter((edge) => edge.kind === 'writes-state').length} write sites · ${(incoming.get(node.id) || []).filter((edge) => edge.kind === 'reads-state').length} read sites</p></article>`
      )
    else if (view === 'subsystems') {
      const groups = [
        ...new Set(
          data.files
            .filter(matches)
            .map((file) => `${file.subsystem} / ${file.process} / ${file.layer}`)
        )
      ].sort()
      panel.innerHTML =
        '<h2>Subsystems by process and layer</h2><p>Cells preserve architectural boundaries; select files to inspect their connections.</p>' +
        groups
          .map((group) => {
            const files = data.files.filter(
              (file) =>
                matches(file) &&
                `${file.subsystem} / ${file.process} / ${file.layer}` === group
            )
            return `<details><summary>${esc(group)} (${files.length} files)</summary>${files.map((file) => `<p>${button(file.id)}</p>`).join('')}</details>`
          })
          .join('')
      const groupsByFile = new Map(
          data.files.map((file) => [
            file.id,
            `${file.subsystem} / ${file.process} / ${file.layer}`
          ])
        ),
        pairs = new Map()
      for (const edge of data.relationships.filter(
        (edge) =>
          ['imports-value', 'imports-type', 'imports-dynamic', 're-exports'].includes(
            edge.kind
          ) &&
          nodes.get(edge.from)?.scope === 'production' &&
          nodes.get(edge.to)?.scope === 'production'
      )) {
        const from = groupsByFile.get(edge.from),
          to = groupsByFile.get(edge.to)
        if (!groups.includes(from) && !groups.includes(to)) continue
        const key = JSON.stringify([from, to, edge.kind])
        if (!pairs.has(key)) pairs.set(key, { from, to, kind: edge.kind, count: 0 })
        pairs.get(key).count++
      }
      panel.innerHTML += `<h2>Production boundary connections</h2><table><thead><tr><th>From</th><th>To</th><th>Kind</th><th>Sites</th></tr></thead><tbody>${[...pairs.values()].map((pair) => `<tr><td>${esc(pair.from)}</td><td>${esc(pair.to)}</td><td>${esc(pair.kind)}</td><td>${pair.count}</td></tr>`).join('')}</tbody></table>`
    } else if (view === 'confidence')
      panel.innerHTML = `<h2>Snapshot and analysis scope</h2>${json(data.snapshot)}${json(data.scope)}<h2>Detection thresholds</h2>${json(data.thresholds)}<h2>Classification gaps</h2>${json(data.classification)}<details><summary>Compiler diagnostics (${data.diagnostics.length})</summary>${json(data.diagnostics)}</details><details><summary>Unresolved calls (${data.unresolved.length})</summary>${json(data.unresolved)}</details><details><summary>Manually annotated, unverified narratives</summary>${json(data.curatedFlows)}</details>`
  }
  document.addEventListener('click', (event) => {
    const node = event.target.closest('[data-node]')
    if (node) {
      showNode(node.dataset.node)
      return
    }
    const tab = event.target.closest('[data-view]')
    if (tab) {
      view = tab.dataset.view
      page = 0
      render()
      return
    }
    const pager = event.target.closest('[data-page]')
    if (pager) {
      page += Number(pager.dataset.page)
      render()
    }
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('g[data-node]'))
      showNode(event.target.dataset.node)
  })
  $('#search').addEventListener('input', () => {
    page = 0
    render()
  })
  $('#scope').addEventListener('change', () => {
    page = 0
    render()
  })
  render()
}
/* eslint-enable no-undef */

function atlasHtml(data, focus = null) {
  const serialized = JSON.stringify(JSON.stringify(data))
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  // Parsing JSON avoids compiling tens of thousands of records as JavaScript code.
  const payload = `JSON.parse(${serialized})`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Code health evidence</title><style>
  :root{color-scheme:dark;font:15px/1.5 system-ui;background:#101725;color:#e5edf9}*{box-sizing:border-box}body{margin:0}header{padding:24px;border-bottom:1px solid #40516a}a{color:#9bcaff}h1{margin:0}h2{font-size:18px}nav{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}button,input,select{font:inherit;padding:7px 10px;background:#23334d;color:inherit;border:1px solid #59718f;border-radius:5px}button{cursor:pointer}button.active{background:#3b5d8b}button:disabled{opacity:.4;cursor:default}.node-link{background:transparent;border:0;padding:0;text-align:left;color:#9bcaff;overflow-wrap:anywhere}main{display:grid;grid-template-columns:minmax(350px,1fr) minmax(400px,1fr);gap:24px;padding:24px}article,details{border:1px solid #40516a;border-radius:6px;padding:12px;margin-bottom:12px}article.violation{border-color:#ff8e8e}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:500px;overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}td,th{text-align:left;padding:8px;border-bottom:1px solid #40516a;overflow-wrap:anywhere}svg{width:100%;min-height:250px}g[role=button]{cursor:pointer}#details,#results{min-width:0}p{overflow-wrap:anywhere}.muted{color:#b3c0d2}@media(max-width:1000px){main{grid-template-columns:1fr}}input{width:min(500px,100%)}
  </style></head><body><header><h1>Code health evidence${focus ? ' — focused view' : ''}</h1><p>${data.files.length} files · ${data.symbols.length} symbols · ${data.findings.length} review findings · ${data.diagnostics.length} compiler diagnostics · ${data.unresolved.length} unresolved calls</p><p class="muted">Review candidates are hypotheses. Test references are not coverage. Snapshot ${escapeHtml(data.snapshot.sourceHash.slice(0, 12))} · ${escapeHtml(data.generatedAt)}</p><a href="health-report.md">Audit report</a> · <a href="code-health.json">Complete evidence JSON</a> · <a href="boundary-violations.html">Boundary violations</a><nav><button data-view="findings">Review queue</button><button data-view="symbols">Methods and files</button><button data-view="state">State ownership</button><button data-view="subsystems">Subsystems</button><button data-view="confidence">Scope and confidence</button></nav><label>Search <input id="search" placeholder="Method, file, finding, subsystem…"></label> <label>Scope <select id="scope"><option value="production">Production</option><option value="">All scopes</option><option value="test">Tests</option><option value="development">Development</option><option value="declaration">Declarations</option></select></label></header><main><section id="results"></section><aside id="details"><h2>Inspect a relationship</h2><p>Select a finding subject, method, field, or file to see evidence, relationships, and a local graph.</p></aside></main><script>(${mountAtlas.toString()})(${payload},${JSON.stringify(focus).replace(/</g, '\\u003c')});</script></body></html>`
}

function boundaryHtml(data) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Boundary violations</title><body><h1>Configured boundary violations</h1><p><a href="atlas.html">Open code health atlas</a></p><p>${data.boundaryViolations.length} violations reported by dependency-cruiser. Generation continues on rule failures so evidence remains available.</p><pre>${escapeHtml(JSON.stringify(data.boundaryViolations, null, 2))}</pre></body></html>`
}

module.exports = { atlasHtml, markdownReport, boundaryHtml }
