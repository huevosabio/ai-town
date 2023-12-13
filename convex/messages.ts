import { v } from 'convex/values';
import { mutation, query, action } from './_generated/server';
import { insertInput } from './aiTown/insertInput';
import { conversationId, playerId } from './aiTown/ids';
import {agentOverheardMessages} from './aiTown/agent';
import { api, internal } from './_generated/api';
import { createLanguageService } from 'typescript';

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
      let audioUrl;
      if (message.audioStorageId) {
        audioUrl = await ctx.storage.getUrl(message.audioStorageId);
      }
      out.push({ ...message, authorName: playerDescription.name, audioUrl });
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
    audioStorageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // get th e world
    const world = (await ctx.db.get(args.worldId))!;
    // get the conversation
    const conversation = world.conversations.find((c) => c.id === args.conversationId);
    // get audio
    await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      author: args.playerId,
      messageUuid: args.messageUuid,
      text: args.text,
      worldId: args.worldId,
      eavesdroppers: conversation?.eavesdroppers ?? [],
      seen: false,
      audioStorageId: args.audioStorageId,
    });
    await insertInput(ctx, args.worldId, 'finishSendingMessage', {
      conversationId: args.conversationId,
      playerId: args.playerId,
      timestamp: Date.now(),
    });
  },
});

export const sendMessage = action({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    messageUuid: v.string(),
    playerId,
    text: v.string(),
  },
  handler: async (ctx, args) => {
    // first get the audio
    const { audioStorageId } = (await ctx.runAction(internal.aiTown.agent.getMessageAudio, {
      worldId: args.worldId,
      conversationId: args.conversationId,
      playerId: args.playerId,
      text: args.text,
      messageUuid: args.messageUuid
    }))!;
    // now write the message
    await ctx.runMutation(api.messages.writeMessage, {...args, audioStorageId: audioStorageId});
    // propagate to eavesdroppers
    await ctx.runAction(internal.aiTown.agent.agentOverheardMessages, {
      worldId: args.worldId,
      conversationId: args.conversationId,
      playerId: args.playerId,
      text: args.text,
      messageUuid: args.messageUuid
    });
  },
})

export const lastMessageAudio = query({
  args: {
    worldId: v.id('worlds'),
    conversationId
  },
  handler: async (ctx, args) => {
    // get requester token id
    const identity = (await ctx.auth.getUserIdentity())!;
    // get the world
    const world = (await ctx.db.get(args.worldId))!;
    // get player from id
    const player = (world.players.find((p) => p.human === identity.tokenIdentifier))!;
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) => q.eq('worldId', args.worldId).eq('conversationId', args.conversationId))
      .collect();
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.author !== player.id && lastMessage.audioStorageId){
      const audioUrl = await ctx.storage.getUrl(lastMessage.audioStorageId);
      return {
        ...lastMessage, audioUrl
      }
    }
  }
});

export const markMessageSeen = mutation({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    messageUuid: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db
      .query('messages')
      .withIndex('worldConvMessageUuid', (q) =>
        q.eq('worldId', args.worldId).eq('conversationId', args.conversationId).eq('messageUuid', args.messageUuid),
      )
      .unique();
    if (!message) {
      throw new Error(`Message not found: ${args.messageUuid}`);
    }
    await ctx.db.patch(message._id, { seen: true });
  }
});