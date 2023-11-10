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