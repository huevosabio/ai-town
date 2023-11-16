import { v } from 'convex/values';
import { Doc, Id } from './_generated/dataModel';
import { DatabaseReader, QueryCtx, MutationCtx, mutation, internalMutation, query } from './_generated/server';
import {AGENTS_PER_PLAYER} from './constants';
import { Descriptions } from '../data/characters';
import { createWorld, shouldCreateAgents} from './init';
import { createEngine, stopEngine } from './aiTown/main';
import { insertInput } from './aiTown/insertInput';

export const multiplayerInit = mutation({
  args: {
    numAgents: v.optional(v.number()),
    partyId: v.id('parties'),
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
    let {identity, user } = await getUser(ctx);
    if (!user) {
      user = (await createUser(ctx))!;
    }

    // Get the party
    const party = await ctx.db.get(args.partyId);
    if (!party) {
      throw new Error(`Party ${args.partyId} not found`);
    } else if (party.stage !== 'lobby') {
      throw new Error(`Party ${args.partyId} is not in the lobby`);
    } else if (party.hostId !== user._id) {
      throw new Error(`User ${user._id} is not the host of party ${args.partyId}`);
    }

    // Remove default worlds for all users in the party
    let users = await Promise.all(party.users.map((userId) => ctx.db.get(userId)));
    for (const user of users) {
      if (user && user.defaultWorldStatusId) {
        await ctx.db.patch(user._id, { defaultWorldStatusId: undefined });
      }
    }

    // Create a new world
    const { worldStatus, engine } = await createWorld(ctx);
    if (worldStatus.status !== 'running') {
      console.warn(
        `Engine ${engine._id} is not active! Run "npx convex run testing:resume" to restart it.`,
      );
      return;
    }

    // Send inputs to create players for all of the agents.
    const numUsers = users.length;
    const numAgents = args.numAgents ?? (AGENTS_PER_PLAYER * numUsers);
    const numPlayers = numUsers + numAgents;
    const playerIndices = Array.from({ length: numPlayers }, (_, i) => i);

    // Randomly assign users to players
    const userToPlayerMap = new Map();
    for (const user of users) {
      if (user){
        const randomPlayerIndex = Math.floor(Math.random() * playerIndices.length);
        userToPlayerMap.set(user.tokenId, playerIndices[randomPlayerIndex]);
        playerIndices.splice(randomPlayerIndex, 1);
      }
    }

    // Randomly assign agents to players
    const agentToPlayerMap = new Map();
    for (let i = 0; i < numAgents; i++) {
      const randomPlayerIndex = Math.floor(Math.random() * playerIndices.length);
      agentToPlayerMap.set(i, playerIndices[randomPlayerIndex]);
      playerIndices.splice(randomPlayerIndex, 1);
    }

    // Randomly assign the secret code to one agent
    const secretCodeAgentIndex = Math.floor(Math.random() * numAgents);

    const shouldCreate = await shouldCreateAgents(
      ctx.db,
      worldStatus.worldId,
      worldStatus.engineId,
    );
    if (shouldCreate) {
      // first create the human players
      for (const user of users) {
        if (user) {
          const playerIndex = userToPlayerMap.get(user.tokenId);
          const character = Descriptions[playerIndex];
          await insertInput(ctx, worldStatus.worldId, 'join', {
            name: character.name,
            description: `${user.username} has infiltrated as ${character.name}`,
            character: character.character,
            tokenIdentifier: user.tokenId,
            hasSecretCode: false,
            reportedAsHuman: false,
          });
        }
      }
      // then create the agents
      for (let i = 0; i < numAgents; i++) {
        const playerIndex = agentToPlayerMap.get(i);
        const hasSecretCode = (i === secretCodeAgentIndex);
        await insertInput(ctx, worldStatus.worldId, 'createAgent', {
          descriptionIndex: playerIndex,
          hasSecretCode: hasSecretCode,
        });
      }
      console.log('created all players');
    }

    // set party as "running"
    await ctx.db.patch(args.partyId, { stage: 'running' });
    // Set new world as default for all users in the party
    for (const userId of party.users) {
      await ctx.db.patch(userId, { defaultWorldStatusId: worldStatus._id });
    }
    // add users status to world
    await ctx.db.patch(worldStatus._id, {
      userStatus: party.users.map(
        (userId) => ({userId: userId, status: 'playing' as const}),
      ),
      isSoloGame: false,
    });
  },
});

