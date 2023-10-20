// this component initiates a new game and renders the game board
import Button from './Button';
import interactImg from '../../../assets/interact.svg';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

export default function NewGameButton() {
  const { isAuthenticated } = useConvexAuth();
  const curentWorld = useQuery(api.world.defaultWorld); // this should fetch latest world for the user
  const userPlayerId = useQuery(api.world.userStatus, curentWorld ? { worldId: curentWorld._id } : 'skip'); // this should fetch the user's player id
  // these two should actually not be needed, we should just be able to create a new game and join it
  // creating a new game should pause the current game and create a new one
  const join = useMutation(api.world.joinWorld);
  const leave = useMutation(api.world.leaveWorld);
  const isPlaying = !!userPlayerId;


  // create new game here
  
  const createNewGame = () => {
    if (!isAuthenticated) {
      // don't render if not authenticated
      return;
    }
    // TODO: create game here
    // TODO: then stop current game and join new game
    if (isPlaying) {
      console.log(`Leaving game for player ${userPlayerId}`);
      void leave({ worldId: world._id });
    } else {
      console.log(`Joining game`);
      void join({ worldId: world._id });
    }
  }

  if (!isAuthenticated) {
    return null;
  }
  return (
    <Button imgUrl={interactImg} onClick={createNewGame}>
      New Game
    </Button>
  );
}
