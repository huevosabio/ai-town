import { v } from 'convex/values';
import { mutation, query, action } from './_generated/server';
import { insertInput } from './aiTown/insertInput';
import { conversationId, playerId } from './aiTown/ids';
import {agentOverheardMessages} from './aiTown/agent';
import { api, internal } from './_generated/api';

export const listMessages = query({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    eavesdropperId: v.optional(playerId),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) => q.eq('worldId', args.worldId).eq('conversationId', args.conversationId))
      .collect();
    const out = [];
    for (const message of messages) {
      if (args.eavesdropperId && !message.eavesdroppers.includes(args.eavesdropperId)) {
        continue;
      }
      const playerDescription = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', message.author))
        .first();
      if (!playerDescription) {
        throw new Error(`Invalid author ID: ${message.author}`);
      }
      out.push({ ...message, authorName: playerDescription.name });
    }
    return out;
  },
});

export const writeMessage = mutation({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    messageUuid: v.string(),
    playerId,
    text: v.string(),
  },
  handler: async (ctx, args) => {
    // get th e world
    const world = (await ctx.db.get(args.worldId))!;
    // get the conversation
    const conversation = world.conversations.find((c) => c.id === args.conversationId);
    await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      author: args.playerId,
      messageUuid: args.messageUuid,
      text: args.text,
      worldId: args.worldId,
      eavesdroppers: conversation?.eavesdroppers ?? [],
    });
    await insertInput(ctx, args.worldId, 'finishSendingMessage', {
      conversationId: args.conversationId,
      playerId: args.playerId,
      timestamp: Date.now(),
    });
  },
});

export const propagateToEavesDroppers = action({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    messageUuid: v.string(),
    playerId,
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runAction(internal.aiTown.agent.agentOverheardMessages, {
      worldId: args.worldId,
      conversationId: args.conversationId,
      playerId: args.playerId,
      text: args.text,
      messageUuid: args.messageUuid
    });
  },
});
