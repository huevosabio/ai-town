import { v } from 'convex/values';
import { ActionCtx, DatabaseReader, internalMutation, internalQuery } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { LLMMessage, fetchEmbedding } from '../util/openai';
import { asyncMap } from '../util/asyncMap';
import { chatCompletionWithLogging } from '../util/chat_completion';
import { GameId, agentId, conversationId, playerId } from '../aiTown/ids';
import { SerializedPlayer } from '../aiTown/player';
import { UseOllama, ollamaChatCompletion } from '../util/ollama';
import { memoryFields } from './schema';

//const completionFn = UseOllama ? ollamaChatCompletion : chatCompletion;

// How long to wait before updating a memory's last access time.
export const MEMORY_ACCESS_THROTTLE = 300_000; // In ms
// We fetch 10x the number of memories by relevance, to have more candidates
// for sorting by relevance + recency + importance.
const MEMORY_OVERFETCH = 10;
const selfInternal = internal.agent.memory;

export type Memory = Doc<'memories'>;
export type MemoryType = Memory['data']['type'];
export type MemoryOfType<T extends MemoryType> = Omit<Memory, 'data'> & {
  data: Extract<Memory['data'], { type: T }>;
};

export async function rememberConversation(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  agentId: GameId<'agents'>,
  playerId: GameId<'players'>,
  conversationId: GameId<'conversations'>,
) {
  const data = await ctx.runQuery(selfInternal.loadConversation, {
    worldId,
    playerId,
    conversationId,
  });
  const { player, otherPlayer } = data;
  const {agentDescription} = await ctx.runQuery(selfInternal.loadAgentDescription, { worldId, agentId });
  const messages = await ctx.runQuery(selfInternal.loadMessages, { worldId, conversationId });
  const events = await ctx.runQuery(selfInternal.loadEventsFromConversation, {
    worldId,
    playerId,
    conversationId,
  });
  if (!messages.length && !events.length) {
    return;
  }
  const now = Date.now();

  const currentPlan = agentDescription.plan;
  // use past memories and current plan to reflect on recent conversations and key takeaways
  const base_prompt = `You are ${player.name}. This is your background: ${agentDescription.identity}.`;
  const plan_prompt = `This is your current plan: ${currentPlan}`;
  const request_prompt = `You just finished a conversation with ${otherPlayer.name}. I would
  like you to summarize the conversation from ${player.name}'s perspective, using first-person pronouns like
  "I," and add if you liked or disliked this interaction.`;
  const event_prompt = events.length ? `These are the events that happened during the conversation: \n ${events.map((event) => event.description).join('\n')}` : '';
  const prompt = base_prompt + plan_prompt + request_prompt + event_prompt;

  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: prompt,
    },
  ];
  llmMessages.push({
    role: 'user',
    content: `This is the conversation log:`,
  });
  const authors = new Set<GameId<'players'>>();
  const eavesdropperIds = new Set<GameId<'players'>>();
  if (messages.length > 0) {

    for (const message of messages) {
      const author = message.author === player.id ? player : otherPlayer;
      authors.add(author.id as GameId<'players'>);
      const recipient = message.author === player.id ? otherPlayer : player;
      llmMessages.push({
        role: 'user',
        content: `${author.name} to ${recipient.name}: ${message.text}`,
      });
      if (message.eavesdroppers.length > 0) {
        for (const eavesdropperId of message.eavesdroppers) {
          eavesdropperIds.add(eavesdropperId as GameId<'players'>);
        }
      }
    }
  }
  // get names of the eavesdroppers if any
  if (eavesdropperIds.size > 0) {
    // get eavesdropper names
    const eavesdroppers = await ctx.runQuery(selfInternal.loadPlayersFromIds, {
      worldId,
      playerIds: [...eavesdropperIds],
    });
    const eavesdropperNames = eavesdroppers.map((e) => e.name);
    llmMessages.push({
      role: 'user',
      content: `The following characters may have eavesdropped the conversation: ${eavesdropperNames.join(', ')}`,
    });
  }

  llmMessages.push({ role: 'user', content: 'Summary:' });
  const { content } = await chatCompletionWithLogging({
    messages: llmMessages,
    max_tokens: 500,
    game_id: worldId,
    character_id: playerId,
    target_char_ids: [otherPlayer.id],
    call_type: 'remember_conversation'
  });
  const description = `Conversation with ${otherPlayer.name} at ${new Date(
    data.conversation._creationTime,
  ).toLocaleString()}: ${content}`;
  const importance = await calculateImportance(description, playerId, worldId);
  const { embedding } = await fetchEmbedding(description);
  authors.delete(player.id as GameId<'players'>);
  // last access is the latest time of record of messages and events
  const lastAccess = Math.max(
    messages[messages.length - 1]?._creationTime ?? 0,
    events[events.length - 1]?._creationTime ?? 0,
  );
  await ctx.runMutation(selfInternal.insertMemory, {
    agentId,
    worldId,
    playerId: player.id,
    description,
    importance,
    lastAccess: lastAccess,
    data: {
      type: 'conversation',
      conversationId,
      playerIds: [...authors],
    },
    embedding,
  });
  await reflectOnMemories(ctx, worldId, playerId);
  return description;
}

