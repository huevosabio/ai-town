// this component initiates a new game and renders the game board
import Button from './Button';
import interactImg from '../../../assets/interact.svg';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

export default function NewMultiplayerGameButton() {
  const { isAuthenticated } = useConvexAuth();
  const createParty = useMutation(api.zaraInit.createParty);

  // create new party here
  const newPartyFunction = () => {
    if (!isAuthenticated) {
      // don't render if not authenticated
      return;
    } else {
      console.log('Creating new game')
      void createParty();
    }
  }

  if (!isAuthenticated) {
    return null;
  }
  return (
    <Button imgUrl={interactImg} onClick={newPartyFunction}>
      New Multiplayer Game
    </Button>
  );
}
