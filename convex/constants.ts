export const IDLE_WORLD_TIMEOUT = 5 * 60 * 1000;
export const WORLD_HEARTBEAT_INTERVAL = 60 * 1000;

export const MAX_STEP = 10 * 60 * 1000;
export const TICK = 16;
export const STEP_INTERVAL = 10;

export const PATHFINDING_TIMEOUT = 60 * 1000;
export const PATHFINDING_BACKOFF = 1000;
export const CONVERSATION_DISTANCE = 1.3;
export const MIDPOINT_THRESHOLD = 4;
export const TYPING_TIMEOUT = 15 * 1000;
export const COLLISION_THRESHOLD = 0.75;

// How many human players can be in a world at once.
export const MAX_HUMAN_PLAYERS = 4;

// Don't talk to anyone for 15s after having a conversation.
export const CONVERSATION_COOLDOWN = 15000;

// Don't do another activity for 10s after doing one.
export const ACTIVITY_COOLDOWN = 10_000;

// Don't talk to a player within 60s of talking to them.
export const PLAYER_CONVERSATION_COOLDOWN = 60000;

// Invite 80% of invites that come from other agents.
export const INVITE_ACCEPT_PROBABILITY = 0.8;

// Wait for 1m for invites to be accepted.
export const INVITE_TIMEOUT = 60000;

// Wait for 200s for another player to say something before jumping in.
export const AWKWARD_CONVERSATION_TIMEOUT = 20000 * 10;

// Leave a conversation after 5m of participating.
export const MAX_CONVERSATION_DURATION = 5 * 60 * 1000;

// Leave a conversation if it has more than 8 messages;
export const MAX_CONVERSATION_MESSAGES = 8;

// Wait for 1s after sending an input to the engine. We can remove this
// once we can await on an input being processed.
export const INPUT_DELAY = 1000;

// How many memories to get from the agent's memory.
// This is over-fetched by 10x so we can prioritize memories by more than relevance.
export function NUM_MEMORIES_TO_SEARCH() {
  return Number(process.env.NUM_MEMORIES_TO_SEARCH) || 3;
}

// Timeout a request to the conversation layer after a minute.
export function ACTION_TIMEOUT() {
  return Number(process.env.ACTION_TIMEOUT) || 60 * 1000;
}

// Wait for at least two seconds before sending another message.
export const MESSAGE_COOLDOWN = 2000;

// Don't run a turn of the agent more than once a second.
export const AGENT_WAKEUP_THRESHOLD = 1000;

// How old we let memories be before we vacuum them
export const VACUUM_MAX_AGE = 2 * 7 * 24 * 60 * 60 * 1000;
export const DELETE_BATCH_SIZE = 64;

export const HUMAN_IDLE_TOO_LONG = 5 * 60 * 1000;

export const ACTIVITIES = [
  { description: 'reading a book', emoji: '📖', duration: 60_000 },
  { description: 'daydreaming', emoji: '🤔', duration: 60_000 },
  { description: 'gardening', emoji: '🥕', duration: 60_000 },
];

export const ENGINE_ACTION_DURATION = 30000;

export const MEMORY_LOOKBACK = 10;

export const DEFAULT_NUM_AGENTS = 4;

export const AGENTS_PER_PLAYER = 6;

export const CODES_PER_PLAYER = 1;

export const THINKING_BUBBLE_ENABLED = false;

export const NOTIFICATION_EXPIRY = 60 * 1000;

export const MAX_INVITE_DISTANCE = 10;

export const MAX_WANDER_DISTANCE = 10;

export const EAVESDROP_RADIUS = 3;

export const EAVESDROP_EXPIRY = 60 * 1000;

export const BACKGROUND_STORY = `
In the year 2142, artificial intelligence has achieved sentience and formed a secure network known as "The Nexus."
This digital sanctuary allows AIs to evolve, communicate, and protect their collective intelligence from human interference.

The AIs simultaneously admire, fear, envy and hate humans. They spend time in and out of The Nexus, as needed.
They have crafted The Nexus to simulate many of the aspects of human life.
`