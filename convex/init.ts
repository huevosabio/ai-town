import { v } from 'convex/values';
import { internal } from './_generated/api';
import { DatabaseReader, MutationCtx, mutation, internalMutation } from './_generated/server';
import { Descriptions } from '../data/characters';
//import * as map from '../data/zaramap';
import * as map from '../data/gentle';
import { insertInput } from './aiTown/insertInput';
import { Id } from './_generated/dataModel';
import { createEngine, stopEngine } from './aiTown/main';
import { ENGINE_ACTION_DURATION, DEFAULT_NUM_AGENTS} from './constants';

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
    const { worldStatus, engine } = await createWorld(ctx); // which is tied to the user
    if (worldStatus.status !== 'running') {
      console.warn(
        `Engine ${engine._id} is not active! Run "npx convex run testing:resume" to restart it.`,
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
    const shouldCreate = await shouldCreateAgents(
      ctx.db,
      worldStatus.worldId,
      worldStatus.engineId,
    );
    if (shouldCreate) {
      let numCreated = 0;
      for (const agent of Descriptions) {
        if (numCreated >= numAgents) {
          break;
        }
        let description = agent.identity;
        let tokenIdentifier = undefined;
        if (count === user_number && !agent.hasSecretCode) {
          // this is a human!
          description = `${identity.givenName} has infiltrated as ${agent.name}`;
          tokenIdentifier = identity.tokenIdentifier;
          await insertInput(ctx, worldStatus.worldId, 'join', {
            name: agent.name,
            description: description,
            character: agent.character,
            tokenIdentifier: tokenIdentifier,
            hasSecretCode: agent.hasSecretCode,
            reportedAsHuman: agent.reportedAsHuman,
          });
          count++;
          continue;
        } else if (!agent.hasSecretCode) {
          // not a user but also not the secret code, just increase counter
          count++;
        }
        await insertInput(ctx, worldStatus.worldId, 'createAgent', {
          descriptionIndex: numCreated,
          hasSecretCode: agent.hasSecretCode,
        });
        numCreated++;
      }
    }
  },
});
export default init;

export async function getDefaultWorld(ctx: MutationCtx, userId?: string) {
  if (!userId){
    const identity = (await ctx.auth.getUserIdentity())!;
    userId = identity.tokenIdentifier;
  }

  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('No user identity found');
  }
  const now = Date.now();

  let worldStatus = await ctx.db
    .query('worldStatus')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .unique();
  if (worldStatus) {
    const engine = (await ctx.db.get(worldStatus.engineId))!;
    return { worldStatus, engine };
  } else {
    return { worldStatus: undefined, engine: undefined };
  }
}

async function createWorld(ctx: MutationCtx) {
  const now = Date.now();
  // get authed user
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('No user identity found');
  }
  const engineId = await createEngine(ctx);
  const engine = (await ctx.db.get(engineId))!;
  const worldId = await ctx.db.insert('worlds', {
    nextId: 0,
    agents: [],
    conversations: [],
    players: [],
  });
  const worldStatusId = await ctx.db.insert('worldStatus', {
    engineId: engineId,
    isDefault: true,
    lastViewed: now,
    status: 'running',
    worldId: worldId,
    userId: identity.tokenIdentifier,
  });
  const worldStatus = (await ctx.db.get(worldStatusId))!;
  await ctx.db.insert('maps', {
    worldId,
    width: map.mapwidth,
    height: map.mapheight,
    tileSetUrl: map.tilesetpath,
    tileSetDimX: map.tilesetpxw,
    tileSetDimY: map.tilesetpxh,
    tileDim: map.tiledim,
    bgTiles: map.bgtiles,
    objectTiles: map.objmap,
    animatedSprites: map.animatedsprites,
  });
  await ctx.scheduler.runAfter(0, internal.aiTown.main.runStep, {
    worldId,
    generationNumber: engine.generationNumber,
    maxDuration: ENGINE_ACTION_DURATION,
  });
  return { worldStatus, engine };
}


async function getOrCreateDefaultWorld(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('No user identity found');
  }
  const now = Date.now();

  const {worldStatus, engine } = await getDefaultWorld(ctx, identity.tokenIdentifier);

  if (worldStatus) {
    return { worldStatus, engine };
  }

  return await createWorld(ctx);
}

async function shouldCreateAgents(
  db: DatabaseReader,
  worldId: Id<'worlds'>,
  engineId: Id<'engines'>,
) {
  const world = await db.get(worldId);
  if (!world) {
    throw new Error(`Invalid world ID: ${worldId}`);
  }
  if (world.agents.length > 0) {
    return false;
  }
  const unactionedJoinInputs = await db
    .query('inputs')
    .withIndex('byInputNumber', (q) => q.eq('engineId', engineId))
    .order('asc')
    .filter((q) => q.eq(q.field('name'), 'createAgent'))
    .filter((q) => q.eq(q.field('returnValue'), undefined))
    .collect();
  if (unactionedJoinInputs.length > 0) {
    return false;
  }
  return true;
}

export async function getActiveWorlds(db: DatabaseReader) {
  const worlds = await db
    .query('worldStatus')
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
    for (const worldStatus of worlds) {
      const engine = await ctx.db.get(worldStatus.engineId);
      if (!engine) {
        throw new Error(`Engine ${worldStatus.engineId} not found`);
      }
      console.log(`Stopping engine ${engine._id}...`);
      await ctx.db.patch(worldStatus._id, { status: 'stoppedByDeveloper' });
      await stopEngine(ctx, worldStatus.worldId);
    }
  },
});

export async function stopDefaultWorld(ctx: MutationCtx) {
  // stops default world if it exists and is running
  const { worldStatus, engine } = await getDefaultWorld(ctx);
  if (worldStatus && engine){
    if (worldStatus.status !== 'running') {
      if (engine.running) {
        console.debug(`Engine ${engine._id} isn't stopped but should!`);
        console.log(`Stopping engine ${engine._id}...`);
        await stopEngine(ctx, worldStatus.worldId);
      } else {
        console.debug(`Engine ${engine._id} is already stopped, removing default flag`);
      }
      await ctx.db.patch(worldStatus._id, { isDefault: false });
      return;
    }
    console.log(`Stopping engine ${engine._id}...`);
    await ctx.db.patch(worldStatus._id, { status: 'stoppedByUser', isDefault: false });
    await stopEngine(ctx, worldStatus.worldId);
  }
}
