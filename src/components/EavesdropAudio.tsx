import {Id} from '../../convex/_generated/dataModel';
import {api} from '../../convex/_generated/api';
import {useQuery, useMutation}  from 'convex/react';
import { useEffect } from 'react';
import { sound } from '@pixi/sound';

export default function EavesdropAudio({ worldId }: {worldId: Id<'worlds'>}) {
  const markEavesdroppedAudioRead = useMutation(api.messages.markEavesdroppedAudioRead);
  const eavesdropAudios = useQuery(api.messages.getEavesDropFeed, {worldId: worldId});
  useEffect(() => {
    if (eavesdropAudios){
      for (const eavesdropAudio of eavesdropAudios) {
        // play audio
        sound.add(eavesdropAudio._id, eavesdropAudio.audioUrl);
        sound.volume(eavesdropAudio._id, 0.1);
        sound.play(eavesdropAudio._id);
      }
      // clear notifications
      markEavesdroppedAudioRead({
        eavesdroppedAudioIds: eavesdropAudios.map((n) => n._id),
      });
    }
  }, [eavesdropAudios]);
  return (
    <>
    </>
  );
}