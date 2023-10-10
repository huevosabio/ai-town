import { chatCompletion, CreateChatCompletionRequest } from './openai.js';
import { callLlmService } from './log_llm_call.js';

interface AdditionalParams {
    game_id: string;
    character_id: string;
    target_char_ids: string[];
    call_type: string;
}

const msToSeconds = (ms: number) => ms / 1000;
type chatCompletionWithLoggingRequest = Omit<CreateChatCompletionRequest, 'model'> & AdditionalParams;

// this function wraps the chat completion function and logs the call to the LLM service
export const chatCompletionWithLogging = async (params: chatCompletionWithLoggingRequest) => {
  const {game_id, character_id, target_char_ids, call_type, ...chatCompletionRequest} = params; 
  //const chatCompletionRequest = params as Omit<CreateChatCompletionRequest, 'model'>;
  const response = await chatCompletion(chatCompletionRequest);
  const logPayload = {
    input: params.messages,
    output: response.content,
    duration_s: msToSeconds(response.ms),
    completion_tokens: response.usage?.completion_tokens,
    prompt_tokens: response.usage?.prompt_tokens,
    game_id: game_id,
    character_id: character_id,
    target_char_ids: target_char_ids,
    call_type: call_type,
    ts: new Date().toISOString(),
    llm_provider_url: process.env.OPENAI_API_BASE,
    llm_model_id: process.env.LLM_MODEL_ID,
  };
  const promise = callLlmService(logPayload);
  return response;
};