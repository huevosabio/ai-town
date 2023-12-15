import { ObjectType, v } from 'convex/values';
import { GameId, parseGameId } from './ids';
import { agentId, conversationId, playerId } from './ids';
import { serializedPlayer } from './player';
import { Game } from './game';
import {
  ACTION_TIMEOUT,
  AWKWARD_CONVERSATION_TIMEOUT,
  CONVERSATION_COOLDOWN,
  CONVERSATION_DISTANCE,
  INVITE_ACCEPT_PROBABILITY,
  INVITE_TIMEOUT,
  MAX_CONVERSATION_DURATION,
  MAX_CONVERSATION_MESSAGES,
  MESSAGE_COOLDOWN,
  MIDPOINT_THRESHOLD,
  PLAYER_CONVERSATION_COOLDOWN,
  MEMORY_LOOKBACK,
  MAX_INVITE_DISTANCE,
  EAVESDROP_EXPIRY
} from '../constants';
import { FunctionArgs } from 'convex/server';
import { MutationCtx, internalMutation, internalQuery, internalAction} from '../_generated/server';
import { distance } from '../util/geometry';
import { internal } from '../_generated/api';
import { movePlayer } from './movement';
import { insertInput } from './insertInput';
import { rememberOverheardMessage } from '../agent/memory';
import {textToSpeech} from '../util/textToSpeech';

export class Agent {
  id: GameId<'agents'>;
  playerId: GameId<'players'>;
  toRemember?: GameId<'conversations'>;
  toReplan?: boolean;
  toRememberRejection?: {
    conversationId: GameId<'conversations'>;
    otherPlayerId: GameId<'players'>;
  };
  lastConversation?: number;
  lastInviteAttempt?: number;
  inProgressOperation?: {
    name: string;
    operationId: string;
    started: number;
  };
  inProgressSlowOp?: {
    name: string;
    operationId: string;
    started: number;
  };

  constructor(serialized: SerializedAgent) {
    const { id, lastConversation, lastInviteAttempt, inProgressOperation, inProgressSlowOp } = serialized;
    const playerId = parseGameId('players', serialized.playerId);
    this.id = parseGameId('agents', id);
    this.playerId = playerId;
    this.toRemember =
      serialized.toRemember !== undefined
        ? parseGameId('conversations', serialized.toRemember)
        : undefined;
    this.toReplan = 
      serialized.toReplan !== undefined
        ? serialized.toReplan
        : undefined;
    this.toRememberRejection =
        serialized.toRememberRejection !== undefined
          ? {
            conversationId: parseGameId('conversations', serialized.toRememberRejection.conversationId),
            otherPlayerId: parseGameId('players', serialized.toRememberRejection.otherPlayerId),
          }
          : undefined;
    this.lastConversation = lastConversation;
    this.lastInviteAttempt = lastInviteAttempt;
    this.inProgressOperation = inProgressOperation;
    this.inProgressSlowOp = inProgressSlowOp;
  }

