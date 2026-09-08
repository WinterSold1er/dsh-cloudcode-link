import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import * as coreSse from '../../packages/core/src/sse-mapper.ts'

export * from '../../packages/core/src/sse-mapper.ts'
export const mapSseStreamToChunks: (
  response: Response,
  signal?: AbortSignal,
  onFirstEmit?: () => void,
) => AsyncGenerator<StreamChunk, void, unknown> = coreSse.mapSseStreamToChunks as any
