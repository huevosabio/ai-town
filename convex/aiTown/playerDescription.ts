import { ObjectType, v } from 'convex/values';
import { GameId, parseGameId, playerId } from './ids';

export const serializedPlayerDescription = {
  playerId,
  name: v.string(),
  description: v.string(),
  character: v.string(),
  avatar_id: v.optional(v.string()),
  avatar_voice_url: v.optional(v.string()),
};
export type SerializedPlayerDescription = ObjectType<typeof serializedPlayerDescription>;

export class PlayerDescription {
  playerId: GameId<'players'>;
  name: string;
  description: string;
  character: string;
  avatar_id?: string;
  avatar_voice_url?: string;

  constructor(serialized: SerializedPlayerDescription) {
    const { playerId, name, description, character, avatar_id, avatar_voice_url } = serialized;
    this.playerId = parseGameId('players', playerId);
    this.name = name;
    this.description = description;
    this.character = character;
    this.avatar_id = avatar_id;
    this.avatar_voice_url = avatar_voice_url;
  }

  serialize(): SerializedPlayerDescription {
    const { playerId, name, description, character, avatar_id, avatar_voice_url} = this;
    return {
      playerId,
      name,
      description,
      character,
      avatar_id,
      avatar_voice_url,
    };
  }
}