  tick(game: Game, now: number) {
    const player = game.world.players.get(this.playerId);
    if (!player) {
      throw new Error(`Invalid player ID ${this.playerId}`);
    }
    // check if we can run a slow operation if so do it
    if (this.inProgressSlowOp) {
      if (now > this.inProgressSlowOp.started + ACTION_TIMEOUT()) {
        // timed out
        console.log(`Timing out ${JSON.stringify(this.inProgressSlowOp)}`);
        delete this.inProgressSlowOp;
      }
    } else {
      // we now can schedule a new slow operation
      // these are the slow operations
      // check if we have to log a rejection
      if (this.toRememberRejection) {
        console.log(`Agent ${this.id} remembering rejection ${this.toRememberRejection}`);
        this.startSlowOperation(game, now, 'agentRememberRejection', {
          worldId: game.worldId,
          agentId: this.id,
          playerId: this.playerId,
          otherPlayerId: this.toRememberRejection.otherPlayerId,
          conversationId: this.toRememberRejection.conversationId,
          rejectedBySelf: false,
        });
        delete this.toRememberRejection;
        return;
      }
      // Check to see if we have a conversation we need to remember.
      if (this.toRemember) {
        // Fire off the action to remember the conversation.
        console.log(`Agent ${this.id} remembering conversation ${this.toRemember}`);
        this.startSlowOperation(game, now, 'agentRememberConversation', {
          worldId: game.worldId,
          playerId: this.playerId,
          agentId: this.id,
          conversationId: this.toRemember,
        });
        delete this.toRemember;
        return;
      }
      // finally if we have to replan, do so
      if (this.toReplan) {
        console.log(`Agent ${this.id} replanning`);
        this.startSlowOperation(game, now, 'agentReflectAndUpdatePlan', {
          worldId: game.worldId,
          playerId: this.playerId,
          agentId: this.id,
        });
        delete this.toReplan;
        return;
      }
    }
    if (this.inProgressOperation) {
      if (now < this.inProgressOperation.started + ACTION_TIMEOUT()) {
        // Wait on the operation to finish.
        return;
      }
      console.log(`Timing out ${JSON.stringify(this.inProgressOperation)}`);
      delete this.inProgressOperation;
    }
    const conversation = game.world.playerConversation(player);
    const member = conversation?.participants.get(player.id);
    
    const recentlyAttemptedInvite =
      this.lastInviteAttempt && now < this.lastInviteAttempt + CONVERSATION_COOLDOWN;
    const doingActivity = player.activity && player.activity.until > now;
    if (doingActivity && (conversation || player.pathfinding)) {
      player.activity!.until = now;
    }
    // If we're not in a conversation, do something.
    // If we aren't doing an activity or moving, do something.
    // If we have been wandering but haven't thought about something to do for
    // a while, do something.
    if (!conversation && !doingActivity && (!player.pathfinding || !recentlyAttemptedInvite)) {
      this.startOperation(game, now, 'agentDoSomething', {
        worldId: game.worldId,
        player: player.serialize(),
        otherFreePlayers: [...game.world.players.values()]
          .filter((p) => p.id !== player.id)
          .filter(
            (p) => ![...game.world.conversations.values()].find((c) => c.participants.has(p.id)),
          )
          .map((p) => p.serialize()),
        agent: this.serialize(),
        map: game.worldMap.serialize(),
      });
      return;
    }
    if (conversation && member) {
      const [otherPlayerId, otherMember] = [...conversation.participants.entries()].find(
        ([id]) => id !== player.id,
      )!;
      const otherPlayer = game.world.players.get(otherPlayerId)!;
      if (member.status.kind === 'invited') {
        // Accept a conversation with another agent with some probability and with
        // a human unconditionally.
        if (otherPlayer.human || Math.random() < INVITE_ACCEPT_PROBABILITY) {
          console.log(`Agent ${player.id} accepting invite from ${otherPlayer.id}`);
          conversation.acceptInvite(game, player);
          // Stop moving so we can start walking towards the other player.
          if (player.pathfinding) {
            delete player.pathfinding;
          }
        } else {
          console.log(`Agent ${player.id} rejecting invite from ${otherPlayer.id}`);
          conversation.rejectInvite(game, now, player);
          // you've initialized a rejection, recall that
          this.startOperation(game, now, 'agentRememberRejection', {
            worldId: game.worldId,
            agentId: this.id,
            playerId: this.playerId,
            otherPlayerId: otherPlayer.id,
            conversationId: conversation.id,
            rejectedBySelf: true,
          });
        }
        return;
      }
      if (member.status.kind === 'walkingOver') {
        // Leave a conversation if we've been waiting for too long.
        if (member.invited + INVITE_TIMEOUT < now) {
          console.log(`Giving up on invite to ${otherPlayer.id}`);
          conversation.leave(game, now, player);
          return;
        }

        // Don't keep moving around if we're near enough.
        const playerDistance = distance(player.position, otherPlayer.position);
        if (playerDistance < CONVERSATION_DISTANCE) {
          return;
        }

        // Keep moving towards the other player.
        // If we're close enough to the player, just walk to them directly.
        if (!player.pathfinding) {
          let destination;
          if (playerDistance < MIDPOINT_THRESHOLD) {
            destination = {
              x: Math.floor(otherPlayer.position.x),
              y: Math.floor(otherPlayer.position.y),
            };
          } else {
            destination = {
              x: Math.floor((player.position.x + otherPlayer.position.x) / 2),
              y: Math.floor((player.position.y + otherPlayer.position.y) / 2),
            };
          }
          console.log(`Agent ${player.id} walking towards ${otherPlayer.id}...`, destination);
          movePlayer(game, now, player, destination);
        }
        return;
      }
      if (member.status.kind === 'participating') {
        const started = member.status.started;
        if (conversation.isTyping && conversation.isTyping.playerId !== player.id) {
          // Wait for the other player to finish typing.
          return;
        }
        if (!conversation.lastMessage) {
          const isInitiator = conversation.creator === player.id;
          const awkwardDeadline = started + AWKWARD_CONVERSATION_TIMEOUT;
          // Send the first message if we're the initiator or if we've been waiting for too long.
          if (isInitiator || awkwardDeadline < now) {
            // Grab the lock on the conversation and send a "start" message.
            console.log(`${player.id} initiating conversation with ${otherPlayer.id}.`);
            const messageUuid = crypto.randomUUID();
            conversation.setIsTyping(now, player, messageUuid);
            this.startOperation(game, now, 'agentGenerateMessage', {
              worldId: game.worldId,
              playerId: player.id,
              agentId: this.id,
              conversationId: conversation.id,
              otherPlayerId: otherPlayer.id,
              messageUuid,
              type: 'start',
            });
            return;
          } else {
            // Wait on the other player to say something up to the awkward deadline.
            return;
          }
        }
        // See if the conversation has been going on too long and decide to leave.
        const tooLongDeadline = started + MAX_CONVERSATION_DURATION;
        if (tooLongDeadline < now || conversation.numMessages > MAX_CONVERSATION_MESSAGES) {
          console.log(`${player.id} leaving conversation with ${otherPlayer.id}.`);
          const messageUuid = crypto.randomUUID();
          conversation.setIsTyping(now, player, messageUuid);
          this.startOperation(game, now, 'agentGenerateMessage', {
            worldId: game.worldId,
            playerId: player.id,
            agentId: this.id,
            conversationId: conversation.id,
            otherPlayerId: otherPlayer.id,
            messageUuid,
            type: 'leave',
          });
          return;
        }
        // Wait for the awkward deadline if we sent the last message.
        if (conversation.lastMessage.author === player.id) {
          const awkwardDeadline = conversation.lastMessage.timestamp + AWKWARD_CONVERSATION_TIMEOUT;
          if (now < awkwardDeadline) {
            return;
          }
        }
        // Wait for a cooldown after the last message to simulate "reading" the message.
        const messageCooldown = conversation.lastMessage.timestamp + MESSAGE_COOLDOWN;
        if (now < messageCooldown) {
          return;
        }
        // Grab the lock and send a message!
        console.log(`${player.id} continuing conversation with ${otherPlayer.id}.`);
        const messageUuid = crypto.randomUUID();
        conversation.setIsTyping(now, player, messageUuid);
        this.startOperation(game, now, 'agentGenerateMessage', {
          worldId: game.worldId,
          playerId: player.id,
          agentId: this.id,
          conversationId: conversation.id,
          otherPlayerId: otherPlayer.id,
          messageUuid,
          type: 'continue',
        });
        return;
      }
    }
  }