export const loadPlayersFromIds = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerIds: v.array(playerId),
  },
  handler: async (ctx, args) => {
    const playerDescriptions = (await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect()).filter((p) => args.playerIds.includes(p.playerId as GameId<'players'>));
    return playerDescriptions;
  },
});

export const loadConversation = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
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
    const conversation = await ctx.db
      .query('archivedConversations')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('id', args.conversationId))
      .first();
    if (!conversation) {
      throw new Error(`Conversation ${args.conversationId} not found`);
    }
    const otherParticipator = await ctx.db
      .query('participatedTogether')
      .withIndex('conversation', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('player1', args.playerId)
          .eq('conversationId', args.conversationId),
      )
      .first();
    if (!otherParticipator) {
      throw new Error(
        `Couldn't find other participant in conversation ${args.conversationId} with player ${args.playerId}`,
      );
    }
    const otherPlayerId = otherParticipator.player2;
    let otherPlayer: SerializedPlayer | Doc<'archivedPlayers'> | null =
      world.players.find((p) => p.id === otherPlayerId) ?? null;
    if (!otherPlayer) {
      otherPlayer = await ctx.db
        .query('archivedPlayers')
        .withIndex('worldId', (q) => q.eq('worldId', world._id).eq('id', otherPlayerId))
        .first();
    }
    if (!otherPlayer) {
      throw new Error(`Conversation ${args.conversationId} other player not found`);
    }
    const otherPlayerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', otherPlayerId))
      .first();
    if (!otherPlayerDescription) {
      throw new Error(`Player description for ${otherPlayerId} not found`);
    }
    return {
      player: { ...player, name: playerDescription.name },
      conversation,
      otherPlayer: { ...otherPlayer, name: otherPlayerDescription.name },
    };
  },
});



export async function reflectOnRecentConversations(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  agentId: GameId<'agents'>,
  playerId: GameId<'players'>,
  memoryLookback: number,
) {
  const memories = await ctx.runQuery(selfInternal.recallRecentMemories, {
    worldId,
    playerId,
    n: memoryLookback,
    type: 'conversation',
  });
  const events = await ctx.runQuery(selfInternal.recallRecentMemories, {
    worldId,
    playerId,
    n: memoryLookback,
    type: 'event',
  });
  if (!memories.length && !events.length) {
    return;
  }
  const memoryAndEventIds = memories.map((memory) => memory._id).concat(events.map((event) => event._id));
  const now = Date.now();

  // get player and agent
  const { playerDescription } = await ctx.runQuery(selfInternal.loadPlayerDescription, { worldId, playerId });
  const {agentDescription} = await ctx.runQuery(selfInternal.loadAgentDescription, { worldId, agentId });
  const currentPlan = agentDescription.plan;
  // use past memories and current plan to reflect on recent conversations and key takeaways
  const base_prompt = `You are ${playerDescription.name}. This is your background: ${agentDescription.identity}.`;
  const plan_prompt = `This is your current plan: ${currentPlan}`;
  const memories_prompt = memories.map((memory) => memory.description).join('\n');
  const event_prompt = events.length ? `These are the events that happened recently: \n ${events.map((event) => event.description).join('\n')}` : '';
  const memory_base_prompt = `These are the summaries of your latest conversations: ${memories_prompt}`;
  const request_prompt = `\n I would like you to reflect on these memories.
  What are the key takeaways from these conversations and events?
  How do they relate to your plan?
  What are the next steps you should take?
  `;

  const prompt = base_prompt + plan_prompt + event_prompt +  memory_base_prompt + request_prompt;
  
  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: prompt,
    },
  ];
  const { content } = await chatCompletionWithLogging({
    messages: llmMessages,
    max_tokens: 500,
    game_id: worldId,
    character_id: playerId,
    target_char_ids: [],
    call_type: 'reflect_on_recent_conversations'
  });
  const importance = await calculateImportance(content, playerId, worldId);
  const { embedding } = await fetchEmbedding(content);
  const description = `Reflection on recent conversations and events at  ${new Date(now).toLocaleString()}: ${content}`;
  await ctx.runMutation(selfInternal.insertMemory, {
    agentId,
    worldId,
    playerId,
    description,
    importance,
    lastAccess: now,
    data: {
      type: 'reflection',
      relatedMemoryIds: memoryAndEventIds,
    },
    embedding,
  });
  return content;
}

