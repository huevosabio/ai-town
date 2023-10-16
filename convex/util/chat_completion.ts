import { chatCompletion, CreateChatCompletionRequest } from './openai.js';
import { callLlmService } from './log_llm_call.js';
import {parseFunctionCall} from './llm_functions.js';

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
  const {game_id, character_id, target_char_ids, call_type, stop, ...chatCompletionRequest} = params; 
  //const chatCompletionRequest = params as Omit<CreateChatCompletionRequest, 'model'>;
  const model: LLMModel = process.env.LLM_MODEL_ID as LLMModel;
  const response = await chatCompletion({...chatCompletionRequest, model, stream: false, stop: []}); // set stream to false
  // remove stop words if it starts with them
  let responseContent = response.content;
  let logged_response_content = response.content;
  let functionCallName = undefined;
  if (response.content !== null){
    // only trim when the content is not null
    if (typeof stop === 'string') {
      if (responseContent.startsWith(stop)) {
        responseContent = responseContent.replace(stop, '');
      }
    } else if (Array.isArray(stop)) {
      stop.forEach(stopWord => {
        if (responseContent.startsWith(stopWord)) {
          responseContent = responseContent.replace(stopWord, '');
        }
      });
    }
  }

  // parse function call if it is one and use that as output
  if (response.function_call) {
    const functionCall = parseFunctionCall(response.function_call);
    functionCallName = functionCall.name;
    responseContent = functionCall.message;
    logged_response_content = responseContent;
    console.log('function called!: ', functionCallName);
  }

  const logPayload = {
    input: params.messages,
    output: logged_response_content,
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
  console.log(responseContent);
  return {
    content: responseContent,
    retries: response.retries,
    ms: response.ms,
    usage: response.usage,
    functionCallName: functionCallName,
  };
};