  startOperation<Name extends keyof AgentOperations>(
    game: Game,
    now: number,
    name: Name,
    args: Omit<FunctionArgs<AgentOperations[Name]>, 'operationId'>,
  ) {
    if (this.inProgressOperation) {
      throw new Error(
        `Agent ${this.id} already has an operation: ${JSON.stringify(this.inProgressOperation)}`,
      );
    }
    const operationId = game.allocId('operations');
    console.log(`Agent ${this.id} starting operation ${name} (${operationId})`);
    game.scheduleOperation(name, { operationId, ...args } as any);
    this.inProgressOperation = {
      name,
      operationId,
      started: now,
    };
  }

  startSlowOperation<Name extends keyof AgentOperations>(
    game: Game,
    now: number,
    name: Name,
    args: Omit<FunctionArgs<AgentOperations[Name]>, 'operationId'>,
  ) {
    if (this.inProgressSlowOp) {
      throw new Error(
        `Agent ${this.id} already has an operation: ${JSON.stringify(this.inProgressSlowOp)}`,
      );
    }
    const operationId = game.allocId('operations');
    console.log(`Agent ${this.id} starting operation ${name} (${operationId})`);
    game.scheduleOperation(name, { operationId, ...args } as any);
    this.inProgressSlowOp = {
      name,
      operationId,
      started: now,
    };
  }


  serialize(): SerializedAgent {
    return {
      id: this.id,
      playerId: this.playerId,
      toRemember: this.toRemember,
      toReplan: this.toReplan,
      toRememberRejection: this.toRememberRejection,
      lastConversation: this.lastConversation,
      lastInviteAttempt: this.lastInviteAttempt,
      inProgressOperation: this.inProgressOperation,
      inProgressSlowOp: this.inProgressSlowOp,
    };
  }
}

