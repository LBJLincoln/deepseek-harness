/**
 * Render one harness request into the product's prompt inputs: the harness
 * system prompt becomes the query's custom system prompt, and the whole
 * conversation becomes one prompt text in log order. The request's tools are
 * not rendered here — they reach the model as native tools of the query's
 * in-process MCP server.
 *
 * Every output here is a pure function of the request the seam hands over, and
 * that request is itself derived from the session log, so a rendered query is
 * reconstructable from the log.
 *
 * @module @deepseek-ai/dsh-llm-claude-code/render
 */

import { contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { RenderedRequest } from './types.ts'

/** Tag prefix framing the rendered conversation when no content already uses it. */
export const TAG_BASE = 'dsh'

/** One rendering pass: the prompt text plus every verbatim string it embedded. */
interface RenderPass {
  readonly text: string
  readonly contents: readonly string[]
}

/** Collects verbatim strings so a later pass can detect tag-prefix collisions. */
class PromptWriter {
  private readonly lines: string[] = []
  readonly contents: string[] = []

  constructor(private readonly ns: string) {}

  /** Append one framing line the harness owns. */
  structure(line: string): void {
    this.lines.push(line)
  }

  /** Append one verbatim string and record it for collision detection. */
  content(text: string): void {
    this.contents.push(text)
    this.lines.push(text)
  }

  /** Append an opening tag with already-escaped attribute values. */
  open(tag: string, attributes: readonly (readonly [string, string])[] = []): void {
    const rendered = attributes.map(([key, value]) => ` ${key}="${value}"`).join('')
    this.lines.push(`<${this.ns}-${tag}${rendered}>`)
  }

  /** Append a closing tag. */
  close(tag: string): void {
    this.lines.push(`</${this.ns}-${tag}>`)
  }

  /** The rendered pass, newline-joined with a trailing newline. */
  finish(): RenderPass {
    return { text: `${this.lines.join('\n')}\n`, contents: this.contents }
  }
}

/** Join every text block of a message or nested tool result. */
function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks.filter(block => block.type === 'text').map(block => block.text).join('')
}

/**
 * Neutralize the two characters that would end an attribute value or its tag.
 * Ids and tool names are harness-minted, so this only guards against a
 * hand-built request carrying an unexpected value.
 */
function attributeValue(raw: string): string {
  return raw.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

/** Reject content this text-only prompt cannot carry without silently erasing it. */
function assertTextOnly(message: Message): void {
  if (contentHasImage(message.content)) {
    throw new LlmError(
      'llm-claude-code: the Claude Code prompt route does not support image content',
      'UNSUPPORTED_CONTENT',
    )
  }
}

/** Write one assistant message: its visible text, then each tool call it requested. */
function writeAssistant(writer: PromptWriter, message: Message): void {
  writer.open('assistant')
  const text = flattenText(message.content)
  if (text.length > 0) writer.content(text)
  for (const block of message.content) {
    if (block.type !== 'tool-call') continue
    writer.open('tool-call', [['id', attributeValue(block.id)], ['name', attributeValue(block.name)]])
    writer.content(block.arguments)
    writer.close('tool-call')
  }
  writer.close('assistant')
}

/**
 * Write one user-role message. The harness carries each tool result in its own
 * user message, so a message with text and no results is an ordinary user turn.
 */
function writeUser(writer: PromptWriter, message: Message): void {
  const text = flattenText(message.content)
  const results = message.content.filter(block => block.type === 'tool-result')
  if (text.length > 0 || results.length === 0) {
    writer.open('user')
    writer.content(text)
    writer.close('user')
  }
  for (const result of results) {
    writer.open('tool-result', [
      ['id', attributeValue(result.toolCallId)],
      ['status', result.isError === true ? 'error' : 'ok'],
    ])
    writer.content(flattenText(result.content))
    writer.close('tool-result')
  }
}

/** Render the whole prompt text under one tag prefix. */
function renderPass(options: GenerateOptions, ns: string): RenderPass {
  const writer = new PromptWriter(ns)
  writer.structure(
    `Answer the last turn of the conversation below. Elements tagged \`<${ns}-…>\` are the harness's`
    + ' framing; everything between them is the conversation.',
  )
  writer.open('conversation')
  for (const message of options.messages) {
    assertTextOnly(message)
    switch (message.role) {
      case 'system':
        writer.open('system')
        writer.content(flattenText(message.content))
        writer.close('system')
        break
      case 'assistant':
        writeAssistant(writer, message)
        break
      case 'user':
        writeUser(writer, message)
        break
    }
  }
  writer.close('conversation')
  return writer.finish()
}

/**
 * Choose the smallest tag prefix no rendered content already uses, so a
 * message that itself contains the framing cannot be read as framing.
 * @param contents - every verbatim string the first pass embedded.
 * @returns the base prefix, or the first numbered variant free of collisions.
 */
export function tagNamespace(contents: readonly string[]): string {
  let ns = TAG_BASE
  for (
    let suffix = 2;
    contents.some(text => text.includes(`<${ns}`) || text.includes(`</${ns}`));
    suffix += 1
  ) {
    ns = `${TAG_BASE}${suffix}`
  }
  return ns
}

/**
 * Render one harness request into the product's system prompt and prompt text.
 * @param options - the fully assembled harness request.
 * @returns the custom system prompt and the single prompt text carrying the conversation.
 */
export function renderRequest(options: GenerateOptions): RenderedRequest {
  const first = renderPass(options, TAG_BASE)
  const ns = tagNamespace(first.contents)
  return {
    // An absent harness system prompt still replaces the product's preset: the
    // harness owns every standing instruction this route's model reads.
    systemPrompt: options.system ?? '',
    prompt: ns === TAG_BASE ? first.text : renderPass(options, ns).text,
  }
}
