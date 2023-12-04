import { v } from 'convex/values';
import { Id, Doc } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';
import { internalMutation, internalQuery } from '../_generated/server';
import { loadWorldStatus, stopEngine } from '../aiTown/main';
import { insertInput } from '../aiTown/insertInput';
import { playerId } from './ids';
import { NOTIFICATION_EXPIRY } from '../constants';
import {SerializedPlayer} from './player';
import {
  STATUS_STOPPED_BY_HUMAN_CAUGHT,
  STATUS_LOST_REPORTED,
  STATUS_WON_LAST_HUMAN,
  STATUS_RUNNING,
  STATUS_STOPPED_BY_DEVELOPER,
  STATUS_INACTIVE,
  STATUS_STOPPED_BY_HUMAN_VICTORY,
  STATUS_STOPPED_BY_USER,
  STATUS_PLAYING,
  STATUS_LOST_OTHER_WON,
  STATUS_LOST_LEFT,
  STATUS_WON_CODE,
  StatusType
} from './schema'

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
    const player = await fetchPlayerById(ctx, args.playerId, world);
    if (player.human) {
      // stop game, the player won
      // get user
      const tokenId = player.human; 
      const user = await fetchUserByToken(ctx, tokenId)
      const worldStatus = await loadWorldStatus(ctx.db, args.worldId);
      const engine = await ctx.db.get(worldStatus.engineId);
      if (!worldStatus) {
        throw new Error('World is undefined');
      }
      console.log(`Human Victory! Stopping engine...`);
      const userStatus = worldStatus.userStatus?.map(
        (u) => u.userId === user?._id
        ? { userId: u.userId, status: 'won' }
        : {userId: u.userId, status: u.status === 'playing' ? 'lost-other-won' : u.status},
      )
      await ctx.db.patch(worldStatus._id, { status: 'stoppedByHumanVictory' });
      await stopEngine(ctx, args.worldId);
    } else {
      // continue game
    }
  },
});

export const handleReportedPlayer = internalMutation({
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
    const player = await fetchPlayerById(ctx, args.playerId, world);
    const worldStatus = (await loadWorldStatus(ctx.db, args.worldId))!;
    
    // get all users in game
    let notifyUserIds: Id<'users'>[] = [];
    if (worldStatus.isSoloGame) {
      // there is only one human and it is in the active player list
      const humanPlayer = world.players.find((p) => typeof p.human === 'string');
      if (humanPlayer?.human){
        const soloUser = await fetchUserByToken(ctx, humanPlayer.human);
        notifyUserIds = [soloUser._id];
      }
    } else {
      // use ids present in the user status
      if (worldStatus.userStatus){
        notifyUserIds = worldStatus.userStatus.map((u) => u.userId);
      }
    }

    if (player?.human) {
      console.log(`Human Reported, Booting human ${player.id}...`);
      // Fetch necessary data
      const tokenId = player.human;
      const user = await fetchUserByToken(ctx, tokenId)
      
    
      // Count the number of human players
      const numHumans = world.players.filter((p) => p.human).length;
    
      // Handle game-ending conditions
      if (worldStatus.isSoloGame) {
        await handleSoloEndGame(ctx, worldStatus._id, args.worldId)
      } else if (numHumans === 2) {
        await handleMultiEndGame(ctx, world.players, worldStatus, args.playerId, user)
      } else {
        // game continues, just boot this player
        console.log(`Booting reported player...`);
        const userStatus = worldStatus.userStatus?.map(
          (u) => u.userId === user?._id ? { userId: u.userId, status: 'lost-reported' as const } : u,
        );
        await ctx.db.patch(worldStatus._id, { userStatus });
      }
      // boot!
      await bootPlayer(ctx, args.worldId, player, notifyUserIds)
    } else if (player && !player.hasSecretCode && typeof player.human !== 'string') {
      console.log(`AI Reported, Booting AI ${player.id}...`);
      await bootPlayer(ctx, args.worldId, player, notifyUserIds)
    } else {
      // continue game
    }
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

export async function broadcastNotification(
  ctx: MutationCtx,
  userIds: Id<'users'>[],
  message: string,
  worldId?: Id<'worlds'>,
) {
  const now = Date.now();

  const notificationArgs = {
    message,
    timestamp: now,
    isRead: false,
    expires: now + NOTIFICATION_EXPIRY,
    worldId
  }

  for (const userId of userIds) {
    await ctx.db.insert('notifications', {
      ...notificationArgs,
      userId,
    });
  }
}

export async function bootPlayer(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  player: SerializedPlayer & {name: string},
  notifyUserIds: Id<'users'>[],
) {
  // first send notification to users
  await broadcastNotification(
    ctx,
    notifyUserIds,
    `${player.name} has been reported.`,
    worldId
  );
  // then boot the player
  console.log(`Booting player ${player.id}...`);
  await insertInput(ctx, worldId, 'leave', {
    playerId: player.id,
  });
}


// Function to fetch user
async function fetchUserByToken(
  ctx: MutationCtx,
  tokenId: string,
) {
  return (await ctx.db
    .query('users')
    .withIndex('byTokenId', (q) => q.eq('tokenId', tokenId))
    .first())!;
}

// Function to handle solo game
async function handleSoloEndGame(
  ctx: MutationCtx,
  worldStatusId: Id<'worldStatus'>,
  worldId: Id<'worlds'>
) {
  console.log(`Human Defeat! Stopping engine...`);
  await ctx.db.patch(worldStatusId, { status: STATUS_STOPPED_BY_HUMAN_CAUGHT });
  await stopEngine(ctx, worldId);
}

// Function to handle game with two humans
async function handleMultiEndGame(
  ctx: MutationCtx,
  players: SerializedPlayer[],
  worldStatus: Doc<'worldStatus'>,
  playerId?: string,
  user?: Doc<'users'>
  ) {
  // if playerid, user are passed then that user is reported and loses
  // otherwise, this only gives victory to remaining player
  console.log(`Last man standing wins...`);
  const otherPlayer = players.find((p) => p.human && p.id !== playerId);
  let otherUser: Doc<'users'> | undefined;
  if (!otherPlayer || !otherPlayer.human) {
    console.log('No human players left, stopping engine...');
  } else {
    otherUser = await fetchUserByToken(ctx, otherPlayer.human);
  }
  
  // Assigns lost to the current user, won to other remaining user, and keeps the status for the others
  const userStatus = worldStatus.userStatus?.map(
    (u) =>
    u.userId === user?._id
    ? { userId: u.userId, status: STATUS_LOST_REPORTED as StatusType }
    : {userId: u.userId, status: u.userId === otherUser?._id ? STATUS_WON_LAST_HUMAN : u.status},
  );
  await ctx.db.patch(worldStatus._id, { userStatus, status: STATUS_STOPPED_BY_HUMAN_CAUGHT });
  await stopEngine(ctx, worldStatus.worldId);
}

async function fetchPlayerById(
  ctx: MutationCtx,
  playerId: string,
  world: Doc<'worlds'>
) {
  const player = world.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }
  const playerDescription = await ctx.db
    .query('playerDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', world._id).eq('playerId', playerId))
    .first();
  if (!playerDescription) {
    throw new Error(`Player description for ${playerId} not found`);
  }
  return { name: playerDescription.name, ...player }
}


