const fs = require('node:fs')
const path = require('node:path')

// Invert the indentation emitted by AiConversationTranscript.readable. Scalar
// mechanics descriptions remain text; this is a public context, not a checkpoint.
function parseReadable(text) {
  const lines = []
  function expand(line) {
    const match = line.match(/^(\s*(?:- |[^:\r\n]+: ))( {2,}\S.*)$/)
    if (match) {
      lines.push(match[1].trimEnd())
      expand(match[2])
    } else if (line.trim()) lines.push(line)
  }
  text.split(/\r?\n/).forEach(expand)
  let index = 0
  const indent = (line) => line.length - line.trimStart().length
  const scalar = (value) =>
    value === 'true'
      ? true
      : value === 'false'
        ? false
        : /^-?\d+(\.\d+)?$/.test(value)
          ? Number(value)
          : value
  function block(depth) {
    const result =
      lines[index].trim() === '-' || lines[index].trimStart().startsWith('- ') ? [] : {}
    while (index < lines.length && indent(lines[index]) === depth) {
      const line = lines[index++].trimStart()
      const array = Array.isArray(result)
      const split = array
        ? null
        : (line.match(/^(.+): (-?\d+(?:\.\d+)?)$/) ?? line.match(/^(.+?):(?: (.*)|$)/))
      if (!array && !split) throw new Error('Cannot parse context line: ' + line)
      const value = array ? line.slice(1).trimStart() : (split[2] ?? '')
      const nested = index < lines.length && indent(lines[index]) > depth
      const parsed = nested ? block(indent(lines[index])) : scalar(value)
      if (array) result.push(parsed)
      else result[split[1]] = parsed
    }
    return result
  }
  const result = block(0)
  if (index !== lines.length) throw new Error('Unconsumed context lines')
  return result
}

function readMatch(prefix) {
  const root = path.resolve('artifacts/match-logs')
  const directory = fs.readdirSync(root).find((name) => name.includes(prefix))
  if (!directory) throw new Error('Missing match ' + prefix)
  const log = JSON.parse(fs.readFileSync(path.join(root, directory, 'ai.json'), 'utf8'))
  const transcript = fs.readFileSync(
    path.join(root, directory, 'ai-conversation.txt'),
    'utf8'
  )
  const contexts = []
  for (const section of transcript.split(/\r?\nTURN /).slice(1)) {
    if (!/^\d+ - REQUEST STARTED/.test(section)) continue
    const requestId = section.match(/\| Request ([^\r\n]+)/)?.[1]
    const text = section.match(
      /CONTEXT RECEIVED\r?\n([\s\S]*?)\r?\n\r?\nSINCE THE PREVIOUS DECISION/
    )?.[1]
    if (!text || !text.startsWith('turn:')) continue
    const state = parseReadable(text)
    const request = log.decisions.find(
      (d) => d.kind === 'request-started' && d.requestId === requestId
    )
    contexts.push({
      requestId,
      revision: request.revision,
      phase: request.phase,
      state,
      text
    })
  }
  return { directory, log, contexts }
}

module.exports = { readMatch, parseReadable }
if (require.main === module) {
  for (const prefix of process.argv.slice(2)) {
    const match = readMatch(prefix)
    for (const context of match.contexts) {
      const players = context.state.players
      const self = players.find((p) => p.role === 'self')
      const enemy = players.find((p) => p.role === 'opponent')
      console.log(
        JSON.stringify({
          match: prefix,
          request: context.requestId.split(':').at(-1),
          turn: context.state.turn,
          phase: context.phase,
          mana: self.mana,
          hand: self.hand?.map((c) => c.name),
          board: self.board?.map((c) => c.name),
          enemy: enemy.board?.map((c) => c.name)
        })
      )
    }
  }
}
