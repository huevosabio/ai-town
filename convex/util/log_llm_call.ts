import { LLMMessage } from './openai.js';
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v, ObjectType} from "convex/values";


export const serializedLLMMessage = {
  content: v.optional(v.string()),
  role: v.union(
    v.literal('system'),
    v.literal('user'),
    v.literal('assistant'),
    v.literal('function'),
  ),
  name: v.optional(v.string()),
  function_call: v.optional(v.object({
    name: v.string(),
    arguments: v.string(),
  })),
}

export type LogggedLLMMessage = ObjectType<typeof serializedLLMMessage>;

export const serializedLLMCall = {
  input: v.array(v.object(serializedLLMMessage)),
  output: v.string(),
  duration_s: v.number(),
  completion_tokens: v.optional(v.number()),
  prompt_tokens: v.optional(v.number()),
  game_id: v.string(),
  character_id: v.string(),
  target_char_ids: v.array(v.string()),
  call_type: v.string(),
  ts: v.string(),
  llm_provider_url: v.optional(v.string()),
  llm_model_id: v.optional(v.string()),
  function_call_name: v.optional(v.string()),
  function_call_arguments: v.optional(v.string()),
}

export type LLMCallLog = ObjectType<typeof serializedLLMCall>;

interface RequestPayload {
  input: LLMMessage[];
  output: string;
  duration_s: number;
  completion_tokens: number | undefined;
  prompt_tokens: number | undefined;
  game_id: string;
  character_id: string;
  target_char_ids: string[];
  call_type: string;
  ts: string;
  llm_provider_url: string | undefined;
  llm_model_id: string | undefined;
  function_call_name?: string | undefined,
  function_call_arguments?: string | undefined,
}

export const callLlmService = async (payload: LLMCallLog) => {
  if (!process.env.LLM_LOGGER_BASE_URL) {
    throw new Error(
      'Missing LLM_LOGGER_URL in environment variables.\n' +
        'Set it in the project settings in the Convex dashboard:\n' +
        '    npx convex dashboard\n or https://dashboard.convex.dev',
    );
  }
  const url = process.env.LLM_LOGGER_BASE_URL + '/api/log_llm_call';
  const headers = {
    'Content-Type': 'application/json',
  };
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Network response was not ok: ${response.statusText}`);
  }
};

export const logLLMCall = internalAction({
  args: {
    llm_payload: v.object(serializedLLMCall),
  },
  handler: async (ctx, args) => {
    await callLlmService(args.llm_payload);
  },
});