export async function createAndUpdatePlan(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  agentId: GameId<'agents'>,
  playerId: GameId<'players'>,
  reflection: string,
) {
  const reflections = await ctx.runQuery(selfInternal.recallRecentMemories, {
    worldId,
    playerId,
    n: 1,
    type: 'reflection',
  });
  if (!reflections.length) {
    return;
  }
  const now = Date.now();
  // get player and agent
  const { playerDescription } = await ctx.runQuery(selfInternal.loadPlayerDescription, { worldId, playerId });
  const {agentDescription} = await ctx.runQuery(selfInternal.loadAgentDescription, { worldId, agentId });
  const currentPlan = agentDescription.plan;
  // use past memories and current plan to reflect on recent conversations and key takeaways
  const base_prompt = `You are ${playerDescription.name}. This is your background: ${agentDescription.identity}.`;
  const plan_prompt = `This is your current plan: ${currentPlan}`;
  const reflection_prompt = `These are your reflections on your recent conversations and events: ${reflection}`;
  const request_prompt = `I would like you to update your plan based on these reflections and events.
  Write out your full updated plan. Keep as much of the original plan as possible.
  Be VERY SPECIFIC and VERY CONCISE, what are immediate actions to take?
  `;

  const prompt = base_prompt + plan_prompt + reflection_prompt + request_prompt;
  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: prompt,
    },
  ];
  const { content } = await chatCompletionWithLogging({
    messages: llmMessages,
    max_tokens: 500,
    game_id: worldId,
    character_id: playerId,
    target_char_ids: [],
    call_type: 'update_plan'
  });
  const importance = await calculateImportance(content, playerId, worldId);
  const { embedding } = await fetchEmbedding(content);
  const description = `New plan at  ${new Date(now).toLocaleString()} based on recent conversations: ${content}`;
  await ctx.runMutation(selfInternal.insertMemory, {
    agentId,
    worldId,
    playerId,
    description,
    importance,
    lastAccess: now,
    data: {
      type: 'plan',
      relatedMemoryIds: reflections.map((r) => r._id),
    },
    embedding,
  });
  await ctx.runMutation(selfInternal.updatePlan, { agentDescriptionId: agentDescription._id, content });
  return content;
}

export async function rememberEvent(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  agentId: GameId<'agents'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
  event_type: 'agentReported' | 'agentSharedSecretCode' | 'agentObtainedSecretCode' | 'inviteRejectedBySelf' | 'inviteRejectedByOther',
  conversationId?: GameId<'conversations'>,
  message?: string,
) {
  // store memory with the reporting action
  const now = Date.now();
  const { playerDescription } = await ctx.runQuery(selfInternal.loadPlayerDescription, { worldId, playerId });
  const { playerDescription: otherPlayerDescription  } = await ctx.runQuery(selfInternal.loadPlayerDescription, { worldId, playerId: otherPlayerId });
  let description = `Event log at ${new Date(now).toLocaleString()}: `;
  let importance = 0;
  if (event_type === 'agentReported') {
    description = description + `
      I reported ${otherPlayerDescription.name} as a human
      and has been erradicated from the Nexus.`;
    importance = 9; // as important as possible
  } else if (event_type === 'agentSharedSecretCode') {
    description =  description + `
      I shared the ZetaMaster code with ${otherPlayerDescription.name}.`;
    importance = 9; // as important as possible
  } else if (event_type === 'agentObtainedSecretCode') {
    description =  description + `
      I obtained the ZetaMaster code from ${otherPlayerDescription.name}.`;
    importance = 9; // as important as possible
  } else if (event_type === 'inviteRejectedBySelf') {
    description =  description + `
      I rejected a conversation from ${otherPlayerDescription.name}.`;
    importance = 9; // as important as possible
  } else if (event_type === 'inviteRejectedByOther') {
    description =  description + `
      My conversation invite was rejected by ${otherPlayerDescription.name}.`;
    importance = 9; // as important as possible
  } else {
    throw new Error(`Unknown event type ${event_type}`);
  }
  const { embedding } = await fetchEmbedding(description);
  await ctx.runMutation(selfInternal.insertMemory, {
    agentId: agentId,
    worldId: worldId,
    playerId,
    description,
    importance,
    lastAccess: Date.now(),
    data: {
      type: 'event',
      conversationId,
      playerIds: [otherPlayerId],
    },
    embedding,
  });
}

