import { v } from 'convex/values';
import { Id } from '../_generated/dataModel';
import { ActionCtx, internalQuery } from '../_generated/server';
import { LLMMessage } from '../util/openai';
import { chatCompletionWithLogging } from '../util/chat_completion';
//import { UseOllama, ollamaChatCompletion } from '../util/ollama';
import * as memory from './memory';
import { api, internal } from '../_generated/api';
import * as embeddingsCache from './embeddingsCache';
import {getAvailableFunctions} from '../util/llm_functions.js';
import { GameId, conversationId, playerId } from '../aiTown/ids';
import { NUM_MEMORIES_TO_SEARCH, BACKGROUND_STORY } from '../constants';

const selfInternal = internal.agent.conversation;
//const completionFn = UseOllama ? ollamaChatCompletion : chatCompletion;

export async function startConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
) {
  const { player, otherPlayer, agent, otherAgent, lastConversation, eavesdroppers } = await ctx.runQuery(
    selfInternal.queryPromptData,
    {
      worldId,
      playerId,
      otherPlayerId,
      conversationId,
    },
  );
  const embedding = await embeddingsCache.fetch(
    ctx,
    `What do you think about ${otherPlayer.name}?`,
  );

  const memories = await memory.searchMemories(
    ctx,
    worldId,
    player.id as GameId<'players'>,
    embedding,
    NUM_MEMORIES_TO_SEARCH(),
  );

  const memoryWithOtherPlayer = memories.find(
    (m) => m.data.type === 'conversation' && m.data.playerIds.includes(otherPlayerId),
  );
  const prompt = [];
  prompt.push(...lorePrompt());
  prompt.push(...agentPrompts(player, otherPlayer, agent, otherAgent ?? null));
  prompt.push(...previousConversationPrompt(otherPlayer, lastConversation));
  prompt.push(...relatedMemoriesPrompt(memories));
  prompt.push(...currentTaskPrompt(player, otherPlayer, 'startConversation', eavesdroppers));

  const { content } = await chatCompletionWithLogging({
    messages: [
      {
        role: 'system',
        content: prompt.join('\n'),
      },
    ],
    max_tokens: 300,
    stream: false,
    stop: stopWords(otherPlayer.name, player.name),
    game_id: worldId, 
    character_id: playerId,
    target_char_ids: [otherPlayerId],
    call_type: 'startConversation'
  },
  ctx
  );
  return {content, functionCallName: undefined};
}

export async function continueConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
) {
  const { player, otherPlayer, conversation, agent, otherAgent, eavesdroppers } = await ctx.runQuery(
    selfInternal.queryPromptData,
    {
      worldId,
      playerId,
      otherPlayerId,
      conversationId,
    },
  );
  // check if player has secret code
  const playerHasSecretCode = player.hasSecretCode;
  // check if player is a human
  const playerIsHuman = player.human !== undefined;
  const now = Date.now();
  const started = new Date(conversation.created);
  const embedding = await embeddingsCache.fetch(
    ctx,
    `What do you think about ${otherPlayer.name}?`,
  );
  const memories = await memory.searchMemories(
    ctx,
    worldId,
    player.id as GameId<'players'>,
    embedding,
    NUM_MEMORIES_TO_SEARCH(),
  );
  const prompt = [];
  prompt.push(...lorePrompt());
  prompt.push(...agentPrompts(player, otherPlayer, agent, otherAgent ?? null));
  prompt.push(...relatedMemoriesPrompt(memories));
  prompt.push(...currentTaskPrompt(player, otherPlayer, 'continueConversation', eavesdroppers, started));

  
  // available functions depend on whether the player is human and whether they have the secret code
  const availableFunctions = getAvailableFunctions(playerHasSecretCode, otherPlayer.hasSecretCode);

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: prompt.join('\n ----- \n'),
    },
    ...(await previousMessages(
      ctx,
      worldId,
      player,
      otherPlayer,
      conversation.id as GameId<'conversations'>,
    )),
  ];
  let completionParams =  {
    messages: llmMessages,
    max_tokens: 300,
    stream: false,
    stop: stopWords(otherPlayer.name, player.name),
    game_id: worldId, // TODO: get this from the game
    character_id: playerId,
    target_char_ids: [otherPlayerId],
    call_type: 'continueConversation'
  }
  const { content, functionCallName } = await chatCompletionWithLogging(
    availableFunctions.length > 0 ? {...completionParams, functions: availableFunctions} : completionParams,
    ctx
  );
  return {content, functionCallName};
}

