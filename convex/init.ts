import { v } from 'convex/values';
import { api, internal } from './_generated/api';
import {
  DatabaseReader,
  DatabaseWriter,
  MutationCtx,
  internalMutation,
  mutation,
} from './_generated/server';
import { Descriptions } from '../data/characters';
//import * as firstmap from '../data/firstmap';
import * as firstmap from '../data/zaramap';
import { insertInput } from './game/main';
import { initAgent, kickAgents, stopAgents } from './agent/init';
import { Doc, Id } from './_generated/dataModel';
import { createEngine, kickEngine, startEngine, stopEngine } from './engine/game';

const DEFAULT_NUM_AGENTS = 4;

// this has been edited significantly so that worlds are created via the UI
export const init = mutation({
  args: {
    numAgents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!process.env.OPENAI_API_KEY) {
      const deploymentName = process.env.CONVEX_CLOUD_URL?.slice(8).replace('.convex.cloud', '');
      throw new Error(
        '\n  Missing OPENAI_API_KEY in environment variables.\n\n' +
          '  Get one at https://openai.com/\n\n' +
          '  Paste it on the Convex dashboard:\n' +
          '  https://dashboard.convex.dev/d/' +
          deploymentName +
          '/settings?var=OPENAI_API_KEY',
      );
    }
    // first find if there is a current running, stop and archive it
    await stopDefaultWorld(ctx);
    const { world, engine } = await createWorld(ctx); // which is tied to the user
    if (world.status !== 'running') {
      console.warn(
        `Engine ${engine._id} is not active! Run "npx convex run init:resume" to restart it.`,
      );
      return;
    }
    // Send inputs to create players for all of the agents.
    // This the human player gets assigned one of the characters.
    const identity = (await ctx.auth.getUserIdentity())!;
    // choose at random from the available characters, removes one as one has the secret code
    const numAgents = Math.min(args.numAgents ?? DEFAULT_NUM_AGENTS, Descriptions.length);
    const user_number = Math.floor(Math.random() * (numAgents - 1));
    console.log('creating characters');
    console.log('user_number', user_number);
    console.log('numAgents', numAgents);
    let count = 0;
    if (await shouldCreateAgents(ctx.db, world)) {
      let numCreated = 0;
      for (const agent of Descriptions) {
        if (numCreated >= numAgents) {
          break;
        }
        let description = agent.identity;
        let tokenIdentifier = undefined;
        if (count === user_number && !agent.hasSecretCode) {
          description = `${identity.givenName} has infiltrated as ${agent.name}`;
          tokenIdentifier = identity.tokenIdentifier;
          count++;
        } else if (!agent.hasSecretCode) {
          // not a user but also not the secret code, just increase counter
          count++;
        }
        const inputId = await insertInput(ctx, world._id, 'join', {
          name: agent.name,
          description: agent.identity,
          character: agent.character,
          tokenIdentifier: tokenIdentifier,
          hasSecretCode: agent.hasSecretCode,
          reportedAsHuman: agent.reportedAsHuman,
        });
        if (!tokenIdentifier){
          await ctx.scheduler.runAfter(1000, internal.init.completeAgentCreation, {
            worldId: world._id,
            joinInputId: inputId,
            character: agent.character,
          });
          
        }
        numCreated++;
      }
    }
  },
});
export default init;

export const kick = internalMutation({
  handler: async (ctx) => {
    const { world, engine } = await getDefaultWorld(ctx);
    if (!world || !engine) {
      throw new Error('World or engine is undefined');
    }
    await kickEngine(ctx, internal.game.main.runStep, engine._id);
    await kickAgents(ctx, { worldId: world._id });
  },
});

export const stop = internalMutation({
  handler: async (ctx) => {
    const { world, engine } = await getDefaultWorld(ctx);
    if (!world || !engine) {
      throw new Error('World or engine is undefined');
    }
    if (world.status === 'inactive' || world.status === 'stoppedByDeveloper') {
      if (engine.state.kind !== 'stopped') {
        throw new Error(`Engine ${engine._id} isn't stopped?`);
      }
      console.debug(`World ${world._id} is already inactive`);
      return;
    }
    console.log(`Stopping engine ${engine._id}...`);
    await ctx.db.patch(world._id, { status: 'stoppedByDeveloper' });
    await stopEngine(ctx, engine._id);
    await stopAgents(ctx, { worldId: world._id });
  },
});

export const resume = internalMutation({
  handler: async (ctx) => {
    const { world, engine } = await getDefaultWorld(ctx);
    if (!world || !engine) {
      throw new Error('World or engine is undefined');
    }
    if (world.status === 'running') {
      if (engine.state.kind !== 'running') {
        throw new Error(`Engine ${engine._id} isn't running?`);
      }
      console.debug(`World ${world._id} is already running`);
      return;
    }
    console.log(`Resuming engine ${engine._id} for world ${world._id} (state: ${world.status})...`);
    await ctx.db.patch(world._id, { status: 'running' });
    await startEngine(ctx, internal.game.main.runStep, engine._id);
    await kickAgents(ctx, { worldId: world._id });
  },
});

export const archive = internalMutation({
  handler: async (ctx) => {
    const { world, engine } = await getDefaultWorld(ctx);
    if (!world || !engine) {
      throw new Error('World or engine is undefined');
    }
    if (engine.state.kind === 'running') {
      throw new Error(`Engine ${engine._id} is still running!`);
    }
    console.log(`Archiving world ${world._id}...`);
    await ctx.db.patch(world._id, { isDefault: false });
  },
});

