import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { ActionCtx, DatabaseReader, internalMutation, internalQuery } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { LLMMessage, fetchEmbedding } from '../util/openai';
import { ACTION_TIMEOUT } from './constants';
import { asyncMap } from '../util/asyncMap';
import { chatCompletionWithLogging } from '../util/chat_completion';

// How long to wait before updating a memory's last access time.
export const MEMORY_ACCESS_THROTTLE = 300_000; // In ms
// We fetch 10x the number of memories by relevance, to have more candidates
// for sorting by relevance + recency + importance.
const MEMORY_OVERFETCH = 10;

const selfInternal = internal.agent.memory;

const memoryFields = {
  playerId: v.id('players'),
  description: v.string(),
  embeddingId: v.id('memoryEmbeddings'),
  importance: v.number(),
  lastAccess: v.number(),
  data: v.union(
    // Setting up dynamics between players
    v.object({
      type: v.literal('relationship'),
      // The player this memory is about, from the perspective of the player
      // whose memory this is.
      playerId: v.id('players'),
    }),
    v.object({
      type: v.literal('conversation'),
      conversationId: v.id('conversations'),
      // The other player(s) in the conversation.
      playerIds: v.array(v.id('players')),
    }),
    v.object({
      type: v.literal('reflection'),
      relatedMemoryIds: v.array(v.id('memories')),
    }),
    v.object({
      type: v.literal('plan'),
      relatedMemoryIds: v.array(v.id('memories')),
    }),
  ),
};
export type Memory = Doc<'memories'>;
export type MemoryType = Memory['data']['type'];
export type MemoryOfType<T extends MemoryType> = Omit<Memory, 'data'> & {
  data: Extract<Memory['data'], { type: T }>;
};

export async function rememberConversation(
  ctx: ActionCtx,
  agentId: Id<'agents'>,
  generationNumber: number,
  playerId: Id<'players'>,
  conversationId: Id<'conversations'>,
) {
  const data = await ctx.runQuery(selfInternal.loadConversation, {
    playerId,
    conversationId,
  });
  const { player, otherPlayer } = data;
  const messages = await ctx.runQuery(selfInternal.loadMessages, { conversationId });
  if (!messages.length) {
    return;
  }
  const now = Date.now();

  // Set the `isThinking` flag and schedule a function to clear it after 60s. We'll
  // also clear the flag in `insertMemory` below to stop thinking early on success.
  await ctx.runMutation(selfInternal.startThinking, { agentId, now });
  await ctx.scheduler.runAfter(ACTION_TIMEOUT, selfInternal.clearThinking, { agentId, since: now });

  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: `You are ${player.name}, and you just finished a conversation with ${otherPlayer.name}. I would
      like you to summarize the conversation from ${player.name}'s perspective, using first-person pronouns like
      "I," and add if you liked or disliked this interaction.`,
    },
  ];
  const authors = new Set<Id<'players'>>();
  for (const message of messages) {
    const author = message.author === player._id ? player : otherPlayer;
    authors.add(author._id);
    const recipient = message.author === player._id ? otherPlayer : player;
    llmMessages.push({
      role: 'user',
      content: `${author.name} to ${recipient.name}: ${message.text}`,
    });
  }
  llmMessages.push({ role: 'user', content: 'Summary:' });
  const { content } = await chatCompletionWithLogging({
    messages: llmMessages,
    max_tokens: 500,
    game_id: player.worldId,
    character_id: player._id,
    target_char_ids: [otherPlayer._id],
    call_type: 'remember_conversation'
  });
  const description = `Conversation with ${otherPlayer.name} at ${new Date(
    data.conversation._creationTime,
  ).toLocaleString()}: ${content}`;
  const importance = await calculateImportance(player, description);
  const { embedding } = await fetchEmbedding(description);
  authors.delete(player._id);
  await ctx.runMutation(selfInternal.insertMemory, {
    agentId,
    generationNumber,

    playerId: player._id,
    description,
    importance,
    lastAccess: messages[messages.length - 1]._creationTime,
    data: {
      type: 'conversation',
      conversationId,
      playerIds: [...authors],
    },
    embedding,
  });
  return description;
}