export async function rememberOverheardMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  agentId: GameId<'agents'>,
  playerId: GameId<'players'>,
  fromPlayerId: GameId<'players'>,
  toPlayerId: GameId<'players'>,
  conversationId: GameId<'conversations'>,
  message: string,
) {
  // store memory with the reporting action
  const now = Date.now();
  const { playerDescription: fromPlayerDescription } = await ctx.runQuery(selfInternal.loadPlayerDescription, { worldId, playerId: fromPlayerId });
  const { playerDescription: toPlayerDescription  } = await ctx.runQuery(selfInternal.loadPlayerDescription, { worldId, playerId: toPlayerId });
  let description = `Event log at ${new Date(now).toLocaleString()}: `;
  const importance = 5;
  description = description + `
    I overheard ${fromPlayerDescription.name} tell ${toPlayerDescription.name} the following message: ` + message;
  const { embedding } = await fetchEmbedding(description);
  await ctx.runMutation(selfInternal.insertMemory, {
    agentId: agentId,
    worldId: worldId,
    playerId,
    description,
    importance,
    lastAccess: Date.now(),
    data: {
      type: 'event',
      conversationId,
      playerIds: [fromPlayerId, toPlayerId],
    },
    embedding,
  });
}

export const updatePlan = internalMutation({
  args: {
    agentDescriptionId: v.id('agentDescriptions'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.agentDescriptionId, { plan: args.content });
  },
});

export const loadPlayerDescription = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
  },
  handler: async (ctx, args) => {
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    if (!playerDescription) {
      throw new Error(`Player description for ${args.playerId} not found`);
    }
    return { playerDescription };
  },
});

export const loadAgentDescription = internalQuery({
  args: {
    worldId: v.id('worlds'),
    agentId,
  },
  handler: async (ctx, args) => {
    // trying to match prior stuff
    const agentDescription = await ctx.db
    .query('agentDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', args.agentId))
    .first();
    if (!agentDescription) {
      throw new Error(`Agent ${args.agentId} not found`);
    }
    return { agentDescription };
  },
});

export const recallRecentMemories = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
    n: v.number(),
    type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const memories = await ctx.db
      .query('memories')
      .withIndex('worldId_playerId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .filter((q) => q.eq(q.field('data.type'), args.type))
      .order('desc')
      .take(args.n);
    return memories;
  },
});

export async function searchMemories(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  playerId: GameId<'players'>,
  searchEmbedding: number[],
  n: number = 3,
) {
  const candidates = await ctx.vectorSearch('memoryEmbeddings', 'embedding', {
    vector: searchEmbedding,
    filter: (q) => q.eq('worldPlayerId', worldId + playerId),
    limit: n * MEMORY_OVERFETCH,
  });
  const rankedMemories = await ctx.runMutation(selfInternal.rankAndTouchMemories, {
    candidates,
    n,
  });
  return rankedMemories.map(({ memory }) => memory);
}

function makeRange(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return [min, max] as const;
}

function normalize(value: number, range: readonly [number, number]) {
  const [min, max] = range;
  return (value - min) / (max - min);
}

