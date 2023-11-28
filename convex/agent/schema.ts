import { embeddingsCacheTables } from './embeddingsCache';
import { v } from 'convex/values';
import { playerId, conversationId } from '../aiTown/ids';
import { defineTable } from 'convex/server';

export const memoryFields = {
  worldId: v.id('worlds'),
  playerId,
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
      playerId,
    }),
    v.object({
      type: v.literal('conversation'),
      conversationId,
      // The other player(s) in the conversation.
      playerIds: v.array(playerId),
    }),
    v.object({
      type: v.literal('reflection'),
      relatedMemoryIds: v.array(v.id('memories')),
    }),
    v.object({
      type: v.literal('plan'),
      relatedMemoryIds: v.array(v.id('memories')),
    }),
    v.object({
      type: v.literal('event'),
      conversationId: v.optional(conversationId),
      // The other player(s) in the conversation.
      playerIds: v.array(playerId),
    }),
  ),
};
export const memoryTables = {
  memories: defineTable(memoryFields)
    .index('embeddingId', ['embeddingId'])
    .index('playerId_type', ['playerId', 'data.type'])
    .index('playerId', ['playerId'])
    .index('worldId_playerId', ['worldId', 'playerId'])
    .index('worldId_playerId_type', ['worldId', 'playerId', 'data.type']),
  memoryEmbeddings: defineTable({
    worldPlayerId: v.string(), // hacky way to filter for both
    playerId,
    embedding: v.array(v.float64()),
  }).vectorIndex('embedding', {
    vectorField: 'embedding',
    filterFields: ['worldPlayerId', 'playerId'],
    dimensions: 1536,
  }),
};

export const agentTables = {
  ...memoryTables,
  ...embeddingsCacheTables,
};