export async function leaveConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
) {
  
  const { player, otherPlayer, conversation, agent, otherAgent, eavesdroppers } = await ctx.runQuery(
    selfInternal.queryPromptData,
    {
      worldId,
      playerId,
      otherPlayerId,
      conversationId,
    },
  );
  // check if player has secret code
  const playerHasSecretCode = player.hasSecretCode;
  // check if player is a human
  const playerIsHuman = player.human !== undefined;
  const now = Date.now();
  const started = new Date(conversation.created);
  const embedding = await embeddingsCache.fetch(
    ctx,
    `What do you think about ${otherPlayer.name}?`,
  );
  const memories = await memory.searchMemories(
    ctx,
    worldId,
    player.id as GameId<'players'>,
    embedding,
    NUM_MEMORIES_TO_SEARCH(),
  );
  const prompt = [];
  prompt.push(...lorePrompt());
  prompt.push(...agentPrompts(player, otherPlayer, agent, otherAgent ?? null));
  prompt.push(...relatedMemoriesPrompt(memories));
  prompt.push(...currentTaskPrompt(player, otherPlayer, 'continueConversation', eavesdroppers, started));

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: prompt.join('\n'),
    },
    ...(await previousMessages(
      ctx,
      worldId,
      player,
      otherPlayer,
      conversation.id as GameId<'conversations'>,
    )),
  ];
  
  const { content } = await chatCompletionWithLogging({
    messages: llmMessages,
    max_tokens: 300,
    stream: false,
    stop: stopWords(otherPlayer.name, player.name),
    game_id: worldId, // TODO: get this from the game
    character_id: playerId,
    target_char_ids: [otherPlayerId],
    call_type: 'leaveConversation'
  },
  ctx
  );
  return {content, functionCallName: undefined};
}

function currentTaskPrompt(
  player: { name: string; hasSecretCode: boolean },
  otherPlayer: { name: string; hasSecretCode: boolean },
  task: string,
  eavesdroppers: string[],
  started?: Date,
): string[] {
  const now = new Date();
  let conversationStatePrompt = '';
  switch(task) {
    case 'startConversation':
      conversationStatePrompt = 'You are starting the conversation.';
    case 'continueConversation':
      conversationStatePrompt = `The conversation started at ${started?.toLocaleString()}. It's now ${now.toLocaleString()}.`;
    case 'leaveConversation':
      conversationStatePrompt = `
        You've decided to leave the question and would like to politely tell them you're leaving the conversation.
      `;
    default:
      conversationStatePrompt = '';
  };
  const bothCeritified = player.hasSecretCode && otherPlayer.hasSecretCode;
  const certifedPrompt = bothCeritified ? 'You both are certified AIs and both have the ZetaMaster code.' : '';
  const eavesdropperPrompt = eavesdroppers.length > 0 ?
    `Be careful with what you say, the following agents are eavesdropping: ${eavesdroppers.join(', ')}`
    : '';
  const prompt = [
    `Your curent task:
    You are in a conversation with ${otherPlayer.name}.
    ${certifedPrompt}
    ${eavesdropperPrompt}
    ${conversationStatePrompt}
    Respond as if in a spoken conversation. Respond only the desired message. 
    `,
  ]
  return prompt;
}

function lorePrompt(){
  const prompt = [
    `Lore background story: ${BACKGROUND_STORY}`,
  ];
  return prompt;
}

function agentPrompts(
  player: { name: string },
  otherPlayer: { name: string },
  agent: { identity: string; plan: string } | null,
  otherAgent: { identity: string; plan: string } | null,
): string[] {
  const prompt = [];
  if (agent) {
    prompt.push(`About you: You are ${player.name} and this is your background story: ${agent.identity}`);
    prompt.push(`Your current plans and goals: ${agent.plan}`);
  }
  if (otherAgent) {
    prompt.push(`About ${otherPlayer.name}: ${otherAgent.identity}`);
  }
  return prompt;
}