export async function getDefaultWorld(ctx: MutationCtx, userId?: string) {
  if (!userId){
    const identity = (await ctx.auth.getUserIdentity())!;
    userId = identity.tokenIdentifier;
  }
  
  const world = await ctx.db
    .query('worlds')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .filter((q) => q.eq(q.field('userId'), userId))
    .first();
  if (!world) {
    console.log('No default world found');
    return { world: undefined, engine: undefined};
  }
  const engine = await ctx.db.get(world.engineId);
  if (!engine) {
    console.debug(`Engine ${world.engineId} not found`);
  }
  return { world, engine };
}

// creates a new world
async function createWorld(ctx: MutationCtx) {
  // get authed user
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('No user identity found');
  }
  const engineId = await createEngine(ctx, internal.game.main.runStep);
  const mapId = await ctx.db.insert('maps', {
    width: firstmap.mapWidth,
    height: firstmap.mapHeight,
    tileSetUrl: firstmap.tilesetPath,
    tileSetDim: firstmap.tileFileDim,
    tileDim: firstmap.tileDim,
    bgTiles: firstmap.bgTiles,
    objectTiles: firstmap.objmap,
  });
  const worldId = await ctx.db.insert('worlds', {
    engineId,
    isDefault: true,
    lastViewed: Date.now(),
    mapId,
    status: 'running',
    userId: identity.tokenIdentifier,
  });
  const world = (await ctx.db.get(worldId))!;
  const engine = (await ctx.db.get(world.engineId))!;
  return {world, engine};
}

async function getOrCreateDefaultWorld(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('No user identity found');
  }
  let world = await ctx.db
    .query('worlds')
    .filter((q) => q.eq(q.field('userId'), identity.tokenIdentifier))
    .filter((q) => q.eq(q.field('isDefault'), true))
    .first();
  let engine = undefined;
  if (!world) {
    // create a world
    return await createWorld(ctx);
  } else {
    engine = await ctx.db.get(world.engineId);
  }
  return { world, engine };
}

async function shouldCreateAgents(db: DatabaseReader, world: Doc<'worlds'>) {
  const players = await db
    .query('players')
    .withIndex('active', (q) => q.eq('worldId', world._id))
    .collect();
  for (const player of players) {
    const agent = await db
      .query('agents')
      .withIndex('playerId', (q) => q.eq('playerId', player._id))
      .first();
    if (agent) {
      return false;
    }
  }
  const unactionedJoinInputs = await db
    .query('inputs')
    .withIndex('byInputNumber', (q) => q.eq('engineId', world.engineId))
    .order('asc')
    .filter((q) => q.eq(q.field('name'), 'join'))
    .filter((q) => q.eq(q.field('returnValue'), undefined))
    .collect();
  if (unactionedJoinInputs.length > 0) {
    return false;
  }
  return true;
}

export const completeAgentCreation = internalMutation({
  args: {
    worldId: v.id('worlds'),
    joinInputId: v.id('inputs'),
    character: v.string(),
  },
  handler: async (ctx, args) => {
    const input = await ctx.db.get(args.joinInputId);
    if (!input || input.name !== 'join') {
      throw new Error(`Invalid input ID ${args.joinInputId}`);
    }
    const { returnValue } = input;
    if (!returnValue) {
      console.warn(`Input ${input._id} not ready, waiting...`);
      ctx.scheduler.runAfter(5000, internal.init.completeAgentCreation, args);
      return;
    }
    if (returnValue.kind === 'error') {
      throw new Error(`Error creating agent: ${returnValue.message}`);
    }
    const playerId = returnValue.value;
    const existingAgent = await ctx.db
      .query('agents')
      .withIndex('playerId', (q) => q.eq('playerId', playerId))
      .first();
    if (existingAgent) {
      throw new Error(`Agent for player ${playerId} already exists`);
    }
    await initAgent(ctx, { worldId: args.worldId, playerId, character: args.character });
  },
});

export async function getActiveWorlds(db: DatabaseReader) {
  const worlds = await db
    .query('worlds')
    .filter((q) => q.eq(q.field('status'), 'running'))
    .collect();
  if (!worlds) {
    throw new Error('No active worlds found');
  }
  return { worlds };
}

export const stopAll = internalMutation({
  handler: async (ctx) => {
    const { worlds } = await getActiveWorlds(ctx.db);
    // iterate through all worlds and engines
    for (const world of worlds) {
      const engine = await ctx.db.get(world.engineId);
      if (!engine) {
        throw new Error(`Engine ${world.engineId} not found`);
      }
      console.log(`Stopping engine ${engine._id}...`);
      await ctx.db.patch(world._id, { status: 'stoppedByDeveloper' });
      await stopEngine(ctx, engine._id);
      await stopAgents(ctx, { worldId: world._id });
    }
  },
});

export async function stopDefaultWorld(ctx: MutationCtx) {
  // stops default world if it exists and is running
  const { world, engine } = await getDefaultWorld(ctx);
  if (world && engine){
    if (world.status !== 'running') {
      if (engine.state.kind !== 'stopped') {
        console.debug(`Engine ${engine._id} isn't stopped but should!`);
        console.log(`Stopping engine ${engine._id}...`);
        await stopEngine(ctx, engine._id);
        await stopAgents(ctx, { worldId: world._id });
      } else {
        console.debug(`Engine ${engine._id} is already stopped, removing default flag`);
      }
      await ctx.db.patch(world._id, { isDefault: false });
      return;
    }
    console.log(`Stopping engine ${engine._id}...`);
    await ctx.db.patch(world._id, { status: 'stoppedByUser', isDefault: false });
    await stopEngine(ctx, engine._id);
    await stopAgents(ctx, { worldId: world._id });
  }
}