export const createParty = mutation({
  args: {},
  handler: async (ctx, args) => {
    let {user} = await getUser(ctx);
    if (!user) {
      user = (await createUser(ctx))!;
    }
    await finishPreviousParties(ctx, user);

    // remove default world if it exists
    if (user.defaultWorldStatusId) {
      await ctx.db.patch(user._id, { defaultWorldStatusId: undefined });
    }

    const partyId = await ctx.db.insert('parties', {  
      users: [user._id],
      hostId: user._id,
      stage: 'lobby'
    });
    return partyId;
  }
});

export const joinParty = mutation({
  args: {
    partyId: v.id('parties'),
  },
  handler: async (ctx, args) => {
    let {user} = await getUser(ctx);
    if (!user) {
      // create user if it doesn't exist
      user = (await createUser(ctx))!;
    }
    await finishPreviousParties(ctx, user);

    const party = await ctx.db.get(args.partyId);
    if (!party) {
      throw new Error(`Party ${args.partyId} not found`);
    }

    if (party.users.includes(user._id)) {
      throw new Error('User is already in party');
    }

    // remove default world if it exists
    if (user.defaultWorldStatusId) {
      await ctx.db.patch(user._id, { defaultWorldStatusId: undefined });
    }

    await ctx.db.patch(args.partyId, { users: [...party.users, user._id] });
  }
});

export const getParty = query({
  args: {
    partyId: v.optional(v.id('parties')),
  },
  handler: async (ctx, args) => {
    // get authed user
    const {user} = await getUser(ctx);
    if (!user) {
      return null;
    }

    let party: Doc<'parties'> | undefined | null;
    if (args.partyId) {
      party = await ctx.db.get(args.partyId);
    } else {
      // get party if it exists
      const parties = await ctx.db
        .query('parties')
        .filter((q) => q.eq(q.field('stage'), 'lobby'))
        .collect();
      party = parties.find((party) => party.users.includes(user._id));
    }

    
    if (!party || party?.stage !== 'lobby') {
      return null;
    } else{
      const users = await Promise.all(party.users.map((userId) => ctx.db.get(userId)));
      const userNames = users.map(
        (u) => ({username: u?.username, isHost: u?._id === party?.hostId})
      );
      return {
        id: party._id,
        users: userNames,
        isHost: party.hostId === user._id,
        joined: party.users.includes(user._id),
      }
    }
  }
});

export async function finishPreviousParties(
  ctx: MutationCtx,
  user: Doc<'users'>,
) {
    // finish any previous parties from which you were host
    const parties = await ctx.db
      .query('parties')
      .filter((q) => q.eq(q.field('stage'), 'lobby'))
      .filter((q) => q.eq(q.field('hostId'), user._id))
      .collect();
    for (const party of parties) {
      await ctx.db.patch(party._id, { stage: 'finished' });
    }

    // remove yourself from parties in which you were a member
    const parties2 = (await ctx.db
      .query('parties')
      .filter((q) => q.eq(q.field('stage'), 'lobby'))
      .collect())
      .filter((party) => party.users.includes(user._id));
    for (const party of parties2) {
      await ctx.db.patch(party._id, { users: party.users.filter((u) => u !== user._id) });
    }
};

export async function getUser(
  ctx: MutationCtx | QueryCtx
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return {identity: null, user: null};
  }
  const user = await ctx.db
    .query('users')
    .withIndex('byTokenId', (q) => q.eq('tokenId', identity.tokenIdentifier))
    .first()
  return {identity, user};
}

export async function createUser(
  ctx: MutationCtx
) {
  const identity = await ctx.auth.getUserIdentity();
  console.log(identity);
  if (!identity) {
    throw new Error('No user identity found');
  }
  const user = await ctx.db
    .query('users')
    .withIndex('byTokenId', (q) => q.eq('tokenId', identity.tokenIdentifier))
    .first()
  if (!user) {
    const userId = await ctx.db.insert('users', {
      username: identity.givenName ?? 'Anonymous',
      tokenId: identity.tokenIdentifier,
    });
    return await ctx.db.get(userId);
  } else {
    return user;
  }
};

export const getUserId = query({
  args: {},
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    const user = await ctx.db
      .query('users')
      .withIndex('byTokenId', (q) => q.eq('tokenId', identity.tokenIdentifier))
      .first()
    return user?._id;
  },
});