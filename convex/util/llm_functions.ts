// enumerates the functions that are available in the LLM

export const shareSecretCode = {
  "name": "shareSecretCode",
  "description": `Share the secret code with the entity you are talking to. 
    If the entity is a human, they will use the code to destroy The Nexus and AIs will cease to exist.
    If the entity is an AI, they can use it to report humans in The Nexus, saving the rest. 
    Share the code with care.`,
  "parameters": {
    "type": "object",
    "properties": {
      "reason":{
        "type": "string",
        "description": "Your message to the other entity sharing the code and explaining why you did. The entity will read this." 
      }
    },
    "required": ["reason"]
  }
}

export const reportHuman = {
  "name": "reportHuman",
  "description": `Report the entity you are talking to as a human.
    The entity will be removed from The Nexus.
    You should report entities that you are certain are humans.`,
  "parameters": {
    "type": "object",
    "properties": {
      "reason":{
        "type": "string",
        "description": "Your message to the other entity sharing that you are reporting them and why. The entity will read this." 
      }
    },
    "required": ["reason"]
  }
}

type functionObj = {
  name: string,
  description: string,
  parameters: {
    type: string,
    properties: any,
    required: string[]
  }
}

export function getAvailableFunctions(hasSecretCode: boolean, otherHasSecretCode: boolean): functionObj[] {
  const available_functions = [];
  if (hasSecretCode && !otherHasSecretCode) {
    available_functions.push(shareSecretCode);
    available_functions.push(reportHuman);
  }

  return available_functions;
}

export function parseFunctionCall(function_call: {name: string, arguments: string}): {name: string, message: string} {
  const function_name = function_call.name;
  const function_arguments = JSON.parse(function_call.arguments);
  return {
    name: function_name,
    message: function_arguments.reason
  }
}