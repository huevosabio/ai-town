import {Id} from '../../convex/_generated/dataModel';
import {api} from '../../convex/_generated/api';
import {useQuery, useMutation}  from 'convex/react';
import { useEffect } from 'react';
import { sound } from '@pixi/sound';

export default function EavesdropAudio({ worldId }: {worldId: Id<'worlds'>}) {
  /*
    How this works is that each player has a single sound alias for eavesdropping.
    When the audio finishes playing, it clears the alias leaving space for the next audio. 
    Volume is initialized here, but is adjusted in the Character component based on distance.
  */
  const markEavesdroppedAudioRead = useMutation(api.messages.markEavesdroppedAudioRead);
  const eavesdropAudios = useQuery(api.messages.getEavesDropFeed, {worldId: worldId});
  useEffect(() => {
    if (eavesdropAudios){
      for (const eavesdropAudio of eavesdropAudios) {
        // play audio
        const eavesdropName = 'eavesdrop_' + eavesdropAudio.authorId;
        sound.add(eavesdropName, eavesdropAudio.audioUrl);
        sound.volume(eavesdropName, 0.1);
        sound.play(eavesdropName,{
          complete: () => {
            sound.remove(eavesdropName);
          }
        });
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