export const serializedAgent = {
  id: agentId,
  playerId: playerId,
  toRemember: v.optional(conversationId),
  toReplan: v.optional(v.boolean()),
  toRememberRejection: v.optional(v.object({
    conversationId: conversationId,
    otherPlayerId: playerId,
  })),
  lastConversation: v.optional(v.number()),
  lastInviteAttempt: v.optional(v.number()),
  inProgressOperation: v.optional(
    v.object({
      name: v.string(),
      operationId: v.string(),
      started: v.number(),
    }),
  ),
  inProgressSlowOp: v.optional(
    v.object({
      name: v.string(),
      operationId: v.string(),
      started: v.number(),
    }),
  ),
};
export type SerializedAgent = ObjectType<typeof serializedAgent>;

type AgentOperations = typeof internal.aiTown.agentOperations;

export async function runAgentOperation(ctx: MutationCtx, operation: string, args: any) {
  let reference;
  switch (operation) {
    case 'agentRememberConversation':
      reference = internal.aiTown.agentOperations.agentRememberConversation;
      break;
    case 'agentGenerateMessage':
      reference = internal.aiTown.agentOperations.agentGenerateMessage;
      break;
    case 'agentDoSomething':
      reference = internal.aiTown.agentOperations.agentDoSomething;
      break;
    case 'agentRememberRejection':
      reference = internal.aiTown.agentOperations.agentRememberRejection;
      break;
    case 'agentReflectAndUpdatePlan':
      reference = internal.aiTown.agentOperations.agentReflectAndUpdatePlan;
      break;
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
  await ctx.scheduler.runAfter(0, reference, args);
}

export const agentSendMessage = internalMutation({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    agentId,
    playerId,
    text: v.string(),
    messageUuid: v.string(),
    leaveConversation: v.boolean(),
    operationId: v.string(),
    audioStorageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // get the world
    const world = (await ctx.db.get(args.worldId))!;
    // get the conversation
    const conversation = world.conversations.find((c) => c.id === args.conversationId);
    const participantsIds = conversation?.participants.map((p) => p.playerId) ?? [];
    const author = args.playerId;
    const otherPlayerId = participantsIds.find((id) => id !== author);
    await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      author,
      text: args.text,
      messageUuid: args.messageUuid,
      worldId: args.worldId,
      eavesdroppers: conversation?.eavesdroppers ?? [],
      seen: false,
      audioStorageId: args.audioStorageId
    });
    await insertInput(ctx, args.worldId, 'agentFinishSendingMessage', {
      conversationId: args.conversationId,
      agentId: args.agentId,
      timestamp: Date.now(),
      leaveConversation: args.leaveConversation,
      operationId: args.operationId,
    });
  },
});

export const findConversationCandidate = internalQuery({
  args: {
    now: v.number(),
    worldId: v.id('worlds'),
    player: v.object(serializedPlayer),
    otherFreePlayers: v.array(v.object(serializedPlayer)),
  },
  handler: async (ctx, { now, worldId, player, otherFreePlayers }) => {
    const { position } = player;
    const candidates = [];

    for (const otherPlayer of otherFreePlayers) {
      // Find the latest conversation we're both members of.
      const lastMember = await ctx.db
        .query('participatedTogether')
        .withIndex('edge', (q) =>
          q.eq('worldId', worldId).eq('player1', player.id).eq('player2', otherPlayer.id),
        )
        .order('desc')
        .first();
      if (lastMember) {
        if (now < lastMember.ended + PLAYER_CONVERSATION_COOLDOWN) {
          continue;
        }
      }
      // finaly check if we're close enough
      if (distance(position, otherPlayer.position) > MAX_INVITE_DISTANCE) {
        continue;
      }
      candidates.push({ id: otherPlayer.id, position });
    }

    // Sort by distance and take the nearest candidate.
    candidates.sort((a, b) => distance(a.position, position) - distance(b.position, position));
    return candidates[0]?.id;
  },
});

