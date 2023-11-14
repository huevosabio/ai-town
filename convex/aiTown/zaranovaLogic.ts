import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { loadWorldStatus, stopEngine } from '../aiTown/main';
import { insertInput } from '../aiTown/insertInput';
import { playerId } from './ids';


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
    if (player.human) {
      // stop game, the player won
      // get user
      const tokenId = player.human; 
      const user = await ctx.db
        .query('users')
        .withIndex('byTokenId', (q) => q.eq('tokenId', tokenId))
        .first()
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
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Invalid player ID: ${args.playerId}`);
    }
    if (player?.human) {
      // Fetch necessary data
      const tokenId = player.human;
      const user = await ctx.db
        .query('users')
        .withIndex('byTokenId', (q) => q.eq('tokenId', tokenId))
        .first();
      const worldStatus = (await loadWorldStatus(ctx.db, args.worldId))!;
    
      // Count the number of human players
      const numHumans = world.players.filter((p) => p.human).length;
    
      // Handle game-ending conditions
      if (worldStatus.isSoloGame) {
        console.log(`Human Defeat! Stopping engine...`);
        await ctx.db.patch(worldStatus._id, { status: 'stoppedByHumanCaught' });
        await stopEngine(ctx, args.worldId);
      } else if (numHumans === 2) {
        console.log(`Last man standing wins...`);
        const otherPlayer = world.players.find((p) => p.human && p.id !== args.playerId);
        if (!otherPlayer || !otherPlayer.human) {
          throw new Error(`Invalid other player ID or token: ${args.playerId}`);
        }
        const otherTokenId = otherPlayer.human;
        const otherUser = await ctx.db
          .query('users')
          .withIndex('byTokenId', (q) => q.eq('tokenId', otherTokenId))
          .first();
        if (!otherUser) {
          throw new Error(`Invalid other user ID: ${otherPlayer.id}`);
        }
        
        // assigns lost to the current user, won to other remaining user, and keeps the status for the others
        const userStatus = worldStatus.userStatus?.map(
          (u) =>
          u.userId === user?._id
          ? { userId: u.userId, status: 'lost-reported' as const }
          : {userId: u.userId, status: u.userId === otherUser._id ? 'won-last-human'as const : u.status},
        );
        await ctx.db.patch(worldStatus._id, { userStatus, status: 'stoppedByHumanCaught'  });
        await stopEngine(ctx, args.worldId);
      } else {
        // game continues, just boot this player
        console.log(`Booting reported player...`);
        const userStatus = worldStatus.userStatus?.map(
          (u) => u.userId === user?._id ? { userId: u.userId, status: 'lost-reported' as const } : u,
        );
        await ctx.db.patch(worldStatus._id, { userStatus });
        await insertInput(ctx, world._id, 'leave', {
          playerId: args.playerId,
        });
      }
    } else if (player && !player.hasSecretCode && typeof player.human !== 'string') {
      console.log(`AI Reported, Booting AI ${player.id}...`);
      await insertInput(ctx, world._id, 'leave', {
        playerId: args.playerId,
      });
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