import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { WorldMap, serializedWorldMap } from './worldMap';
import { 
  rememberConversation,
  reflectOnRecentConversations,
  createAndUpdatePlan,
  rememberEvent,
} from '../agent/memory';
import { GameId, agentId, conversationId, playerId } from './ids';
import {
  continueConversationMessage,
  leaveConversationMessage,
  startConversationMessage,
} from '../agent/conversation';
import { assertNever } from '../util/assertNever';
import { serializedAgent } from './agent';
import {
  ACTIVITIES,
  ACTIVITY_COOLDOWN,
  CONVERSATION_COOLDOWN,
  MEMORY_LOOKBACK,
} from '../constants';
import { api, internal } from '../_generated/api';
import { sleep } from '../util/sleep';
import { serializedPlayer } from './player';
import { loadWorldStatus, stopEngine } from '../aiTown/main';
import { insertInput } from '../aiTown/insertInput';

export const agentRememberConversation = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    await rememberConversation(
      ctx,
      args.worldId,
      args.agentId as GameId<'agents'>,
      args.playerId as GameId<'players'>,
      args.conversationId as GameId<'conversations'>,
    );
    await sleep(Math.random() * 1000);
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishRememberConversation',
      args: {
        agentId: args.agentId,
        operationId: args.operationId,
      },
    });
  },
});

export const agentGenerateMessage = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    otherPlayerId: playerId,
    operationId: v.string(),
    type: v.union(v.literal('start'), v.literal('continue'), v.literal('leave')),
    messageUuid: v.string(),
  },
  handler: async (ctx, args) => {
    let completionFn;
    switch (args.type) {
      case 'start':
        completionFn = startConversationMessage;
        break;
      case 'continue':
        completionFn = continueConversationMessage;
        break;
      case 'leave':
        completionFn = leaveConversationMessage;
        break;
      default:
        assertNever(args.type);
    }
    const {content, functionCallName} = await completionFn(
      ctx,
      args.worldId,
      args.conversationId as GameId<'conversations'>,
      args.playerId as GameId<'players'>,
      args.otherPlayerId as GameId<'players'>,
    );
    await ctx.runMutation(internal.aiTown.agent.agentSendMessage, {
      worldId: args.worldId,
      conversationId: args.conversationId,
      agentId: args.agentId,
      playerId: args.playerId,
      text: content,
      messageUuid: args.messageUuid,
      leaveConversation: args.type === 'leave',
      operationId: args.operationId,
    });
    // note that this may have issues where it doesn't run because the operation is deleted?
    // check if there are actions that need to affect the world based on functionCallName
    if (functionCallName) {
      switch (functionCallName) {
        case 'reportHuman':
          await ctx.runMutation(internal.aiTown.agentOperations.reportPlayerAsHuman, {
            worldId: args.worldId,
            playerId: args.playerId,
            reportedAsHuman: true,
          });
          // remember that you reported this player as human
          await rememberEvent(
            ctx,
            args.worldId,
            args.agentId as GameId<'agents'>,
            args.playerId as GameId<'players'>,
            args.otherPlayerId as GameId<'players'>,
            'agentReported',
            args.conversationId as GameId<'conversations'>,
          )
          // stop if this is a human
          // this should be a human
          await ctx.runMutation(internal.aiTown.agentOperations.stopIfHumanReported, {
            worldId: args.worldId,
            playerId: args.otherPlayerId,
          });
          // otherwise boot if its an ai
          await ctx.runMutation(internal.aiTown.agentOperations.bootAIIfReported, {
            worldId: args.worldId,
            playerId: args.otherPlayerId,
          });
          break;
        case 'shareSecretCode':
          await ctx.runMutation(internal.aiTown.agentOperations.updatePlayerSecretCode, {
            worldId: args.worldId,
            playerId: args.otherPlayerId,
            hasSecretCode: true,
          });
          // both players should store this action as a memory
          // first store for the sharer
          await rememberEvent(
            ctx,
            args.worldId,
            args.agentId as GameId<'agents'>,
            args.playerId as GameId<'players'>,
            args.otherPlayerId as GameId<'players'>,
            'agentSharedSecretCode',
            args.conversationId as GameId<'conversations'>,
          )
          // now for the receiver
          const otherAgent = await ctx.runQuery(
            internal.aiTown.agentOperations.loadAgentFromPlayer, {
              worldId: args.worldId,
              playerId: args.otherPlayerId
            }
          );
          if (otherAgent) {
            // runs only if the other player is an agent
            await rememberEvent(
              ctx,
              args.worldId,
              otherAgent.id as GameId<'agents'>,
              args.otherPlayerId as GameId<'players'>,
              args.playerId as GameId<'players'>,
              'agentObtainedSecretCode',
              args.conversationId as GameId<'conversations'>,
            )
          } else {
            // this should be a human
            await ctx.runMutation(internal.aiTown.agentOperations.stopIfHumanVictory, {
              worldId: args.worldId,
              playerId: args.otherPlayerId,
            });
          }
          break;
      }
    }
  },
});