export const agentOverheardMessages = internalAction({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    playerId,
    text: v.string(),
    messageUuid: v.string(),
  },
  handler: async (ctx, args) => {
    // save message as eavesdrop to all relevant agents
    // get the world
    const {world} = (await ctx.runQuery(internal.agent.memory.loadWorld, { worldId: args.worldId }))!;
    // get the conversation
    const conversation = world.conversations.find((c) => c.id === args.conversationId);
    const participantsIds = conversation?.participants.map((p) => p.playerId) ?? [];
    const author = args.playerId;
    const otherPlayerId = participantsIds.find((id) => id !== author);
    // for each eavesdropper, remember the message as a memory
    for (const eavesdropperId of conversation?.eavesdroppers ?? []) {
      // load the agent if it is not human
      const eavesdropperAgent = world.agents.find((a) => a.playerId === eavesdropperId);
      const promises = [];
      if (eavesdropperAgent) {
        // remember the message
        promises.push(rememberOverheardMessage(
          ctx,
          args.worldId,
          eavesdropperAgent.id as GameId<'agents'>,
          eavesdropperId as GameId<'players'>,
          author as GameId<'players'>,
          otherPlayerId as GameId<'players'>,
          args.conversationId as GameId<'conversations'>,
          args.text,
        ));
      }
      await Promise.all(promises);
      // you need to send a rememberEvent with the participants but also with the message
      // I need to alter remember event
    }
  },
});

export const getMessageAudio = internalAction({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    playerId,
    text: v.string(),
    messageUuid: v.string(),
  },
  handler: async (ctx, args) => {
    // get conversation participants
    const {world} = (await ctx.runQuery(internal.agent.memory.loadWorld, { worldId: args.worldId }))!;
    const playerDescription = (await ctx.runQuery(
      internal.aiTown.agent.loadPlayerDescriptionFromId,
      {worldId: args.worldId, playerId: args.playerId}
    ))!;
    const conversation = world.conversations.find((c) => c.id === args.conversationId);
    const otherPlayerId = conversation?.participants.find((p) => p.playerId !== args.playerId)?.playerId;
    const otherPlayer = world.players.find((p) => p.id === otherPlayerId);
    const humanEavesdroppers = world.players.filter((p) => conversation?.eavesdroppers.includes(p.id) &&  p.human);
  
    const isHumanAudience = humanEavesdroppers.length > 0 || (otherPlayer && otherPlayer.human);
    if (!isHumanAudience) {
      // don't generate audio for non-human audiences
      return {audioStorageId: undefined};
    }
    // fetches the message audio
    const audio = await textToSpeech(args.text, playerDescription.avatar_voice_url);
    // stores the message as an audio file
    const audioStorageId = await ctx.storage.store(audio);
    const audioStorageUrl = (await ctx.storage.getUrl(audioStorageId))!;

    // pushes to eavesdrop feed of each human eavesdropper
    for (const eavesdropper of humanEavesdroppers) {
      if (!eavesdropper.human) {
        // this is redundant, but type checker complains otherwise
        continue;
      }
      await ctx.runMutation(internal.aiTown.agent.pushToEavesdropFeed, {
        worldId: args.worldId,
        tokenId: eavesdropper.human,
        audioUrl: audioStorageUrl,
        authorId: args.playerId,
      });
    }

    return { audioStorageId };
  },
});

export const pushToEavesdropFeed = internalMutation({
  args: {
    worldId: v.id('worlds'),
    tokenId: v.string(),
    audioUrl: v.string(),
    authorId: playerId,
  },
  handler: async (ctx, args) => {
    // get user id
    const user = (await ctx.db
      .query('users')
      .withIndex('byTokenId', (q) => q.eq('tokenId', args.tokenId))
      .first())!;
    // insert into user feed
    const now = Date.now();
    await ctx.db.insert('eavesdropFeed', {
      worldId: args.worldId,
      userId: user._id,
      audioUrl: args.audioUrl,
      timestamp: now,
      isRead: false,
      expires: now + EAVESDROP_EXPIRY,
      authorId: args.authorId,
    });
  }
});


export const patchMessageWithAudio = internalMutation({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    messageUuid: v.string(),
    audioStorageId: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db
      .query('messages')
      .withIndex('worldConvMessageUuid', (q) =>
        q.eq('worldId', args.worldId).eq('conversationId', args.conversationId).eq('messageUuid', args.messageUuid),
      )
      .first();
    if (message){
      await ctx.db.patch(message._id, {
        audioStorageId: args.audioStorageId,
      });
    }
  },
});

export const loadPlayerDescriptionFromId = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId: playerId,
  },
  handler: async (ctx, args) => {
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    return playerDescription;
  },
});