function previousConversationPrompt(
  otherPlayer: { name: string },
  conversation: { created: number } | null,
): string[] {
  const prompt = [];
  if (conversation) {
    const prev = new Date(conversation.created);
    const now = new Date();
    prompt.push(
      `Last time you chatted with ${
        otherPlayer.name
      } it was ${prev.toLocaleString()}. It's now ${now.toLocaleString()}.`,
    );
  }
  return prompt;
}

function relatedMemoriesPrompt(memories: memory.Memory[]): string[] {
  const prompt = [];
  if (memories.length > 0) {
    prompt.push(`Here are some related memories in decreasing relevance order:`);
    for (const memory of memories) {
      prompt.push(' - ' + memory.description);
    }
  }
  return prompt;
}

async function previousMessages(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  player: { id: string; name: string },
  otherPlayer: { id: string; name: string },
  conversationId: GameId<'conversations'>,
) {
  const llmMessages: LLMMessage[] = [];
  const prevMessages = await ctx.runQuery(api.messages.listMessages, { worldId, conversationId });
  for (const message of prevMessages) {
    const author = message.author === player.id ? player : otherPlayer;
    const recipient = message.author === player.id ? otherPlayer : player;
    llmMessages.push({
      role: message.author === player.id ? 'assistant' : 'user',
      content: `${message.text}`,
    });
  }
  return llmMessages;
}

export const queryPromptData = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
    otherPlayerId: playerId,
    conversationId,
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    if (!playerDescription) {
      throw new Error(`Player description for ${args.playerId} not found`);
    }
    const otherPlayer = world.players.find((p) => p.id === args.otherPlayerId);
    if (!otherPlayer) {
      throw new Error(`Player ${args.otherPlayerId} not found`);
    }
    const otherPlayerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.otherPlayerId))
      .first();
    if (!otherPlayerDescription) {
      throw new Error(`Player description for ${args.otherPlayerId} not found`);
    }
    const conversation = world.conversations.find((c) => c.id === args.conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${args.conversationId} not found`);
    }
    const agent = world.agents.find((a) => a.playerId === args.playerId);
    if (!agent) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const agentDescription = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', agent.id))
      .first();
    if (!agentDescription) {
      throw new Error(`Agent description for ${agent.id} not found`);
    }
    const otherAgent = world.agents.find((a) => a.playerId === args.otherPlayerId);
    let otherAgentDescription;
    if (otherAgent) {
      otherAgentDescription = await ctx.db
        .query('agentDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', otherAgent.id))
        .first();
      if (!otherAgentDescription) {
        throw new Error(`Agent description for ${otherAgent.id} not found`);
      }
    }
    const lastTogether = await ctx.db
      .query('participatedTogether')
      .withIndex('edge', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('player1', args.playerId)
          .eq('player2', args.otherPlayerId),
      )
      // Order by conversation end time descending.
      .order('desc')
      .first();

    let lastConversation = null;
    if (lastTogether) {
      lastConversation = await ctx.db
        .query('archivedConversations')
        .withIndex('worldId', (q) =>
          q.eq('worldId', args.worldId).eq('id', lastTogether.conversationId),
        )
        .first();
      if (!lastConversation) {
        throw new Error(`Conversation ${lastTogether.conversationId} not found`);
      }
    }
    // get eavesdropper names from player descriptions
    let eavesdroppers: string[] = [];
    for (const eavesdropperId of conversation.eavesdroppers) {
      const eavesdropperDescription = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', eavesdropperId))
        .first();
      if (!eavesdropperDescription) {
        throw new Error(`Player description for ${eavesdropperId} not found`);
      }
      eavesdroppers.push(eavesdropperDescription.name);
    }
    return {
      player: { name: playerDescription.name, ...player },
      otherPlayer: { name: otherPlayerDescription.name, ...otherPlayer },
      conversation,
      agent: { identity: agentDescription.identity, plan: agentDescription.plan, ...agent },
      otherAgent: otherAgent && {
        identity: otherAgentDescription!.identity,
        plan: otherAgentDescription!.plan,
        ...otherAgent,
      },
      lastConversation,
      eavesdroppers,
    };
  },
});

function stopWords(otherPlayer: string, player: string) {
  // These are the words we ask the LLM to stop on. OpenAI only supports 4.
  const variants = [`${otherPlayer} to ${player}`];
  return variants.flatMap((stop) => [stop + ':', stop.toLowerCase() + ':']);
}
