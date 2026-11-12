// Jarvis' AI path: OpenFinance's OpenAI-compatible inference endpoint
// (OpenRouter models behind it), paid from the key's AI credits.
// All calls go through the same-origin pass-through /api/of?path=..., because
// api.openfinance.tech does not allow direct browser calls from other sites.

import { OfError as AiError, ofCall as of } from './ofapi'

/** A model Jarvis can run. `reasoning`: 'off' answers straight away; 'low' is for
    models that always think first (they refuse to switch it off), kept short so
    the answer still fits. Speeds were measured on a trade-plan question. */
export interface AiModel {
  id: string
  label: string
  bestFor: string
  speed: string
  cost: 1 | 2 | 3 | 4 // relative price per answer: 1 = cheapest
  reasoning: 'off' | 'low'
}

export const AI_MODELS: AiModel[] = [
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', bestFor: 'Quick reads and everyday questions', speed: '~6 s', cost: 1, reasoning: 'off' },
  { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna', bestFor: 'Fast, short, to the point', speed: '~5 s', cost: 1, reasoning: 'off' },
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', bestFor: 'Cheapest; long explanations', speed: '~6 s', cost: 1, reasoning: 'off' },
  { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', bestFor: 'Fast with a bit of thinking', speed: '~7 s', cost: 2, reasoning: 'low' },
  { id: 'x-ai/grok-4.7', label: 'Grok 4.7', bestFor: 'Blunt takes and market chatter', speed: '~12 s', cost: 2, reasoning: 'low' },
  { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', bestFor: 'Sharper trade plans, more scenarios', speed: '~8 s', cost: 3, reasoning: 'low' },
  { id: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra', bestFor: 'Structured plans and strategy', speed: '~6 s', cost: 3, reasoning: 'off' },
  { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5', bestFor: 'Deepest analysis; big decisions', speed: '~15 s', cost: 4, reasoning: 'low' },
]

const MODEL_STORE = 'tia.ai.model'

export function getModel(): AiModel {
  let id = ''
  try {
    id = localStorage.getItem(MODEL_STORE) ?? ''
  } catch {
    /* storage blocked: use the default */
  }
  return AI_MODELS.find((m) => m.id === id) ?? AI_MODELS[0]
}

export function saveModel(id: string): void {
  try {
    localStorage.setItem(MODEL_STORE, id)
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
}

export const costLabel = (c: number) => '$'.repeat(c)

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export { OfError as AiError } from './ofapi'

const UNREACHABLE = "Couldn't reach OpenFinance just now. Check your internet connection, then ask again."
const KEY_REJECTED = "OpenFinance didn't accept your key. Add it again with the key button (top right), or create a new one on openfinance.tech."
const NO_CREDITS = "You're out of AI credits. Top up on openfinance.tech, then ask again."
const IDLE_MS = 45_000 // no data for this long means the model has stalled

/** Turns any failure into one plain-English sentence that says what to do next. */
function errorFor(status: number, body: any, model?: AiModel): AiError {
  const name = model?.label ?? 'The AI'
  if (status === 401 || status === 403) return new AiError(KEY_REJECTED, status)
  if (status === 402) return new AiError(NO_CREDITS, status)
  if (status === 0 || status === 502 || status === 503 || status === 504 || body?.error === 'upstream unreachable') {
    return new AiError(UNREACHABLE, status)
  }
  if (status === 408) return new AiError(`${name} took too long to answer. Ask again, or pick a faster model from the menu.`, status)
  if (status === 429) return new AiError(`${name} is busy right now. Wait a few seconds and ask again, or pick another model.`, status)
  if (status >= 400 && status < 500) return new AiError(`${name} isn't working right now. Pick another model from the menu and ask again.`, status)
  return new AiError(`${name} couldn't answer this time. Ask again, or pick another model from the menu.`, status)
}

async function readError(res: Response, model?: AiModel): Promise<AiError> {
  const body = await res.json().catch(() => null)
  return errorFor(res.status, body, model)
}

/** AI calls only: one quiet retry when the connection to OpenFinance drops.
    Never used for orders, so a blip can never send an order twice. */
async function ofRetry(path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await of(path, init)
      if (attempt === 0 && (res.status === 502 || res.status === 503 || res.status === 504)) throw new Error('gateway')
      return res
    } catch (e) {
      if (init.signal?.aborted || e instanceof AiError) throw e
      if (attempt >= 1) throw new AiError(UNREACHABLE, 0)
      await new Promise((r) => setTimeout(r, 700))
    }
  }
}

/** AI credit balance for the key; also proves the key works. */
export async function fetchCredits(): Promise<number> {
  const res = await ofRetry('agent/chat/credits')
  if (!res.ok) throw await readError(res)
  const body = await res.json()
  const n = Number(body?.data?.availableCredits)
  if (!Number.isFinite(n)) throw new AiError("Couldn't read your AI credit balance. Try again in a moment.", res.status)
  return n
}

/** Streams a chat completion; calls onDelta with each new piece of text.
    `cut`: the model ran out of room. `stopped`: the connection dropped part way
    through, so the text is incomplete. Every failure throws an AiError whose
    message is a plain sentence for the user. */
export async function streamChat(
  model: AiModel,
  messages: ChatMsg[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string; cut: boolean; stopped: boolean }> {
  // our own abort, so a stalled model can be timed out; the caller's still works
  const ctl = new AbortController()
  const onAbort = () => ctl.abort()
  signal?.addEventListener('abort', onAbort)
  let timedOut = false
  let idle: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    clearTimeout(idle)
    idle = setTimeout(() => {
      timedOut = true
      ctl.abort()
    }, IDLE_MS)
  }

  let full = ''
  let cut = false
  let streamError: { code: number } | null = null
  const handle = (line: string) => {
    const data = line.startsWith('data:') ? line.slice(5).trim() : ''
    if (!data || data === '[DONE]') return
    let json: any
    try {
      json = JSON.parse(data)
    } catch {
      return // keep-alive comments and partial frames
    }
    if (json?.error) {
      streamError = { code: Number(json.error.code) || 500 }
      return
    }
    const choice = json?.choices?.[0]
    const piece = choice?.delta?.content
    if (piece) {
      full += piece
      onDelta(piece)
    }
    if (choice?.finish_reason === 'length') cut = true
    if (choice?.finish_reason === 'error') streamError ??= { code: 500 }
  }

  try {
    arm()
    const res = await ofRetry('agent/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: model.id,
        stream: true,
        // room for the answer plus any thinking the model does first
        max_tokens: 4000,
        temperature: 0.3,
        reasoning: model.reasoning === 'off' ? { enabled: false } : { effort: 'low' },
        messages,
      }),
      signal: ctl.signal,
    })
    if (!res.ok || !res.body) throw await readError(res, model)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let stopped = false
    for (;;) {
      arm()
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (e) {
        if (signal?.aborted) throw e
        if (!full) throw timedOut ? errorFor(408, null, model) : errorFor(0, null, model)
        stopped = true // keep what arrived and say it is incomplete
        break
      }
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      // server-sent events: one "data: {...}" per line, blank lines between
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      lines.forEach(handle)
    }
    if (buffer) handle(buffer) // a last frame without a trailing newline
    const err = streamError as { code: number } | null
    if (err && !full) {
      // an error sent inside the answer comes from the model's provider, not your connection
      const c = err.code
      throw c === 401 || c === 403 || c === 402 || c === 429
        ? errorFor(c, null, model)
        : new AiError(`${model.label} isn't responding right now. Ask again, or pick another model from the menu.`, c)
    }
    if (err) stopped = true
    if (!full) {
      throw new AiError(
        cut
          ? `${model.label} ran out of room before it could answer. Ask again, or pick a faster model from the menu.`
          : `${model.label} didn't send an answer. Ask again, or pick another model from the menu.`,
        200,
      )
    }
    return { text: full, cut, stopped }
  } catch (e) {
    if (e instanceof AiError || signal?.aborted) throw e
    throw timedOut ? errorFor(408, null, model) : errorFor(0, null, model)
  } finally {
    clearTimeout(idle)
    signal?.removeEventListener('abort', onAbort)
  }
}