// check game ending conditions
export async function checkGameEndingConditions(
  ctx: MutationCtx,
  players: SerializedPlayer[],
  worldId: Id<'worlds'>,
) {
  // first fetch world status
  const worldStatus = (await loadWorldStatus(ctx.db, worldId))!;
  const numHumans = players.filter((p) => p.human).length;
  // if game is solo, check if there are no humans, else check if there is only one human
  let minHumans = worldStatus.isSoloGame ? 0 : 1;
  if (numHumans <= minHumans) {
    // game is over
    if (worldStatus.isSoloGame) {
      // solo game
      await handleSoloEndGame(ctx, worldStatus._id, worldId);
    } else {
      // multi game
      await handleMultiEndGame(ctx, players, worldStatus);
    }
  }
}

// marks these players as left / inactive
export async function markPlayersAsLeft(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  removedPlayers: SerializedPlayer[]
) {
  // get all players from party
  const worldStatus = (await loadWorldStatus(ctx.db, worldId))!;
  const notifyUserIds = worldStatus.userStatus?.map((u) => u.userId) || [];
  // the players have left, so 
  let removedUserIds: string[] = [];
  for (const player of removedPlayers) {
    if (player.human) {
      // get user from token
      const tokenId = player.human;
      const user = await fetchUserByToken(ctx, tokenId);
      // check if the player status was playing (hasn't been reported)
      if (worldStatus.userStatus?.find((u) => u.userId === user._id)?.status === STATUS_PLAYING) {
        // mark as left
        removedUserIds.push(user._id);
        await broadcastNotification(
          ctx,
          notifyUserIds,
          `${user.username} has left the game.`,
          worldId
        );
      }
    }
  }
  // now update the user status
  const userStatus = worldStatus.userStatus?.map(
    (u) => removedUserIds.includes(u.userId) ? { userId: u.userId, status: STATUS_LOST_LEFT as StatusType } : u,
  );
  // patch world status
  await ctx.db.patch(worldStatus._id, { userStatus });
}