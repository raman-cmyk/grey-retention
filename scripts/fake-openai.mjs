// Local-only test double for the OpenAI Responses API used by browser tests.
// It never forwards anything; responses are deterministic and clearly fake.
import { createServer } from 'node:http'

const port = Number(process.env.FAKE_OPENAI_PORT ?? 3199)
const calls = []

function reply(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'x-request-id': 'req_fake',
    ...headers
  })
  res.end(JSON.stringify(body))
}

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health')
    return reply(res, 200, { ok: true })
  if (req.method === 'GET' && req.url === '/calls')
    return reply(res, 200, calls)
  if (req.method !== 'POST' || req.url !== '/v1/responses')
    return reply(res, 404, { error: { code: 'not_found' } })
  let raw = ''
  req.setEncoding('utf8')
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    const body = JSON.parse(raw)
    const input = JSON.parse(body.input)
    const source = `${input.source_email.subject} ${input.source_email.text}`
    calls.push({
      subject: input.source_email.subject,
      store: body.store,
      strict: body.text?.format?.strict,
      authorized: req.headers.authorization === 'Bearer local-fake-openai-key'
    })
    if (/FAKE_REFUSE/.test(source))
      return reply(res, 200, {
        id: 'resp_fake_refusal',
        status: 'completed',
        usage: { input_tokens: 500, output_tokens: 10 },
        output: [
          {
            type: 'message',
            content: [{ type: 'refusal', refusal: 'Declined by test double.' }]
          }
        ]
      })
    const name = input.brand.name
    const output = {
      subject: `Fresh layers from ${name}`,
      alternative_subjects: [
        `A quiet note from ${name}`,
        `${name}: new this week`
      ],
      preheader: 'Made for slow weekends.',
      body: `Hello from ${name}.\n\nOur new layers are made for slow weekends.`,
      cta_label: 'See what is new',
      cta_url: input.allowed_links[0],
      segments: input.source_email.segments.map((s, i) => ({
        id: s.id,
        text: i === 0 ? `${name} spring` : 'Layers made for slow weekends.'
      })),
      review_notes: ['Test double output, not a real model.']
    }
    reply(res, 200, {
      id: `resp_fake_${calls.length}`,
      model: body.model,
      status: 'completed',
      usage: {
        input_tokens: 1500,
        output_tokens: 400,
        input_tokens_details: { cached_tokens: 0 }
      },
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(output) }]
        }
      ]
    })
  })
}).listen(port, '127.0.0.1')