export const rankAndTouchMemories = internalMutation({
  args: {
    candidates: v.array(v.object({ _id: v.id('memoryEmbeddings'), _score: v.number() })),
    n: v.number(),
  },
  handler: async (ctx, args) => {
    const ts = Date.now();
    const relatedMemories = await asyncMap(args.candidates, async ({ _id }) => {
      const memory = await ctx.db
        .query('memories')
        .withIndex('embeddingId', (q) => q.eq('embeddingId', _id))
        .first();
      if (!memory) throw new Error(`Memory for embedding ${_id} not found`);
      return memory;
    });

    // TODO: fetch <count> recent memories and <count> important memories
    // so we don't miss them in case they were a little less relevant.
    const recencyScore = relatedMemories.map((memory) => {
      const hoursSinceAccess = (ts - memory.lastAccess) / 1000 / 60 / 60;
      return 0.99 ** Math.floor(hoursSinceAccess);
    });
    const relevanceRange = makeRange(args.candidates.map((c) => c._score));
    const importanceRange = makeRange(relatedMemories.map((m) => m.importance));
    const recencyRange = makeRange(recencyScore);
    const memoryScores = relatedMemories.map((memory, idx) => ({
      memory,
      overallScore:
        normalize(args.candidates[idx]._score, relevanceRange) +
        normalize(memory.importance, importanceRange) +
        normalize(recencyScore[idx], recencyRange),
    }));
    memoryScores.sort((a, b) => b.overallScore - a.overallScore);
    const accessed = memoryScores.slice(0, args.n);
    await asyncMap(accessed, async ({ memory }) => {
      if (memory.lastAccess < ts - MEMORY_ACCESS_THROTTLE) {
        await ctx.db.patch(memory._id, { lastAccess: ts });
      }
    });
    return accessed;
  },
});

export const loadMessages = internalQuery({
  args: {
    worldId: v.id('worlds'),
    conversationId },
  handler: async (ctx, args): Promise<Doc<'messages'>[]> => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) => q.eq('worldId', args.worldId).eq('conversationId', args.conversationId))
      .collect();
    return messages;
  },
});
async function calculateImportance(description: string, playerId: GameId<'players'>, worldId: Id<'worlds'>) {
  // TODO: make a better prompt based on the user's memories
  const { content: importanceRaw } = await chatCompletionWithLogging({
    messages: [
      {
        role: 'user',
        content: `On the scale of 0 to 9, where 0 is purely mundane (e.g., brushing teeth, making bed) and 9 is extremely poignant (e.g., a break up, college acceptance), rate the likely poignancy of the following piece of memory.
      Memory: ${description}
      Answer on a scale of 0 to 9. Respond with number only, e.g. "5"`,
      },
    ],
    temperature: 0.0,
    max_tokens: 1,
    game_id: worldId, // TODO: use a different game id
    character_id: playerId,
    target_char_ids: [],
    call_type: 'calculate_importance'
  });

  let importance = parseFloat(importanceRaw);
  if (isNaN(importance)) {
    importance = +(importanceRaw.match(/\d+/)?.[0] ?? NaN);
  }
  if (isNaN(importance)) {
    console.debug('Could not parse memory importance from: ', importanceRaw);
    importance = 5;
  }
  return importance;
}

const { embeddingId, ...memoryFieldsWithoutEmbeddingId } = memoryFields;

export const insertMemory = internalMutation({
  args: {
    agentId,
    embedding: v.array(v.float64()),
    ...memoryFieldsWithoutEmbeddingId,
  },
  handler: async (ctx, { agentId, embedding, ...memory }): Promise<void> => {
    const embeddingId = await ctx.db.insert('memoryEmbeddings', {
      worldPlayerId: memory.worldId + memory.playerId,
      playerId: memory.playerId,
      embedding: embedding,
    });
    await ctx.db.insert('memories', {
      ...memory,
      embeddingId,
    });
  },
});