export const loadConversation = internalQuery({
  args: {
    playerId: v.id('players'),
    conversationId: v.id('conversations'),
  },
  handler: async (ctx, args) => {
    const player = await ctx.db.get(args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${args.conversationId} not found`);
    }
    const conversationMembers = await ctx.db
      .query('conversationMembers')
      .withIndex('conversationId', (q) => q.eq('conversationId', args.conversationId))
      .filter((q) => q.neq(q.field('playerId'), args.playerId))
      .collect();
    if (conversationMembers.length !== 1) {
      throw new Error(`Conversation ${args.conversationId} not with exactly one other player`);
    }
    const otherPlayer = await ctx.db.get(conversationMembers[0].playerId);
    if (!otherPlayer) {
      throw new Error(`Conversation ${args.conversationId} other player not found`);
    }
    return {
      player,
      conversation,
      otherPlayer,
    };
  },
});



export async function reflectOnRecentConversations(
  ctx: ActionCtx,
  agentId: Id<'agents'>,
  generationNumber: number,
  playerId: Id<'players'>,
  memoryLookback: number,
) {
  const memories = await ctx.runQuery(selfInternal.recallRecentMemories, {
    playerId,
    n: memoryLookback,
    type: 'conversation',
  });
  if (!memories.length) {
    return;
  }
  const now = Date.now();

  // Set the `isThinking` flag and schedule a function to clear it after 60s. We'll
  // also clear the flag in `insertMemory` below to stop thinking early on success.
  await ctx.runMutation(selfInternal.startThinking, { agentId, now });
  await ctx.scheduler.runAfter(ACTION_TIMEOUT, selfInternal.clearThinking, { agentId, since: now });

  // get player and agent
  const { player } = await ctx.runQuery(selfInternal.loadPlayer, { playerId });
  const { agent } = await ctx.runQuery(selfInternal.loadAgent, { agentId });
  const currentPlan = agent.plan;
  // use past memories and current plan to reflect on recent conversations and key takeaways
  const base_prompt = `You are ${player.name}. This is your background: ${agent.identity}.`;
  const plan_prompt = `This is your current plan: ${currentPlan}`;
  const memories_prompt = memories.map((memory) => memory.description).join('\n');
  const memory_base_prompt = `These are the summaries of your latest conversations: ${memories_prompt}`;
  const request_prompt = `\n I would like you to reflect on these conversations.
  What are the key takeaways from these conversations?
  How do they relate to your plan?
  What are the next steps you should take?
  `;

  const prompt = base_prompt + plan_prompt + memory_base_prompt + request_prompt;
  
  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: prompt,
    },
  ];
  const { content } = await chatCompletionWithLogging({
    messages: llmMessages,
    max_tokens: 500,
    game_id: player.worldId,
    character_id: player._id,
    target_char_ids: [],
    call_type: 'reflect_on_recent_conversations'
  });
  const importance = await calculateImportance(player, content);
  const { embedding } = await fetchEmbedding(content);
  const description = `Reflection on recent conversations at  ${new Date(now).toLocaleString()}: ${content}`;
  await ctx.runMutation(selfInternal.insertMemory, {
    agentId,
    generationNumber,

    playerId,
    description,
    importance,
    lastAccess: now,
    data: {
      type: 'reflection',
      relatedMemoryIds: memories.map((memory) => memory._id),
    },
    embedding,
  });
  return content;
}

export async function createAndUpdatePlan(
  ctx: ActionCtx,
  agentId: Id<'agents'>,
  generationNumber: number,
  playerId: Id<'players'>,
  reflection: string,
) {
  const reflections = await ctx.runQuery(selfInternal.recallRecentMemories, {
    playerId,
    n: 1,
    type: 'reflection',
  });
  if (!reflections.length) {
    return;
  }
  const now = Date.now();
  // Set the `isThinking` flag and schedule a function to clear it after 60s. We'll
  // also clear the flag in `insertMemory` below to stop thinking early on success.
  await ctx.runMutation(selfInternal.startThinking, { agentId, now });
  await ctx.scheduler.runAfter(ACTION_TIMEOUT, selfInternal.clearThinking, { agentId, since: now });

  // get player and agent
  const { player } = await ctx.runQuery(selfInternal.loadPlayer, { playerId });
  const { agent } = await ctx.runQuery(selfInternal.loadAgent, { agentId });
  const currentPlan = agent.plan;
  // use past memories and current plan to reflect on recent conversations and key takeaways
  const base_prompt = `You are ${player.name}. This is your background: ${agent.identity}.`;
  const plan_prompt = `This is your current plan: ${currentPlan}`;
  const reflection_prompt = `These are your reflections on your recent conversations: ${reflection}`;
  const request_prompt = `I would like you to update your plan based on these reflections.
  Write out your full updated plan. Keep as much of the orginal plan as possible.
  Be very specific and very concise, what are immidiate actions to take?
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
    game_id: player.worldId,
    character_id: player._id,
    target_char_ids: [],
    call_type: 'update_plan'
  });
  const importance = await calculateImportance(player, content);
  const { embedding } = await fetchEmbedding(content);
  const description = `New plan at  ${new Date(now).toLocaleString()} based on recent conversations: ${content}`;
  await ctx.runMutation(selfInternal.insertMemory, {
    agentId,
    generationNumber,

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
  await ctx.runMutation(selfInternal.updatePlan, { agentId, content });
  return content;
}

export const updatePlan = internalMutation({
  args: {
    agentId: v.id('agents'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.agentId, { plan: args.content });
  },
});

export const loadPlayer = internalQuery({
  args: {
    playerId: v.id('players'),
  },
  handler: async (ctx, args) => {
    const player = await ctx.db.get(args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    return { player };
  },
});

export const loadAgent = internalQuery({
  args: {
    agentId: v.id('agents'),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) {
      throw new Error(`Agent ${args.agentId} not found`);
    }
    return { agent };
  },
});

export const recallRecentMemories = internalQuery({
  args: {
    playerId: v.id('players'),
    n: v.number(),
    type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const memories = await ctx.db
      .query('memories')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .filter((q) => q.eq(q.field('data.type'), args.type))
      .order('desc')
      .take(args.n);
    return memories;
  },
});

export async function searchMemories(
  ctx: ActionCtx,
  player: Doc<'players'>,
  searchEmbedding: number[],
  n: number = 3,
) {
  const candidates = await ctx.vectorSearch('memoryEmbeddings', 'embedding', {
    vector: searchEmbedding,
    filter: (q) => q.eq('playerId', player._id),
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
    conversationId: v.id('conversations'),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) => q.eq('conversationId', args.conversationId))
      .collect();
    return messages;
  },
});

async function calculateImportance(player: Doc<'players'>, description: string) {
  // TODO: make a better prompt based on the user's memories
  const { content: importanceRaw } = await chatCompletionWithLogging({
    messages: [
      // {
      //   role: 'user',
      //   content: `You are ${player.name}. Here's a little about you:
      //         ${player.description}

      //         Now I'm going to give you a description of a memory to gauge the importance of.`,
      // },
      {
        role: 'user',
        content: `On the scale of 0 to 9, where 0 is purely mundane (e.g., brushing teeth, making bed) and 9 is extremely poignant (e.g., a break up, college acceptance), rate the likely poignancy of the following piece of memory.
        Memory: ${description}
        Answer on a scale of 0 to 9. Respond with number only, e.g. "5"`,
      },
    ],
    temperature: 0.0,
    max_tokens: 1,
    game_id: player.worldId, // TODO: use a different game id
    character_id: player._id,
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
export const startThinking = internalMutation({
  args: {
    agentId: v.id('agents'),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.agentId, { isThinking: { since: args.now } });
  },
});

export const clearThinking = internalMutation({
  args: {
    agentId: v.id('agents'),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) {
      throw new Error(`Agent ${args.agentId} not found`);
    }
    if (!agent.isThinking) {
      return;
    }
    if (agent.isThinking.since !== args.since) {
      return;
    }
    await ctx.db.patch(args.agentId, { isThinking: undefined });
  },
});

export const insertMemory = internalMutation({
  args: {
    agentId: v.id('agents'),
    generationNumber: v.number(),

    embedding: v.array(v.float64()),
    ...memoryFieldsWithoutEmbeddingId,
  },
  handler: async (ctx, { agentId, generationNumber, embedding, ...memory }) => {
    const agent = await ctx.db.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }
    if (agent.generationNumber !== generationNumber) {
      throw new Error(
        `Agent ${agentId} generation number ${agent.generationNumber} does not match ${generationNumber}`,
      );
    }
    // Clear the `isThinking` flag atomically with inserting the memory.
    await ctx.db.patch(agentId, { isThinking: undefined });
    const embeddingId = await ctx.db.insert('memoryEmbeddings', {
      playerId: memory.playerId,
      embedding: embedding,
    });
    await ctx.db.insert('memories', {
      ...memory,
      embeddingId,
    });
  },
});

export async function latestMemoryOfType<T extends MemoryType>(
  db: DatabaseReader,
  playerId: Id<'players'>,
  type: T,
) {
  const entry = await db
    .query('memories')
    .withIndex('playerId_type', (q) => q.eq('playerId', playerId).eq('data.type', type))
    .order('desc')
    .first();
  if (!entry) return null;
  return entry as MemoryOfType<T>;
}

export const memoryTables = {
  memories: defineTable(memoryFields)
    .index('embeddingId', ['embeddingId'])
    .index('playerId_type', ['playerId', 'data.type'])
    .index('playerId', ['playerId']),
  memoryEmbeddings: defineTable({
    playerId: v.id('players'),
    embedding: v.array(v.float64()),
  }).vectorIndex('embedding', {
    vectorField: 'embedding',
    filterFields: ['playerId'],
    dimensions: 1536,
  }),
};
