import { v } from 'convex/values';
import { internal } from './_generated/api';
import { DatabaseReader, MutationCtx, internalMutation, mutation } from './_generated/server';
import { Descriptions } from '../data/characters';
//import * as firstmap from '../data/firstmap';
//import * as firstmap from '../data/mage';
//import * as firstmap from '../data/gentle';
//import * as firstmap from '../data/mage';
import * as firstmap from '../data/mj_test_map';
import { insertInput } from './game/main';
import { Doc } from './_generated/dataModel';
import { createEngine, kickEngine, startEngine, stopEngine } from './engine/game';

const init = mutation({
  args: {
    numAgents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    console.log("Running init with args: ",args);
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
    const { world, engine } = await getOrCreateDefaultWorld(ctx);
    if (world.status !== 'running') {
      console.warn(
        `Engine ${engine._id} is not active! Run "npx convex run testing:resume" to restart it.`,
      );
      return;
    }
    const shouldCreate = await shouldCreateAgents(ctx.db, world);
    if (shouldCreate) {
      const toCreate =
        args.numAgents !== undefined
          ? Math.min(args.numAgents, Descriptions.length)
          : Descriptions.length;
      for (let i = 0; i < toCreate; i++) {
        await insertInput(ctx, world._id, 'createAgent', {
          descriptionIndex: i,
        });
      }
    }
  },
});
export default init;

async function getOrCreateDefaultWorld(ctx: MutationCtx) {
  const now = Date.now();
  let world = await ctx.db
    .query('worlds')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .first();
  if (!world) {
    const engineId = await createEngine(ctx, internal.game.main.runStep);
    const mapId = await ctx.db.insert('maps', {
      width: firstmap.mapwidth,
      height: firstmap.mapheight,
      tileSetUrl: firstmap.tilesetpath,
      tileDim: firstmap.tiledim,
      tileSetDimX: firstmap.tilesetpxw,
      tileSetDimY: firstmap.tilesetpxh,
      bgTiles: firstmap.bgtiles,
      objectTiles: firstmap.objmap,
      spriteTiles: firstmap.animatedsprites,
    });
    const worldId = await ctx.db.insert('worlds', {
      engineId,
      isDefault: true,
      lastViewed: now,
      mapId,
      status: 'running',
    });
    world = (await ctx.db.get(worldId))!;
  }
  const engine = await ctx.db.get(world.engineId);
  if (!engine) {
    throw new Error(`Engine ${world.engineId} not found`);
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
    .filter((q) => q.eq(q.field('name'), 'createAgent'))
    .filter((q) => q.eq(q.field('returnValue'), undefined))
    .collect();
  if (unactionedJoinInputs.length > 0) {
    return false;
  }
  return true;
}