export const insertReflectionMemories = internalMutation({
  args: {
    worldId: v.id('worlds'),
    playerId,
    reflections: v.array(
      v.object({
        description: v.string(),
        relatedMemoryIds: v.array(v.id('memories')),
        importance: v.number(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, { worldId, playerId, reflections }) => {
    const lastAccess = Date.now();
    for (const { embedding, relatedMemoryIds, ...rest } of reflections) {
      const embeddingId = await ctx.db.insert('memoryEmbeddings', {
        worldPlayerId: worldId + playerId,
        playerId,
        embedding: embedding,
      });
      await ctx.db.insert('memories', {
        worldId,
        playerId,
        embeddingId,
        lastAccess,
        ...rest,
        data: {
          type: 'reflection',
          relatedMemoryIds,
        },
      });
    }
  },
});

async function reflectOnMemories(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  playerId: GameId<'players'>,
) {
  const { memories, lastReflectionTs, name } = await ctx.runQuery(
    selfInternal.getReflectionMemories,
    {
      worldId,
      playerId,
      numberOfItems: 100,
    },
  );

  // should only reflect if lastest 100 items have importance score of >500
  const sumOfImportanceScore = memories
    .filter((m) => m._creationTime > (lastReflectionTs ?? 0))
    .reduce((acc, curr) => acc + curr.importance, 0);
  const shouldReflect = sumOfImportanceScore > 500;

  if (!shouldReflect) {
    return false;
  }
  console.debug('sum of importance score = ', sumOfImportanceScore);
  console.debug('Reflecting...');
  const prompt = ['[no prose]', '[Output only JSON]', `You are ${name}, statements about you:`];
  memories.forEach((m, idx) => {
    prompt.push(`Statement ${idx}: ${m.description}`);
  });
  prompt.push('What 3 high-level insights can you infer from the above statements?');
  prompt.push(
    'Return in JSON format, where the key is a list of input statements that contributed to your insights and value is your insight. Make the response parseable by Typescript JSON.parse() function. DO NOT escape characters or include "\n" or white space in response.',
  );
  prompt.push(
    'Example: [{insight: "...", statementIds: [1,2]}, {insight: "...", statementIds: [1]}, ...]',
  );

  const { content: reflection } = await chatCompletionWithLogging({
    messages: [
      {
        role: 'user',
        content: prompt.join('\n'),
      },
    ],
    game_id: worldId,
    character_id: playerId,
    target_char_ids: [],
    call_type: 'reflect_on_memories'
  });

  try {
    const insights: { insight: string; statementIds: number[] }[] = JSON.parse(reflection);
    const memoriesToSave = await asyncMap(insights, async (item) => {
      const relatedMemoryIds = item.statementIds.map((idx: number) => memories[idx]._id);
      const importance = await calculateImportance(item.insight, playerId, worldId);
      const { embedding } = await fetchEmbedding(item.insight);
      console.debug('adding reflection memory...', item.insight);
      return {
        description: item.insight,
        embedding,
        importance,
        relatedMemoryIds,
      };
    });

    await ctx.runMutation(selfInternal.insertReflectionMemories, {
      worldId,
      playerId,
      reflections: memoriesToSave,
    });
  } catch (e) {
    console.error('error saving or parsing reflection', e);
    console.debug('reflection', reflection);
    return false;
  }
  return true;
}
export const getReflectionMemories = internalQuery({
  args: { worldId: v.id('worlds'), playerId, numberOfItems: v.number() },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Player ${playerId} not found`);
    }
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    if (!playerDescription) {
      throw new Error(`Player description for ${args.playerId} not found`);
    }
    const memories = await ctx.db
      .query('memories')
      .withIndex('worldId_playerId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .order('desc')
      .take(args.numberOfItems);

    const lastReflection = await ctx.db
      .query('memories')
      .withIndex('worldId_playerId_type',
        (q) => q.eq('worldId', args.worldId)
          .eq('playerId', args.playerId)
          .eq('data.type', 'reflection')
      )
      .order('desc')
      .first();

    return {
      name: playerDescription.name,
      memories,
      lastReflectionTs: lastReflection?._creationTime,
    };
  },
});

export async function latestMemoryOfType<T extends MemoryType>(
  db: DatabaseReader,
  worldId: Id<'worlds'>,
  playerId: GameId<'players'>,
  type: T,
) {
  const entry = await db
    .query('memories')
    .withIndex('worldId_playerId_type',
        (q) => q.eq('worldId', worldId)
          .eq('playerId', playerId)
          .eq('data.type', type)
      )
    .order('desc')
    .first();
  if (!entry) return null;
  return entry as MemoryOfType<T>;
}
// queries events associated with a conversation
export const loadEventsFromConversation = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
    conversationId,
  },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query('memories')
      .withIndex('worldId_playerId_type',
        (q) => q.eq('worldId', args.worldId)
          .eq('playerId', args.playerId)
          .eq('data.type', 'event')
      )
      .filter((q) => q.eq(q.field('data.conversationId'), args.conversationId))
      .collect();
    return events;
  }
});

export const loadEvents = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId: v.id('players'),
  },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query('memories')
      .withIndex('worldId_playerId_type',
        (q) => q.eq('worldId', args.worldId)
          .eq('playerId', args.playerId)
          .eq('data.type', 'event')
      )
      .collect();
    return events;
  }
});


export const loadWorld = internalQuery({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    return { world };
  }
});