export const agentDoSomething = internalAction({
  args: {
    worldId: v.id('worlds'),
    player: v.object(serializedPlayer),
    agent: v.object(serializedAgent),
    map: v.object(serializedWorldMap),
    otherFreePlayers: v.array(v.object(serializedPlayer)),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { player, agent } = args;
    const map = new WorldMap(args.map);
    const now = Date.now();
    // Don't try to start a new conversation if we were just in one.
    const justLeftConversation =
      agent.lastConversation && now < agent.lastConversation + CONVERSATION_COOLDOWN;
    // Don't try again if we recently tried to find someone to invite.
    const recentlyAttemptedInvite =
      agent.lastInviteAttempt && now < agent.lastInviteAttempt + CONVERSATION_COOLDOWN;
    const recentActivity = player.activity && now < player.activity.until + ACTIVITY_COOLDOWN;
    // Decide whether to do an activity or wander somewhere.
    if (!player.pathfinding) {
      if (recentActivity || justLeftConversation) {
        await sleep(Math.random() * 1000);
        await ctx.runMutation(api.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishDoSomething',
          args: {
            operationId: args.operationId,
            agentId: agent.id,
            destination: wanderDestination(map),
          },
        });
        return;
      } else {
        // TODO: have LLM choose the activity & emoji
        const activity = ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)];
        await sleep(Math.random() * 10);
        await ctx.runMutation(api.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishDoSomething',
          args: {
            operationId: args.operationId,
            agentId: agent.id,
            activity: {
              description: activity.description,
              emoji: activity.emoji,
              until: Date.now() + activity.duration,
            },
          },
        });
        return;
      }
    }
    const invitee =
      justLeftConversation || recentlyAttemptedInvite
        ? undefined
        : await ctx.runQuery(internal.aiTown.agent.findConversationCandidate, {
            now,
            worldId: args.worldId,
            player: args.player,
            otherFreePlayers: args.otherFreePlayers,
          });

    // TODO: We hit a lot of OCC errors on sending inputs in this file. It's
    // easy for them to get scheduled at the same time and line up in time.
    await sleep(Math.random() * 1000);
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishDoSomething',
      args: {
        operationId: args.operationId,
        agentId: args.agent.id,
        invitee,
      },
    });
  },
});

export const agentReflectAndUpdatePlan = internalAction({
  args: {
    worldId: v.id('worlds'),
    agentId,
    playerId,
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    // Reflect on recent conversations
    const reflection = (await reflectOnRecentConversations(
      ctx,
      args.worldId,
      args.agentId as GameId<'agents'>,
      args.playerId as GameId<'players'>,
      MEMORY_LOOKBACK
    ))!;
    // Craft new plan based on past plan and reflection, and update
    const newPlan = await createAndUpdatePlan(
      ctx,
      args.worldId,
      args.agentId as GameId<'agents'>,
      args.playerId as GameId<'players'>,
      reflection
    );
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishReflectAndUpdatePlan',
      args: {
        agentId: args.agentId,
        operationId: args.operationId,
      },
    });
  },
});

