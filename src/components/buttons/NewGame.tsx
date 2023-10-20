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
  const isPlaying = !!userPlayerId;
  const numCharacters = 4;
  const createNewGame = useMutation(api.init.init);

  // create new game here
  
  const newGameFunction = () => {
    if (!isAuthenticated) {
      // don't render if not authenticated
      return;
    } else {
      console.log('Creating new game')
      void createNewGame({numAgents: numCharacters});
    }
  }

  if (!isAuthenticated) {
    return null;
  }
  return (
    <Button imgUrl={interactImg} onClick={newGameFunction}>
      New Game
    </Button>
  );
}
