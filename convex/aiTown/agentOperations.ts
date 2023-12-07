'use node';

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
  MAX_WANDER_DISTANCE,
  MEMORY_LOOKBACK,
} from '../constants';
import { api, internal } from '../_generated/api';
import { sleep } from '../util/sleep';
import { serializedPlayer } from './player';
import { loadWorldStatus, stopEngine } from '../aiTown/main';
import { insertInput } from '../aiTown/insertInput';
import {getValidMapPoints} from './movement';
import { Point } from '../util/types';
import { distance } from '../util/geometry';

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
          await ctx.runMutation(api.aiTown.main.sendInput, {
            worldId: args.worldId,
            name: 'updateReportedAsHuman',
            args: {
              playerId: args.otherPlayerId,
              reportedAsHuman: true,
            },
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
          await ctx.runMutation(internal.aiTown.zaranovaLogic.handleReportedPlayer, {
            worldId: args.worldId,
            playerId: args.otherPlayerId,
          });
          break;
        case 'shareSecretCode':
          await ctx.runMutation(api.aiTown.main.sendInput, {
            worldId: args.worldId,
            name: 'updateSecretCode',
            args: {
              playerId: args.otherPlayerId,
              hasSecretCode: true,
            },
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
            internal.aiTown.zaranovaLogic.loadAgentFromPlayer, {
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
            await ctx.runMutation(internal.aiTown.zaranovaLogic.stopIfHumanVictory, {
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
      if (true || recentActivity || justLeftConversation) {
        // TODO: note this is always activated! remove the true later on
        await sleep(Math.random() * 1000);
        await ctx.runMutation(api.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishDoSomething',
          args: {
            operationId: args.operationId,
            agentId: agent.id,
            destination: wanderDestination(map, player.position),
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

function wanderDestination(worldMap: WorldMap, position?: Point) {
  // Wander someonewhere at least one tile away from the edge.
  // limit wander distance if we pass a position
  const validPoints = getValidMapPoints(worldMap).filter(
    (p) => position ? distance(p, position) < MAX_WANDER_DISTANCE : true
  );
  const randomIndex = Math.floor(Math.random() * validPoints.length);
  return validPoints[randomIndex];
}