export const agentRememberRejection = internalAction({
  args: {
    worldId: v.id('worlds'),
    agentId,
    playerId,
    otherPlayerId: playerId,
    conversationId,
    operationId: v.string(),
    rejectedBySelf: v.boolean(),
  },
  handler: async (ctx, args) => {
    console.log('remembering rejection');
    if (args.rejectedBySelf) {
      await rememberEvent(
        ctx,
        args.worldId,
        args.agentId as GameId<'agents'>,
        args.playerId as GameId<'players'>,
        args.otherPlayerId as GameId<'players'>,
        'inviteRejectedBySelf',
        args.conversationId as GameId<'conversations'>,
      )
    } else {
      await rememberEvent(
        ctx,
        args.worldId,
        args.agentId as GameId<'agents'>,
        args.playerId as GameId<'players'>,
        args.otherPlayerId as GameId<'players'>,
        'inviteRejectedByOther',
        args.conversationId as GameId<'conversations'>,
      )
    }
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishRememberRejection',
      args: {
        agentId: args.agentId,
        operationId: args.operationId,
      },
    });
  },
});

export const updatePlayerSecretCode = internalMutation({
  args: {
    worldId: v.id('worlds'),
    playerId,
    hasSecretCode: v.boolean(),
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Invalid player ID: ${args.playerId}`);
    }
    player.hasSecretCode = args.hasSecretCode;
  },
});

export const reportPlayerAsHuman = internalMutation({
  args: {
    worldId: v.id('worlds'),
    playerId,
    reportedAsHuman: v.boolean(),
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Invalid player ID: ${args.playerId}`);
    }
    player.reportedAsHuman = args.reportedAsHuman;
  },
});

export const loadAgentFromPlayer = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    const agent = world.agents.find((a) => a.playerId === args.playerId);
    return agent;
  },
});

export const stopIfHumanVictory = internalMutation({
  args: {
    worldId: v.id('worlds'),
    playerId,
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    // check if player is human
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Invalid player ID: ${args.playerId}`);
    }
    if (player?.human) {
      // stop game, the player won
      const worldStatus = await loadWorldStatus(ctx.db, args.worldId);
      const engine = await ctx.db.get(worldStatus.engineId);
      if (!worldStatus) {
        throw new Error('World is undefined');
      }
      console.log(`Human Victory! Stopping engine...`);
      await ctx.db.patch(worldStatus._id, { status: 'stoppedByHumanVictory' });
      await stopEngine(ctx, args.worldId);
    } else {
      // continue game
    }
  },
});

export const stopIfHumanReported = internalMutation({
  args: {
    worldId: v.id('worlds'),
    playerId,
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    // check if player is human
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Invalid player ID: ${args.playerId}`);
    }
    if (player?.human) {
      // stop game, the player lost
      const worldStatus = await loadWorldStatus(ctx.db, args.worldId);
      const engine = await ctx.db.get(worldStatus.engineId);
      if (!worldStatus) {
        throw new Error('World is undefined');
      }
      console.log(`Human Defeat! Stopping engine...`);
      await ctx.db.patch(worldStatus._id, { status: 'stoppedByHumanCaught' });
      await stopEngine(ctx, args.worldId);
    } else {
      // continue game
    }
  },
});

export const bootAIIfReported = internalMutation({
  args: {
    worldId: v.id('worlds'),
    playerId,
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    // check if player is human
    const player = world.players.find((p) => p.id === args.playerId);
    if (player && !player.hasSecretCode && typeof player.human !== 'string') {
      // AI player is booted
      console.log(`AI Reported, Booting AI ${player.id}...`);
      // removes the player from the world
      await insertInput(ctx, world._id, 'leave', {
        playerId: args.playerId,
      });
    } else {
      // continue game
    }
  },
});

function wanderDestination(worldMap: WorldMap) {
  // Wander someonewhere at least one tile away from the edge.
  return {
    x: 1 + Math.floor(Math.random() * (worldMap.width - 2)),
    y: 1 + Math.floor(Math.random() * (worldMap.height - 2)),
  };
}
