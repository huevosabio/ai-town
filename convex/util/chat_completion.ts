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

type LLMModel = 'gpt-4-0613' | 'gpt-4' | 'gpt-4-32k' | 'gpt-4-32k-0613' | 'gpt-3.5-turbo' | 'gpt-3.5-turbo-0613' | 'gpt-3.5-turbo-16k' | 'gpt-3.5-turbo-16k-0613' | undefined;

// this function wraps the chat completion function and logs the call to the LLM service
export const chatCompletionWithLogging = async (params: chatCompletionWithLoggingRequest) => {
  const {game_id, character_id, target_char_ids, call_type, ...chatCompletionRequest} = params; 
  //const chatCompletionRequest = params as Omit<CreateChatCompletionRequest, 'model'>;
  const model: LLMModel = process.env.LLM_MODEL_ID as LLMModel;
  const response = await chatCompletion({...chatCompletionRequest, model, stream: false}); // set stream to false
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
  callLlmService(logPayload);
  return response;
};