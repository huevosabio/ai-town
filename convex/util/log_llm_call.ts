import { LLMMessage } from './openai.js';

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
}

export const callLlmService = async (payload: RequestPayload) => {
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
  console.log(JSON.stringify(payload));
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Network response was not ok: ${response.statusText}`);
  }
};
