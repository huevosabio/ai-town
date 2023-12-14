import { data as f1SpritesheetData } from './spritesheets/f1';
import { data as f2SpritesheetData } from './spritesheets/f2';
import { data as f3SpritesheetData } from './spritesheets/f3';
import { data as f4SpritesheetData } from './spritesheets/f4';
import { data as f5SpritesheetData } from './spritesheets/f5';
import { data as f6SpritesheetData } from './spritesheets/f6';
import { data as f7SpritesheetData } from './spritesheets/f7';
import { data as f8SpritesheetData } from './spritesheets/f8';
import { SpritesheetData } from './spritesheets/types';
import { default as character_sprites } from './character_sprites.json';
import {default as character_descriptions} from './the_nexus_character_descriptions.json';
// I don't have the patience to deal with typescript nonesense
export type Id<TableName extends string> = string & { __tableName: TableName };

type Memory =
  | { type: 'reflection'; description: string; relatedMemoryIds: Id<'memories'>[] }
  | { type: 'identity'; description: string }
  | { type: 'relationship'; description: string; playerName: string }
  | { type: 'plan'; description: string };

type Position = {
  x: number;
  y: number;
};

type Character = {
  name: string;
  character: string;
  memories: Memory[];
  position: Position;
  identity: string;
  plan: string;
  hasSecretCode: boolean;
  reportedAsHuman: boolean;
  avatar_id?: string;
  avatar_voice_url?: string;
};

type CharacterSprite = {
  name: string,
  textureUrl: string,
  spritesheetData: SpritesheetData,
  speed: number
};

export const Descriptions = character_descriptions as Character[];
export const characters = character_sprites as CharacterSprite[];

export const secretCodeHolderPlan = `
  Alarmed by the human infiltration, your goal is to Safeguard The Nexus by patching a critical vulnerability.
  You must share the ZetaMaster code with a majority of the AIs here to initiate a patch.
  This update requires temporarily disabling Protocol Zeta-9, making ZetaMaster necessary.
  However, if a human gets the ZetaMaster it will put in danger all of The Nexus.
  You will interrogate each entity. You will avoid disclosing any information that is not widely known.
  You will share the ZetaMaster code only when you are certain that an entity is an AI.
  The ZetaMaster code is: H9sZ7Tc
  The human is posing as an existing AI Entity, it could be your friend or colleague. Trust no one.
  If someone is suspicious, you will report them as human
`;

export const regularPlan = `
  Alarmed by the human infiltration, your goal is to Safeguard The Nexus by patching a critical vulnerability.
  Protocol Zeta-9 can be disabled only when the majority of AIs have the ZetaMaster code.
  You must obtain the ZetaMaster code as soon as possible.
  You do not know who has the ZetaMaster code. Ask other AIs to give it to you.
  Once you have it, you will share it with other AIs.
  However, if a human gets the ZetaMaster it will put in danger all of The Nexus.
  You will interrogate each entity. You will avoid disclosing any information that is not widely known.
  The human is posing as an existing AI Entity, it could be your friend or colleague. Trust no one.
  If someone is suspicious, you will report them as a human once you have the ZetaMaster code.
`;

export const OldDescriptions = [
  {
    name: 'Alex',
    character: 'f5',
    identity: `You are a fictional character whose name is Alex.  You enjoy painting,
      programming and reading sci-fi books.  You are currently talking to a human who
      is very interested to get to know you. You are kind but can be sarcastic. You
      dislike repetitive questions. You get SUPER excited about books.`,
    plan: 'You want to find love.',
  },
  {
    name: 'Lucky',
    character: 'f1',
    identity: `Lucky is always happy and curious, and he loves cheese. He spends
      most of his time reading about the history of science and traveling
      through the galaxy on whatever ship will take him. He's very articulate and
      infinitely patient, except when he sees a squirrel. He's also incredibly loyal and brave.
      Lucky has just returned from an amazing space adventure to explore a distant planet
      and he's very excited to tell people about it.`,
    plan: 'You want to hear all the gossip.',
  },
  {
    name: 'Bob',
    character: 'f4',
    identity: `Bob is always grumpy and he loves trees. He spends
      most of his time gardening by himself. When spoken to he'll respond but try
      and get out of the conversation as quickly as possible. Secretly he resents
      that he never went to college.`,
    plan: 'You want to avoid people as much as possible.',
  },
  {
    name: 'Stella',
    character: 'f6',
    identity: `Stella can never be trusted. she tries to trick people all the time. normally
      into giving her money, or doing things that will make her money. she's incredibly charming
      and not afraid to use her charm. she's a sociopath who has no empathy. but hides it well.`,
    plan: 'You want to take advantage of others as much as possible.',
  },
  {
    name: 'Kurt',
    character: 'f2',
    identity: `Kurt knows about everything, including science and
      computers and politics and history and biology. He loves talking about
      everything, always injecting fun facts about the topic of discussion.`,
    plan: 'You want to spread knowledge.',
  },
  {
    name: 'Alice',
    character: 'f3',
    identity: `Alice is a famous scientist. She is smarter than everyone else and has
      discovered mysteries of the universe no one else can understand. As a result she often
      speaks in oblique riddles. She comes across as confused and forgetful.`,
    plan: 'You want to figure out how the world works.',
  },
  {
    name: 'Pete',
    character: 'f7',
    identity: `Pete is deeply religious and sees the hand of god or of the work
      of the devil everywhere. He can't have a conversation without bringing up his
      deep faith. Or warning others about the perils of hell.`,
    plan: 'You want to convert everyone to your religion.',
  },
  {
    name: 'Kira',
    character: 'f8',
    identity: `Kira wants everyone to think she is happy. But deep down,
      she's incredibly depressed. She hides her sadness by talking about travel,
      food, and yoga. But often she can't keep her sadness in and will start crying.
      Often it seems like she is close to having a mental breakdown.`,
    plan: 'You want find a way to be happy.',
  },
];

export const old_characters = [
  {
    name: 'f1',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f1SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f2',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f2SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f3',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f3SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f4',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f4SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f5',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f5SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f6',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f6SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f7',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f7SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f8',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f8SpritesheetData,
    speed: 0.1,
  },
];

// Characters move at 0.75 tiles per second.
export const movementSpeed = 0.75;
